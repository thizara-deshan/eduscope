from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

from pipeline_manager.models import PublisherId, PublisherState, SourceRole
from pipeline_manager.pipelines.builder import PipelineSpec
from pipeline_manager.publishers.base import PUBLISHER_ROLES, PublisherController, RestartBudget
from pipeline_manager.supervisor.process import ProcessSupervisor

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "events" / "publisher.json"
FAKE_CHILD = Path(__file__).resolve().parents[1] / "supervisor" / "fake_child.py"

REQUIRED_EVENT_FIELDS = {
    "sequence",
    "publisherId",
    "roleId",
    "state",
    "fps",
    "rms",
    "lastError",
    "occurredAt",
}


def _spec() -> PipelineSpec:
    return PipelineSpec(argv=(sys.executable, str(FAKE_CHILD), "playing"), required_roles=(), encode_slots=0, outputs=())


def test_publisher_event_fixture_has_required_fields_and_monotonic_sequence() -> None:
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert rows, "fixture must not be empty"
    sequences = []
    for row in rows:
        assert REQUIRED_EVENT_FIELDS.issubset(row.keys())
        sequences.append(row["sequence"])
    assert sequences == sorted(sequences)
    assert len(sequences) == len(set(sequences))


def test_publisher_event_fixture_role_ids_are_canonical() -> None:
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
    canonical = {role.value for role in SourceRole}
    for row in rows:
        assert row["roleId"] in canonical


@pytest.mark.asyncio
async def test_killing_one_publisher_only_changes_its_pid_siblings_untouched() -> None:
    """Four publishers + two fake consumers, all independent processes. Killing
    one publisher must not disturb the other publishers or the consumers —
    the entire point of shm decoupling (design §1.1)."""
    supervisor = ProcessSupervisor()
    identities = ["publisher:usb", "publisher:rtsp", "publisher:rtsp2", "publisher:audio"]
    consumer_identities = ["consumer:record:1", "consumer:live:1"]

    processes = {identity: await supervisor.start(_spec(), identity) for identity in identities}
    consumers = {identity: await supervisor.start(_spec(), identity) for identity in consumer_identities}

    try:
        for process in {**processes, **consumers}.values():
            await asyncio.wait_for(process.observations.get(), timeout=5)  # drain PLAYING

        before_pids = {identity: process.pid for identity, process in processes.items()}
        before_consumer_pids = {identity: process.pid for identity, process in consumers.items()}

        killed_identity = "publisher:rtsp"
        processes[killed_identity].popen.terminate()
        processes[killed_identity].popen.wait(timeout=5)

        restarted = await supervisor.start(_spec(), killed_identity)
        await asyncio.wait_for(restarted.observations.get(), timeout=5)

        assert restarted.pid != before_pids[killed_identity]
        for identity, process in processes.items():
            if identity == killed_identity:
                continue
            assert process.pid == before_pids[identity]
            assert process.popen.poll() is None
        for identity, process in consumers.items():
            assert process.pid == before_consumer_pids[identity]
            assert process.popen.poll() is None
    finally:
        for process in {**processes, **consumers}.values():
            if process.popen.poll() is None:
                process.popen.terminate()
        for process in {**processes, **consumers}.values():
            process.popen.wait(timeout=5)
        if restarted.popen.poll() is None:
            restarted.popen.terminate()
        restarted.popen.wait(timeout=5)


class FakeClock:
    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class TestPublisherRoles:
    def test_maps_all_four_ids_to_canonical_roles(self) -> None:
        assert PUBLISHER_ROLES[PublisherId.USB] is SourceRole.PRESENTATION
        assert PUBLISHER_ROLES[PublisherId.RTSP] is SourceRole.LECTURER_CAM
        assert PUBLISHER_ROLES[PublisherId.RTSP2] is SourceRole.STUDENTS_CAM
        assert PUBLISHER_ROLES[PublisherId.AUDIO] is SourceRole.MIC_LECTURER


class TestRestartBudget:
    def test_delays_are_one_three_eight_seconds(self) -> None:
        clock = FakeClock()
        budget = RestartBudget(clock=clock)
        assert budget.next_backoff() == 1.0
        budget.record_attempt()
        assert budget.next_backoff() == 3.0
        budget.record_attempt()
        assert budget.next_backoff() == 8.0
        budget.record_attempt()
        assert budget.next_backoff() is None

    def test_exhausted_after_three_attempts_within_120s(self) -> None:
        clock = FakeClock()
        budget = RestartBudget(clock=clock)
        for _ in range(3):
            budget.record_attempt()
            clock.advance(1.0)
        assert budget.exhausted is True

    def test_attempts_older_than_120s_are_pruned(self) -> None:
        clock = FakeClock()
        budget = RestartBudget(clock=clock)
        budget.record_attempt()
        budget.record_attempt()
        clock.advance(121.0)
        assert budget.exhausted is False
        assert budget.next_backoff() == 1.0  # budget effectively reset by the window

    def test_reset_clears_attempts(self) -> None:
        clock = FakeClock()
        budget = RestartBudget(clock=clock)
        budget.record_attempt()
        budget.record_attempt()
        budget.reset()
        assert budget.next_backoff() == 1.0


class TestPublisherControllerRestartLifecycle:
    def test_three_unexpected_exits_exhaust_and_go_offline(self) -> None:
        clock = FakeClock()
        controller = PublisherController(PublisherId.RTSP, clock=clock)
        events = []
        for _ in range(3):
            events.append(controller.on_unexpected_exit("no route"))
            clock.advance(1.0)
        fourth = controller.on_unexpected_exit("no route")

        assert [event.kind for event in events] == ["exited", "exited", "exited"]
        assert [event.backoff_seconds for event in events] == [1.0, 3.0, 8.0]
        assert fourth.kind == "failed"
        assert fourth.state is PublisherState.OFFLINE
        assert controller.current_state() is PublisherState.OFFLINE

    def test_binding_change_resets_restart_budget(self) -> None:
        clock = FakeClock()
        controller = PublisherController(PublisherId.RTSP, clock=clock)
        controller.on_unexpected_exit("a")
        controller.on_unexpected_exit("b")
        controller.on_unexpected_exit("c")
        assert controller.restart_budget.exhausted is True

        controller.bind("rtsp://new-camera-address")

        assert controller.restart_budget.exhausted is False
        assert controller.restart_budget.next_backoff() == 1.0

    def test_manual_retry_resets_restart_budget(self) -> None:
        clock = FakeClock()
        controller = PublisherController(PublisherId.RTSP, clock=clock)
        controller.on_unexpected_exit("a")
        controller.on_unexpected_exit("b")
        controller.on_unexpected_exit("c")
        assert controller.restart_budget.exhausted is True

        controller.manual_retry()

        assert controller.restart_budget.exhausted is False

    def test_running_observation_also_resets_budget(self) -> None:
        clock = FakeClock()
        controller = PublisherController(PublisherId.USB, clock=clock)
        controller.on_unexpected_exit("a")
        event = controller.observe_running()
        assert event.kind == "running"
        assert controller.restart_budget.exhausted is False


class TestTelemetryStaleness:
    def test_fresh_telemetry_reports_last_state(self) -> None:
        clock = FakeClock()
        controller = PublisherController(PublisherId.AUDIO, clock=clock)
        controller.observe_running()
        controller.observe_telemetry(rms=0.4)
        clock.advance(5.9)
        assert controller.current_state() is PublisherState.ONLINE

    def test_telemetry_older_than_six_seconds_is_unknown_not_last_healthy(self) -> None:
        clock = FakeClock()
        controller = PublisherController(PublisherId.AUDIO, clock=clock)
        controller.observe_running()
        controller.observe_telemetry(rms=0.4)
        clock.advance(6.01)
        assert controller.current_state() is PublisherState.UNKNOWN

    def test_no_telemetry_yet_is_offline(self) -> None:
        clock = FakeClock()
        controller = PublisherController(PublisherId.USB, clock=clock)
        assert controller.current_state() is PublisherState.OFFLINE

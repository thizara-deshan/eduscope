from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import pytest

from pipeline_manager.models import PublisherId, PublisherState
from pipeline_manager.publishers.base import PublisherBinding, PublisherController
from pipeline_manager.publishers.coordinator import (
    PublisherNotBound,
    select_publisher_spec,
    start_publisher,
    stop_publisher,
)
from pipeline_manager.supervisor.process import ManagedProcess

# ── fakes (Unit level: no real subprocess, no real OS signals) ─────────────


@dataclass
class FakePopen:
    returncode: int | None = None

    def wait(self, timeout: float | None = None) -> int:
        self.returncode = 0
        return 0


@dataclass
class FakeSupervisor:
    calls: list = field(default_factory=list)
    next_pid: int = 3000
    processes: dict = field(default_factory=dict)

    async def start(self, spec, identity):
        self.calls.append((spec, identity))
        process = ManagedProcess(identity=identity, pid=self.next_pid, pgid=self.next_pid, popen=FakePopen())
        self.next_pid += 1
        self.processes[identity] = process
        return process

    def forget(self, identity):
        self.processes.pop(identity, None)


@dataclass
class FakeConfirmer:
    gate: asyncio.Event | None = None
    exc: Exception | None = None
    calls: list = field(default_factory=list)

    async def confirm(self, process, **kwargs):
        self.calls.append((process, kwargs))
        if self.gate is not None:
            await self.gate.wait()
        if self.exc is not None:
            raise self.exc


@dataclass
class FakeEvents:
    published: list = field(default_factory=list)

    async def publish(self, kind, data):
        self.published.append((kind, data))


@dataclass
class SignalSpy:
    calls: list = field(default_factory=list)

    def __call__(self, pgid: int, sig: int) -> None:
        self.calls.append((pgid, sig))


def _bound_controller(publisher_id: PublisherId = PublisherId.RTSP, **binding_kwargs) -> PublisherController:
    controller = PublisherController(publisher_id)
    binding_kwargs.setdefault("address", "rtsp://cam1")
    controller.bind(PublisherBinding(**binding_kwargs))
    return controller


# ── select_publisher_spec (Tier-1, pure) ────────────────────────────────────


class TestSelectPublisherSpec:
    def test_unbound_publisher_raises(self) -> None:
        controller = PublisherController(PublisherId.USB)
        with pytest.raises(PublisherNotBound):
            select_publisher_spec(controller)

    def test_usb_prefers_device_path_over_address(self) -> None:
        controller = PublisherController(PublisherId.USB)
        controller.bind(PublisherBinding(address="ignored", device_path="/dev/video3"))
        spec = select_publisher_spec(controller)
        assert "device=/dev/video3" in spec.argv

    def test_usb_falls_back_to_address_when_no_device_path(self) -> None:
        controller = PublisherController(PublisherId.USB)
        controller.bind(PublisherBinding(address="/dev/video0"))
        spec = select_publisher_spec(controller)
        assert "device=/dev/video0" in spec.argv

    def test_rtsp_includes_credentials_only_when_both_present(self) -> None:
        controller = PublisherController(PublisherId.RTSP)
        controller.bind(PublisherBinding(address="rtsp://cam1", username="u", password="p"))
        spec = select_publisher_spec(controller)
        assert "user-id=u" in spec.argv
        assert "user-pw=p" in spec.argv

    def test_rtsp2_without_credentials_omits_them(self) -> None:
        controller = PublisherController(PublisherId.RTSP2)
        controller.bind(PublisherBinding(address="rtsp://cam2"))
        spec = select_publisher_spec(controller)
        assert not any(token.startswith("user-id=") for token in spec.argv)

    def test_audio_uses_address_as_the_alsa_device(self) -> None:
        controller = PublisherController(PublisherId.AUDIO)
        controller.bind(PublisherBinding(address="hw:1,0"))
        spec = select_publisher_spec(controller)
        assert "device=hw:1,0" in spec.argv


# ── start_publisher coordinator ─────────────────────────────────────────────


class TestStartPublisher:
    @pytest.mark.asyncio
    async def test_accepted_before_health_then_marks_online_and_publishes_running(self) -> None:
        """The coordinator spawns before it is confirmed healthy — the 202
        HTTP response (§3.1) is only meaningful if `controller` stays
        offline/no-pid for as long as confirmation is pending."""
        controller = _bound_controller(PublisherId.RTSP)
        supervisor = FakeSupervisor()
        gate = asyncio.Event()
        confirmer = FakeConfirmer(gate=gate)
        events = FakeEvents()

        task = asyncio.ensure_future(
            start_publisher(controller, supervisor=supervisor, confirmer=confirmer, events=events)
        )
        await asyncio.sleep(0)  # let it reach confirm() and block on the gate

        assert supervisor.calls, "spawn happens before confirmation, not after"
        assert controller.pid is None
        assert controller.current_state() is PublisherState.OFFLINE
        assert events.published == []

        gate.set()
        await asyncio.wait_for(task, timeout=1)

        assert controller.pid == 3000  # FakeSupervisor's first assigned pid
        assert controller.current_state() is PublisherState.ONLINE
        assert [kind for kind, _ in events.published] == ["evt.pm.publisher.running"]
        _, data = events.published[0]
        assert data == {
            "publisherId": "rtsp",
            "roleId": "lecturer-cam",
            "state": "online",
            "fps": None,
            "rms": None,
            "lastError": None,
        }

    @pytest.mark.asyncio
    async def test_no_binding_publishes_a_failure_event_instead_of_raising(self) -> None:
        controller = PublisherController(PublisherId.USB)
        supervisor = FakeSupervisor()
        confirmer = FakeConfirmer()
        events = FakeEvents()

        await start_publisher(controller, supervisor=supervisor, confirmer=confirmer, events=events)

        assert supervisor.calls == []  # never spawned — nothing to build argv from
        assert controller.pid is None
        kind, data = events.published[0]
        assert kind == "evt.pm.publisher.exited"  # first failure: backoff, not yet exhausted
        assert data["publisherId"] == "usb"
        assert "no binding" in data["lastError"]

    @pytest.mark.asyncio
    async def test_confirm_timeout_leaves_publisher_offline_and_reports_the_error(self) -> None:
        controller = _bound_controller(PublisherId.USB, device_path="/dev/video0")
        supervisor = FakeSupervisor()
        confirmer = FakeConfirmer(exc=TimeoutError("no PLAYING observation"))
        events = FakeEvents()

        await start_publisher(controller, supervisor=supervisor, confirmer=confirmer, events=events)

        assert supervisor.calls, "spawn was attempted"
        assert controller.pid is None
        kind, data = events.published[0]
        assert kind == "evt.pm.publisher.exited"
        assert data["lastError"] == "no PLAYING observation"


# ── stop_publisher coordinator ──────────────────────────────────────────────


class TestStopPublisher:
    @pytest.mark.asyncio
    async def test_stop_when_never_started_is_a_noop(self) -> None:
        controller = _bound_controller(PublisherId.AUDIO, address="hw:1,0")
        supervisor = FakeSupervisor()
        events = FakeEvents()

        await stop_publisher(controller, supervisor=supervisor, events=events)

        assert events.published == []  # idempotent: nothing running, nothing to announce

    @pytest.mark.asyncio
    async def test_stop_signals_the_process_group_and_marks_offline(self) -> None:
        controller = _bound_controller(PublisherId.AUDIO, address="hw:1,0")
        supervisor = FakeSupervisor()
        confirmer = FakeConfirmer()
        events = FakeEvents()
        await start_publisher(controller, supervisor=supervisor, confirmer=confirmer, events=events)
        events.published.clear()

        process = supervisor.processes[controller.identity]
        process.eos_seen.set()  # fake a clean EOS so stop_process doesn't wait out its deadline
        signal_spy = SignalSpy()

        await stop_publisher(controller, supervisor=supervisor, events=events, send_signal=signal_spy)

        assert signal_spy.calls, "the publisher's process group was signaled"
        assert controller.pid is None
        assert controller.current_state() is PublisherState.OFFLINE
        assert controller.identity not in supervisor.processes
        kind, data = events.published[0]
        assert kind == "evt.pm.publisher.stopped"
        assert data["publisherId"] == "audio"

    @pytest.mark.asyncio
    async def test_double_stop_is_idempotent(self) -> None:
        controller = _bound_controller(PublisherId.AUDIO, address="hw:1,0")
        supervisor = FakeSupervisor()
        confirmer = FakeConfirmer()
        events = FakeEvents()
        await start_publisher(controller, supervisor=supervisor, confirmer=confirmer, events=events)

        process = supervisor.processes[controller.identity]
        process.eos_seen.set()
        signal_spy = SignalSpy()

        await stop_publisher(controller, supervisor=supervisor, events=events, send_signal=signal_spy)
        events.published.clear()
        signal_spy.calls.clear()

        await stop_publisher(controller, supervisor=supervisor, events=events, send_signal=signal_spy)

        assert signal_spy.calls == []  # nothing left to signal the second time
        assert events.published == []

"""Unit coverage for B3 (A-REV-004/005/006): the exit watcher, transactional
failed-confirm cleanup, and the bounded/idempotent stop. Everything here runs
against `FakeSupervisor`/`FakePopen` (any OS) — the real-subprocess variants
of these same scenarios live in test_ownership_integ.py (Arch-only).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import pytest

from pipeline_manager.consumers.base import ConsumerNotRunning
from pipeline_manager.consumers.live import LiveConsumer
from pipeline_manager.consumers.record import RecordConsumer
from pipeline_manager.models import ConsumerState, LayoutPresetId
from pipeline_manager.pipelines.live import LiveRequest
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.record import RecordRequest
from pipeline_manager.publishers.base import RestartBudget
from pipeline_manager.supervisor.health import ConfirmTimeout
from pipeline_manager.supervisor.ledger import EncodeLedger
from pipeline_manager.supervisor.stop import SIGKILL

from .conftest import FakeConfirmer, FakeSupervisor, SignalSpy

# Comfortably longer than base.EXIT_POLL_INTERVAL_SECONDS so the background
# exit watcher has had at least one poll cycle to notice a simulated exit.
SETTLE_SECONDS = 0.2


@dataclass
class FakeEvents:
    published: list = field(default_factory=list)

    async def publish(self, kind: str, data: dict):
        self.published.append((kind, data))
        return None


def _live(
    *,
    supervisor: FakeSupervisor | None = None,
    ledger: EncodeLedger | None = None,
    confirmer: FakeConfirmer | None = None,
    send_signal: SignalSpy | None = None,
    events: FakeEvents | None = None,
    restart_budget: RestartBudget | None = None,
) -> LiveConsumer:
    return LiveConsumer(
        "live:1",
        platform=RK3588Profile(),
        is_publisher_running=lambda role: True,
        supervisor=supervisor or FakeSupervisor(),
        ledger=ledger or EncodeLedger(),
        confirmer=confirmer or FakeConfirmer(),
        send_signal=send_signal or SignalSpy(),
        events=events,
        restart_budget=restart_budget,
    )


def _record(
    *,
    supervisor: FakeSupervisor | None = None,
    ledger: EncodeLedger | None = None,
    confirmer: FakeConfirmer | None = None,
    send_signal: SignalSpy | None = None,
    events: FakeEvents | None = None,
) -> RecordConsumer:
    return RecordConsumer(
        "record:1",
        supervisor=supervisor or FakeSupervisor(),
        ledger=ledger or EncodeLedger(),
        confirmer=confirmer or FakeConfirmer(),
        platform=RK3588Profile(),
        is_publisher_running=lambda role: True,
        send_signal=send_signal or SignalSpy(),
        events=events,
    )


class TestExitWatcherUnexpectedExit:
    @pytest.mark.asyncio
    async def test_marks_exited_releases_ledger_drops_registry_and_publishes(self) -> None:
        events = FakeEvents()
        supervisor = FakeSupervisor()
        ledger = EncodeLedger()
        consumer = _live(supervisor=supervisor, ledger=ledger, events=events)
        await consumer.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))
        assert consumer.state is ConsumerState.RUNNING

        consumer.process.popen.returncode = 0  # the fake child exits on its own
        await asyncio.sleep(SETTLE_SECONDS)

        assert consumer.state is ConsumerState.EXITED
        assert consumer.process is None
        assert ledger.in_use == 0
        assert "live:1" not in supervisor.processes
        assert [kind for kind, _ in events.published] == ["evt.pm.consumer.exited"]
        assert events.published[0][1]["reason"] == "unexpected"
        assert events.published[0][1]["backoffSeconds"] == 1.0

    @pytest.mark.asyncio
    async def test_watcher_routes_to_the_failed_topic_once_the_budget_is_exhausted(self) -> None:
        """`ConsumerController.spawn` resets the restart budget on every
        successful confirm (a stable run forgives history), so exhaustion is
        only ever observed by a crash that follows an *already*-exhausted
        window — set that up directly rather than relying on repeated
        start/crash cycles, which would just keep resetting the budget."""
        clock = [0.0]
        budget = RestartBudget(clock=lambda: clock[0])
        events = FakeEvents()
        supervisor = FakeSupervisor()
        ledger = EncodeLedger()
        consumer = _live(supervisor=supervisor, ledger=ledger, events=events, restart_budget=budget)

        await consumer.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))
        consumer.restart_budget.attempts = [0.0, 1.0, 2.0]  # 3 attempts already used in this window
        clock[0] = 2.5

        consumer.process.popen.returncode = 0
        await asyncio.sleep(SETTLE_SECONDS)

        assert [kind for kind, _ in events.published] == ["evt.pm.consumer.failed"]
        assert consumer.state is ConsumerState.FAILED


class TestRequestedStopIsNeverUnexpected:
    @pytest.mark.asyncio
    async def test_stop_cancels_the_watcher_before_it_can_misreport(self) -> None:
        events = FakeEvents()
        consumer = _live(events=events)
        await consumer.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))
        consumer.process.eos_seen.set()

        await consumer.stop()
        await asyncio.sleep(SETTLE_SECONDS)  # give a mistaken watcher every chance to fire

        assert [kind for kind, _ in events.published] == ["evt.pm.consumer.eos"]
        assert consumer.state is ConsumerState.EXITED

    @pytest.mark.asyncio
    async def test_second_stop_is_idempotent_and_never_resignals(self) -> None:
        signal_spy = SignalSpy()
        consumer = _live(send_signal=signal_spy)
        await consumer.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))
        consumer.process.eos_seen.set()

        first = await consumer.stop()
        second = await consumer.stop()

        assert second is first
        assert len(signal_spy.calls) == 1  # only the first stop ever signals

    @pytest.mark.asyncio
    async def test_stop_before_start_still_raises(self) -> None:
        consumer = _live()
        with pytest.raises(ConsumerNotRunning):
            await consumer.stop()


class TestSiblingIsolation:
    @pytest.mark.asyncio
    async def test_one_consumers_unexpected_exit_never_touches_a_sibling(self) -> None:
        supervisor = FakeSupervisor()
        ledger = EncodeLedger()
        a = LiveConsumer(
            "live:a",
            platform=RK3588Profile(),
            is_publisher_running=lambda role: True,
            supervisor=supervisor,
            ledger=ledger,
            confirmer=FakeConfirmer(),
            send_signal=SignalSpy(),
        )
        b = LiveConsumer(
            "live:b",
            platform=RK3588Profile(),
            is_publisher_running=lambda role: True,
            supervisor=supervisor,
            ledger=ledger,
            confirmer=FakeConfirmer(),
            send_signal=SignalSpy(),
        )
        await a.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="a"))
        await b.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="b"))

        a.process.popen.returncode = 0
        await asyncio.sleep(SETTLE_SECONDS)

        assert a.state is ConsumerState.EXITED
        assert b.state is ConsumerState.RUNNING
        assert b.process is not None
        assert "live:b" in supervisor.processes


class TestFailedConfirmCleanup:
    @pytest.mark.asyncio
    async def test_confirm_timeout_kills_reaps_and_drops_the_registry(self) -> None:
        supervisor = FakeSupervisor()
        ledger = EncodeLedger()
        confirmer = FakeConfirmer(exc=ConfirmTimeout("no PLAYING"))
        signal_spy = SignalSpy()
        consumer = _live(supervisor=supervisor, ledger=ledger, confirmer=confirmer, send_signal=signal_spy)
        pid_before = supervisor.next_pid

        with pytest.raises(ConfirmTimeout):
            await consumer.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))

        assert consumer.state is ConsumerState.FAILED
        assert ledger.in_use == 0
        assert "live:1" not in supervisor.processes
        assert signal_spy.calls == [(pid_before, SIGKILL)]

    @pytest.mark.asyncio
    async def test_confirm_timeout_never_starts_a_watcher(self) -> None:
        """A rolled-back spawn must not also leave a background watcher
        polling a process that was just killed and reaped."""
        consumer = _live(confirmer=FakeConfirmer(exc=ConfirmTimeout("no PLAYING")))
        with pytest.raises(ConfirmTimeout):
            await consumer.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))
        assert consumer._exit_task is None


class TestRecordNeverInventsARestartPath:
    @pytest.mark.asyncio
    async def test_waiter_marks_truncated_and_leaves_the_path_for_core_api_to_replace(self) -> None:
        events = FakeEvents()
        supervisor = FakeSupervisor()
        ledger = EncodeLedger()
        consumer = _record(supervisor=supervisor, ledger=ledger, events=events)
        out = "/media/eduscope/recordings/seg-001.ts"
        await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=out))

        consumer.process.popen.returncode = 0
        await asyncio.sleep(SETTLE_SECONDS)

        assert consumer.state is ConsumerState.EXITED
        assert consumer.truncated is True
        assert consumer.output_path == out  # unchanged — record never invents a new segment path
        assert ledger.in_use == 0
        assert [kind for kind, _ in events.published] == ["evt.pm.consumer.exited"]

    @pytest.mark.asyncio
    async def test_second_stop_is_idempotent(self) -> None:
        consumer = _record()
        await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path="/media/eduscope/recordings/s.ts"))
        consumer.process.eos_seen.set()

        first = await consumer.stop()
        second = await consumer.stop()

        assert second is first

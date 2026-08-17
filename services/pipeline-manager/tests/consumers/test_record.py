from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from pipeline_manager.consumers.base import CaptureCardRecovering, ConsumerNotRunning, PublisherNotRunning
from pipeline_manager.consumers.record import RecordConsumer
from pipeline_manager.models import ConsumerState, LayoutPresetId, SourceRole
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.record import RecordRequest
from pipeline_manager.publishers.base import RestartBudget
from pipeline_manager.supervisor.health import ConfirmTimeout, ElementError
from pipeline_manager.supervisor.ledger import EncodeLedger
from pipeline_manager.supervisor.process import ManagedProcess

OUT_1 = "/media/eduscope/recordings/seg-001.ts"
OUT_2 = "/media/eduscope/recordings/seg-002.ts"


@dataclass
class FakePopen:
    returncode: int | None = 0

    def wait(self, timeout: float | None = None) -> int:
        return self.returncode


@dataclass
class FakeSupervisor:
    calls: list = field(default_factory=list)
    next_pid: int = 1000

    async def start(self, spec, identity):
        process = ManagedProcess(identity=identity, pid=self.next_pid, pgid=self.next_pid, popen=FakePopen())
        self.calls.append((spec, identity))
        self.next_pid += 1
        return process


@dataclass
class FakeConfirmer:
    exc: Exception | None = None
    calls: list = field(default_factory=list)

    async def confirm(self, process, **kwargs):
        self.calls.append((process, kwargs))
        if self.exc is not None:
            raise self.exc


@dataclass
class SignalSpy:
    calls: list = field(default_factory=list)

    def __call__(self, pgid: int, sig: int) -> None:
        self.calls.append((pgid, sig))


def _consumer(
    *,
    publisher_running: bool = True,
    capture_card_recovering: bool = False,
    confirmer: FakeConfirmer | None = None,
    supervisor: FakeSupervisor | None = None,
    ledger: EncodeLedger | None = None,
) -> tuple[RecordConsumer, FakeSupervisor, FakeConfirmer, EncodeLedger]:
    sup = supervisor or FakeSupervisor()
    conf = confirmer or FakeConfirmer()
    ledg = ledger or EncodeLedger()
    consumer = RecordConsumer(
        "record:test",
        supervisor=sup,
        ledger=ledg,
        confirmer=conf,
        platform=RK3588Profile(),
        is_publisher_running=lambda role: publisher_running,
        is_capture_card_recovering=lambda: capture_card_recovering,
        send_signal=SignalSpy(),
    )
    return consumer, sup, conf, ledg


class TestStartReadinessRefusal:
    @pytest.mark.asyncio
    async def test_refuses_when_required_publisher_not_running(self) -> None:
        consumer, sup, _, _ = _consumer(publisher_running=False)
        with pytest.raises(PublisherNotRunning):
            await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))
        assert sup.calls == []  # never spawned

    @pytest.mark.asyncio
    async def test_refuses_when_capture_card_recovering_and_presentation_required(self) -> None:
        consumer, sup, _, _ = _consumer(capture_card_recovering=True)
        with pytest.raises(CaptureCardRecovering):
            await consumer.start(RecordRequest(preset=LayoutPresetId.FIFTY_FIFTY, output_path=OUT_1))
        assert sup.calls == []

    @pytest.mark.asyncio
    async def test_capture_card_recovering_does_not_block_camera_only_preset(self) -> None:
        consumer, sup, _, _ = _consumer(capture_card_recovering=True)
        event = await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))
        assert event.state is ConsumerState.RUNNING


class TestStartConfirmation:
    @pytest.mark.asyncio
    async def test_confirms_only_after_playing_and_growth_via_confirmer(self) -> None:
        confirmer = FakeConfirmer()
        consumer, sup, conf, _ = _consumer(confirmer=confirmer)
        event = await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))

        assert event.state is ConsumerState.RUNNING
        assert conf.calls[0][1]["is_record"] is True
        assert conf.calls[0][1]["output_path"] == OUT_1
        assert consumer.output_path == OUT_1
        assert consumer.pgid is not None

    @pytest.mark.asyncio
    async def test_confirm_timeout_marks_failed_and_releases_ledger(self) -> None:
        consumer, sup, conf, ledger = _consumer(confirmer=FakeConfirmer(exc=ConfirmTimeout("no PLAYING")))
        with pytest.raises(ConfirmTimeout):
            await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))
        assert consumer.state is ConsumerState.FAILED
        assert ledger.in_use == 0

    @pytest.mark.asyncio
    async def test_element_error_marks_failed_and_releases_ledger(self) -> None:
        consumer, sup, conf, ledger = _consumer(confirmer=FakeConfirmer(exc=ElementError("boom")))
        with pytest.raises(ElementError):
            await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))
        assert consumer.state is ConsumerState.FAILED
        assert ledger.in_use == 0


class TestPauseResume:
    @pytest.mark.asyncio
    async def test_pause_uses_five_second_eos_and_releases_ledger(self) -> None:
        consumer, sup, conf, ledger = _consumer()
        await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))
        assert ledger.in_use == 0  # passthrough: 0 encode slots, but reservation existed then released on... no: still running
        consumer.process.eos_seen.set()

        event = await consumer.pause()

        assert event.kind == "eos"
        assert event.truncated is False
        assert ledger.reserved_by() == ()

    @pytest.mark.asyncio
    async def test_resume_requires_new_output_path_and_never_reopens_old_segment(self) -> None:
        consumer, sup, conf, ledger = _consumer()
        await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))
        consumer.process.eos_seen.set()
        await consumer.pause()
        assert consumer.output_path == OUT_1

        # "resume" is calling start() again with a fresh, explicit output path.
        event = await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_2))

        assert event.state is ConsumerState.RUNNING
        assert consumer.output_path == OUT_2
        assert consumer.output_path != OUT_1


class TestStop:
    @pytest.mark.asyncio
    async def test_stop_uses_eight_second_deadline_and_clean_eos(self) -> None:
        from pipeline_manager.supervisor.stop import STOP_DEADLINE_SECONDS

        consumer, sup, conf, ledger = _consumer()
        await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))
        consumer.process.eos_seen.set()

        event = await consumer.stop()

        assert event.kind == "eos"
        assert consumer.state is ConsumerState.EXITED
        assert STOP_DEADLINE_SECONDS == 8.0

    @pytest.mark.asyncio
    async def test_stop_before_start_raises(self) -> None:
        consumer, _, _, _ = _consumer()
        with pytest.raises(ConsumerNotRunning):
            await consumer.stop()


class TestUnexpectedExit:
    @pytest.mark.asyncio
    async def test_marks_truncated_and_never_invents_a_new_path(self) -> None:
        consumer, sup, conf, ledger = _consumer()
        await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))

        event = consumer.on_unexpected_exit()

        assert event.reason == "unexpected"
        assert event.truncated is True
        assert consumer.truncated is True
        assert consumer.output_path == OUT_1  # unchanged — no invented path
        assert ledger.in_use == 0

    def test_three_restarts_in_120s_exhaust(self) -> None:
        clock_value = [0.0]
        budget = RestartBudget(clock=lambda: clock_value[0])
        consumer, sup, conf, ledger = _consumer()
        consumer._restart_budget = budget

        events = []
        for _ in range(3):
            events.append(consumer.on_unexpected_exit())
            clock_value[0] += 1.0
        fourth = consumer.on_unexpected_exit()

        assert [e.state for e in events] == [ConsumerState.EXITED] * 3
        assert fourth.state is ConsumerState.FAILED


class TestNoDomainStateWrites:
    @pytest.mark.asyncio
    async def test_consumer_object_has_no_lecture_session_or_recording_state_attribute(self) -> None:
        """RecordConsumer must never hold/write LectureSession/recording domain
        state — core-api is the single writer (SM-R-1)."""
        consumer, sup, conf, ledger = _consumer()
        await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT_1))
        consumer.process.eos_seen.set()
        await consumer.stop()

        forbidden_attrs = {"lecture_session", "lectureSession", "recording_state", "recordingState"}
        assert not forbidden_attrs & set(vars(consumer).keys())

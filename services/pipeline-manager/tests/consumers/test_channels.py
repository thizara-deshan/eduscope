from __future__ import annotations

import sys
from pathlib import Path

import pytest

from pipeline_manager.consumers.base import PublisherNotRunning, RestartClass
from pipeline_manager.consumers.live import LiveConsumer
from pipeline_manager.consumers.meeting import MeetingConsumer
from pipeline_manager.consumers.record import RecordConsumer
from pipeline_manager.models import ConsumerState, LayoutPresetId, SourceRole
from pipeline_manager.pipelines.builder import PipelineSpec
from pipeline_manager.pipelines.live import LiveRequest
from pipeline_manager.pipelines.meeting import MeetingRequest
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.record import RecordRequest
from pipeline_manager.publishers.base import RestartBudget
from pipeline_manager.supervisor.ledger import EncodeLedger
from pipeline_manager.supervisor.process import ProcessSupervisor

from .conftest import FakeConfirmer, FakeSupervisor, SignalSpy

FAKE_CHILD = Path(__file__).resolve().parents[1] / "supervisor" / "fake_child.py"
HDMI2_DEVICE = "hw:2,0"


def _child_spec(mode: str) -> PipelineSpec:
    return PipelineSpec(argv=(sys.executable, str(FAKE_CHILD), mode), required_roles=(), encode_slots=0, outputs=())


class TestChannelRestartClass:
    def test_live_is_channel_class(self) -> None:
        consumer = LiveConsumer(
            "live:1",
            platform=RK3588Profile(),
            is_publisher_running=lambda role: True,
            supervisor=FakeSupervisor(),
            ledger=EncodeLedger(),
            confirmer=FakeConfirmer(),
        )
        assert consumer.restart_class is RestartClass.CHANNEL

    def test_meeting_is_channel_class(self) -> None:
        consumer = MeetingConsumer(
            "meeting:1",
            platform=RK3588Profile(),
            is_publisher_running=lambda role: True,
            supervisor=FakeSupervisor(),
            ledger=EncodeLedger(),
            confirmer=FakeConfirmer(),
        )
        assert consumer.restart_class is RestartClass.CHANNEL


class TestChannelRestartBackoffThenFail:
    def test_three_unexpected_exits_backoff_1_3_8_then_fourth_fails(self) -> None:
        clock_value = [0.0]
        consumer = LiveConsumer(
            "live:1",
            platform=RK3588Profile(),
            is_publisher_running=lambda role: True,
            supervisor=FakeSupervisor(),
            ledger=EncodeLedger(),
            confirmer=FakeConfirmer(),
            restart_budget=RestartBudget(clock=lambda: clock_value[0]),
        )
        events = []
        for _ in range(3):
            events.append(consumer.on_unexpected_exit())
            clock_value[0] += 1.0
        fourth = consumer.on_unexpected_exit()

        assert [e.state for e in events] == [ConsumerState.EXITED] * 3
        assert fourth.state is ConsumerState.FAILED


class TestMeetingStart:
    @pytest.mark.asyncio
    async def test_meeting_exposes_hdmi2_placement(self) -> None:
        consumer = MeetingConsumer(
            "meeting:1",
            platform=RK3588Profile(),
            is_publisher_running=lambda role: True,
            supervisor=FakeSupervisor(),
            ledger=EncodeLedger(),
            confirmer=FakeConfirmer(),
        )
        await consumer.start(MeetingRequest(preset=LayoutPresetId.CAM_1, hdmi2_alsa_device=HDMI2_DEVICE))
        assert consumer.placement is not None
        assert consumer.placement.fullscreen is True

    @pytest.mark.asyncio
    async def test_composite_starts_degraded_when_only_one_required_role_is_running(self) -> None:
        consumer = MeetingConsumer(
            "meeting:1",
            platform=RK3588Profile(),
            is_publisher_running=lambda role: role is SourceRole.LECTURER_CAM,
            supervisor=FakeSupervisor(),
            ledger=EncodeLedger(),
            confirmer=FakeConfirmer(),
        )
        event = await consumer.start(
            MeetingRequest(preset=LayoutPresetId.CAMS_FIFTY_FIFTY, hdmi2_alsa_device=HDMI2_DEVICE, ratio_a=50, ratio_b=50)
        )
        assert event.state is ConsumerState.RUNNING

    @pytest.mark.asyncio
    async def test_still_refuses_when_every_required_role_is_offline(self) -> None:
        consumer = MeetingConsumer(
            "meeting:1",
            platform=RK3588Profile(),
            is_publisher_running=lambda role: False,
            supervisor=FakeSupervisor(),
            ledger=EncodeLedger(),
            confirmer=FakeConfirmer(),
        )
        with pytest.raises(PublisherNotRunning):
            await consumer.start(MeetingRequest(preset=LayoutPresetId.CAM_1, hdmi2_alsa_device=HDMI2_DEVICE))


@pytest.mark.asyncio
async def test_killing_live_leaves_record_pid_and_state_unchanged(tmp_path, monkeypatch) -> None:
    """Real subprocesses: record + live, kill live, assert record pid/state
    never changes (INV-CC-2 — record is never touched by a channel restart)."""
    output_path = str(tmp_path / "seg.ts")
    supervisor = ProcessSupervisor()
    ledger = EncodeLedger()

    record = RecordConsumer(
        "record:1",
        supervisor=supervisor,
        ledger=ledger,
        confirmer=_RealPlayingConfirmer(),
        platform=RK3588Profile(),
        is_publisher_running=lambda role: True,
        send_signal=SignalSpy(),
    )
    live = LiveConsumer(
        "live:1",
        platform=RK3588Profile(),
        is_publisher_running=lambda role: True,
        supervisor=supervisor,
        ledger=ledger,
        confirmer=_RealPlayingConfirmer(),
        send_signal=SignalSpy(),
    )

    # No real GStreamer/board on this dev host: swap the argv builders for the
    # same real fake_child.py subprocess used by A-07/A-08's supervisor tests.
    # monkeypatch auto-restores these after the test — must not leak (A-11 gate fix).
    import pipeline_manager.consumers.live as live_module
    import pipeline_manager.consumers.record as record_module

    monkeypatch.setattr(
        record_module, "build_record", lambda request, platform, **_: _child_spec_grow(request.output_path)
    )
    monkeypatch.setattr(live_module, "build_live", lambda request, platform: _child_spec("playing"))

    try:
        await record.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=output_path))
        await live.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))

        record_pid_before = record.process.pid
        record_state_before = record.state

        live.process.popen.terminate()
        live.process.popen.wait(timeout=5)

        assert record.process.pid == record_pid_before
        assert record.state == record_state_before
        assert record.process.popen.poll() is None
    finally:
        if record.process and record.process.popen.poll() is None:
            record.process.popen.terminate()
        if record.process:
            record.process.popen.wait(timeout=5)


def _child_spec_grow(output_path: str) -> PipelineSpec:
    return PipelineSpec(
        argv=(sys.executable, str(FAKE_CHILD), f"grow:{output_path}"),
        required_roles=(),
        encode_slots=0,
        outputs=(output_path,),
    )


class _RealPlayingConfirmer:
    """Drives the real HealthConfirmer against a real fake_child subprocess."""

    async def confirm(self, process, *, is_record, output_path=None, timeout=5.0, **_):
        from pipeline_manager.supervisor.health import HealthConfirmer

        await HealthConfirmer(poll_interval=0.05).confirm(
            process, is_record=is_record, output_path=output_path, timeout=timeout
        )

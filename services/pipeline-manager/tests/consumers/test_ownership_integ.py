"""Arch integ-A coverage for B3 (A-REV-004/005/006): real subprocesses (the
fake_child.py used throughout supervisor/publisher Integ-A tests), real
process groups, real signals. POSIX-only — killpg/process-group semantics are
verified on the target; a non-POSIX dev host just skips these.
"""

from __future__ import annotations

import asyncio
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from pipeline_manager.consumers.live import LiveConsumer
from pipeline_manager.consumers.record import RecordConsumer
from pipeline_manager.models import ConsumerState, LayoutPresetId
from pipeline_manager.pipelines.builder import PipelineSpec
from pipeline_manager.pipelines.live import LiveRequest
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.record import RecordRequest
from pipeline_manager.supervisor.health import HealthConfirmer
from pipeline_manager.supervisor.ledger import EncodeLedger
from pipeline_manager.supervisor.process import ProcessSupervisor

FAKE_CHILD = Path(__file__).resolve().parents[1] / "supervisor" / "fake_child.py"

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="killpg/process groups are POSIX-only; verified on target"
)


def _spec(mode: str) -> PipelineSpec:
    return PipelineSpec(argv=(sys.executable, str(FAKE_CHILD), mode), required_roles=(), encode_slots=0, outputs=())


class _RealConfirmer:
    """Drives the real HealthConfirmer against a real fake_child subprocess."""

    async def confirm(self, process, *, is_record=False, output_path=None, timeout=5.0, **_):
        await HealthConfirmer(poll_interval=0.05).confirm(
            process, is_record=is_record, output_path=output_path, timeout=timeout
        )


@dataclass
class RecordingEvents:
    published: list = field(default_factory=list)

    async def publish(self, kind: str, data: dict):
        self.published.append((kind, data))
        return None


async def _until(predicate, *, timeout: float = 5.0, interval: float = 0.05) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError("condition never became true within the timeout")


@pytest.mark.asyncio
async def test_killing_a_real_child_is_detected_reported_then_resumed_with_a_fresh_pid(monkeypatch) -> None:
    """One waiter task notices a real unexpected exit (A-REV-004): the
    consumer reports it truthfully, and — mirroring how core-api actually
    recovers a record consumer (R-16) — starting the same consumer object
    again produces a genuinely new child (fresh PID), not a zombie reuse.
    """
    import pipeline_manager.consumers.live as live_module

    monkeypatch.setattr(live_module, "build_live", lambda request, platform: _spec("playing"))

    supervisor = ProcessSupervisor()
    ledger = EncodeLedger()
    events = RecordingEvents()
    consumer = LiveConsumer(
        "live:1",
        platform=RK3588Profile(),
        is_publisher_running=lambda role: True,
        supervisor=supervisor,
        ledger=ledger,
        confirmer=_RealConfirmer(),
        events=events,
    )
    try:
        await consumer.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))
        first_pid = consumer.process.pid

        consumer.process.popen.kill()  # an unrequested death — no consumer.stop() call

        await _until(lambda: consumer.state is ConsumerState.EXITED)

        assert consumer.process is None
        assert "live:1" not in supervisor.processes
        assert ledger.in_use == 0
        assert [kind for kind, _ in events.published] == ["evt.pm.consumer.exited"]
        assert events.published[0][1]["reason"] == "unexpected"

        # core-api's recovery: call start() again on the same consumer object.
        await consumer.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))
        assert consumer.process.pid != first_pid
        assert consumer.state is ConsumerState.RUNNING
    finally:
        if consumer.process is not None and consumer.process.popen.poll() is None:
            consumer.process.popen.terminate()
        if consumer.process is not None:
            consumer.process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_pgid_isolation_a_sibling_survives_its_neighbours_unexpected_exit(monkeypatch) -> None:
    import pipeline_manager.consumers.live as live_module

    monkeypatch.setattr(live_module, "build_live", lambda request, platform: _spec("playing"))

    supervisor = ProcessSupervisor()
    ledger = EncodeLedger()
    dying = LiveConsumer(
        "live:dying", platform=RK3588Profile(), is_publisher_running=lambda role: True,
        supervisor=supervisor, ledger=ledger, confirmer=_RealConfirmer(),
    )
    sibling = LiveConsumer(
        "live:sibling", platform=RK3588Profile(), is_publisher_running=lambda role: True,
        supervisor=supervisor, ledger=ledger, confirmer=_RealConfirmer(),
    )
    try:
        await dying.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="a"))
        await sibling.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="b"))
        sibling_pid = sibling.process.pid

        dying.process.popen.kill()
        await _until(lambda: dying.state is ConsumerState.EXITED)

        assert sibling.state is ConsumerState.RUNNING
        assert sibling.process is not None
        assert sibling.process.pid == sibling_pid
        assert sibling.process.popen.poll() is None
    finally:
        for consumer in (dying, sibling):
            if consumer.process is not None and consumer.process.popen.poll() is None:
                consumer.process.popen.terminate()
            if consumer.process is not None:
                consumer.process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_eos_seen_but_never_exits_is_sigkilled_at_the_single_deadline(monkeypatch) -> None:
    """A-REV-006: a child that prints `Got EOS` but then hangs must still be
    force-killed by the deadline — the previous implementation waited on the
    post-EOS exit with no bound at all and would hang forever.
    """
    import pipeline_manager.consumers.live as live_module

    monkeypatch.setattr(live_module, "build_live", lambda request, platform: _spec("eos-then-hang"))

    supervisor = ProcessSupervisor()
    ledger = EncodeLedger()
    consumer = LiveConsumer(
        "live:1", platform=RK3588Profile(), is_publisher_running=lambda role: True,
        supervisor=supervisor, ledger=ledger, confirmer=_RealConfirmer(),
    )
    try:
        await consumer.start(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"))

        started = time.monotonic()
        event = await asyncio.wait_for(consumer.stop(deadline_seconds=0.5), timeout=5.0)
        elapsed = time.monotonic() - started

        assert event.truncated is True
        assert event.error_code == "eos_timeout"
        assert elapsed < 3.0  # bounded by the deadline, not left hanging
    finally:
        if consumer.process is not None and consumer.process.popen.poll() is None:
            consumer.process.popen.terminate()
        if consumer.process is not None:
            consumer.process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_concurrent_double_stop_on_a_real_child_is_safe_and_idempotent(tmp_path, monkeypatch) -> None:
    import pipeline_manager.consumers.record as record_module

    monkeypatch.setattr(
        record_module, "build_record", lambda request, platform: _spec_grow(request.output_path)
    )

    supervisor = ProcessSupervisor()
    ledger = EncodeLedger()
    consumer = RecordConsumer(
        "record:1", supervisor=supervisor, ledger=ledger, confirmer=_RealConfirmer(),
        platform=RK3588Profile(), is_publisher_running=lambda role: True,
    )
    try:
        output_path = str(tmp_path / "seg.ts")
        await consumer.start(RecordRequest(preset=LayoutPresetId.CAM_1, output_path=output_path))

        first, second = await asyncio.gather(consumer.stop(), consumer.stop())

        assert first is second  # the same terminal ConsumerEvent, computed exactly once
        assert consumer.state is ConsumerState.EXITED
        assert "record:1" not in supervisor.processes
    finally:
        if consumer.process is not None and consumer.process.popen.poll() is None:
            consumer.process.popen.terminate()
        if consumer.process is not None:
            consumer.process.popen.wait(timeout=5)


def _spec_grow(output_path: str) -> PipelineSpec:
    return PipelineSpec(
        argv=(sys.executable, str(FAKE_CHILD), f"grow:{output_path}"),
        required_roles=(),
        encode_slots=0,
        outputs=(output_path,),
    )

from __future__ import annotations

import asyncio
import signal
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from pipeline_manager.pipelines.builder import PipelineSpec
from pipeline_manager.supervisor.process import ManagedProcess, ProcessSupervisor
from pipeline_manager.supervisor.stop import SIGKILL, StopResult, stop_process

FAKE_CHILD = Path(__file__).resolve().parent / "fake_child.py"


def _spec(mode: str) -> PipelineSpec:
    argv = (sys.executable, str(FAKE_CHILD), mode)
    return PipelineSpec(argv=argv, required_roles=(), encode_slots=0, outputs=())


@dataclass
class FakePopen:
    returncode: int | None = None
    wait_calls: int = 0

    def wait(self, timeout: float | None = None) -> int:
        self.wait_calls += 1
        if self.returncode is None:
            self.returncode = 0
        return self.returncode


@dataclass
class SignalSpy:
    calls: list[tuple[int, int]] = field(default_factory=list)

    def __call__(self, pgid: int, sig: int) -> None:
        self.calls.append((pgid, sig))


def _fake_process(pgid: int = 4242) -> tuple[ManagedProcess, FakePopen]:
    popen = FakePopen()
    process = ManagedProcess(identity="test", pid=pgid, pgid=pgid, popen=popen)  # type: ignore[arg-type]
    return process, popen


# ── pure unit tests: injected signal spy, no real OS signals ───────────────


@pytest.mark.asyncio
async def test_clean_eos_returns_not_truncated_and_sends_only_sigint() -> None:
    process, popen = _fake_process()
    spy = SignalSpy()
    process.eos_seen.set()  # simulate EOS having already arrived

    result = await stop_process(process, deadline_seconds=1.0, send_signal=spy)

    assert result == StopResult(clean_eos=True, truncated=False, exit_code=0)
    assert spy.calls == [(process.pgid, signal.SIGINT)]


@pytest.mark.asyncio
async def test_timeout_escalates_to_sigkill_and_marks_truncated() -> None:
    process, popen = _fake_process()
    spy = SignalSpy()
    # eos_seen never set -> forces the timeout branch

    result = await stop_process(process, deadline_seconds=0.05, send_signal=spy)

    assert result.clean_eos is False
    assert result.truncated is True
    assert result.error_code == "eos_timeout"
    assert spy.calls == [(process.pgid, signal.SIGINT), (process.pgid, SIGKILL)]


@pytest.mark.asyncio
async def test_pause_deadline_is_five_seconds_stop_deadline_is_eight() -> None:
    from pipeline_manager.supervisor.stop import PAUSE_DEADLINE_SECONDS, STOP_DEADLINE_SECONDS

    assert PAUSE_DEADLINE_SECONDS == 5.0
    assert STOP_DEADLINE_SECONDS == 8.0


# ── real two-process-group integration test (POSIX only) ───────────────────


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="killpg/process groups are POSIX-only; verified on target")
async def test_stopping_one_child_leaves_sibling_alive() -> None:
    supervisor = ProcessSupervisor()
    clean = await supervisor.start(_spec("playing"), "stop:clean")
    sibling = await supervisor.start(_spec("playing"), "stop:sibling")
    try:
        await asyncio.wait_for(clean.observations.get(), timeout=5)  # drain PLAYING
        await asyncio.wait_for(sibling.observations.get(), timeout=5)

        result = await stop_process(clean, deadline_seconds=5.0)

        assert result.clean_eos is True
        assert result.truncated is False
        assert sibling.popen.poll() is None  # sibling still running
    finally:
        clean.popen.terminate()
        sibling.popen.terminate()
        clean.popen.wait(timeout=5)
        sibling.popen.wait(timeout=5)


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="killpg/process groups are POSIX-only; verified on target")
async def test_hanging_child_is_sigkilled_after_deadline() -> None:
    supervisor = ProcessSupervisor()
    process = await supervisor.start(_spec("ignore-sigint"), "stop:hanging")
    try:
        result = await stop_process(process, deadline_seconds=0.3)
        assert result.truncated is True
        assert result.error_code == "eos_timeout"
    finally:
        process.popen.wait(timeout=5)

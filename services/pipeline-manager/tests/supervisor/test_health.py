from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

from pipeline_manager.pipelines.builder import PipelineSpec
from pipeline_manager.supervisor.health import ConfirmTimeout, ElementError, HealthConfirmer
from pipeline_manager.supervisor.process import ManagedProcess, Observation, ProcessSupervisor

FAKE_CHILD = Path(__file__).resolve().parent / "fake_child.py"


def _spec(mode: str) -> PipelineSpec:
    argv = (sys.executable, str(FAKE_CHILD), mode)
    return PipelineSpec(argv=argv, required_roles=(), encode_slots=0, outputs=())


def _fake_process(identity: str = "test") -> ManagedProcess:
    return ManagedProcess(identity=identity, pid=0, pgid=0, popen=None)  # type: ignore[arg-type]


class FakeClock:
    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


# ── pure unit tests: fake process, fake clock, no real subprocess ──────────


@pytest.mark.asyncio
async def test_non_file_consumer_confirms_on_playing_alone() -> None:
    process = _fake_process()
    await process.observations.put(Observation(kind="PLAYING", raw="PLAYING"))
    confirmer = HealthConfirmer()
    await confirmer.confirm(process, is_record=False, timeout=1.0)


@pytest.mark.asyncio
async def test_timeout_raises_confirm_timeout_when_no_playing_arrives() -> None:
    process = _fake_process()
    confirmer = HealthConfirmer(poll_interval=0.01)
    with pytest.raises(ConfirmTimeout):
        await confirmer.confirm(process, is_record=False, timeout=0.05)


@pytest.mark.asyncio
async def test_error_observation_raises_element_error_immediately() -> None:
    process = _fake_process()
    await process.observations.put(Observation(kind="ERROR", raw="ERROR: fake element error"))
    confirmer = HealthConfirmer()
    with pytest.raises(ElementError):
        await confirmer.confirm(process, is_record=False, timeout=5.0)


@pytest.mark.asyncio
async def test_record_never_confirmed_before_playing_plus_growth() -> None:
    process = _fake_process()
    await process.observations.put(Observation(kind="PLAYING", raw="PLAYING"))
    sizes = iter([0, 0, 1024])  # first sample, resample (no growth), grown
    clock = FakeClock()

    def stat_size(_: str) -> int:
        return next(sizes)

    confirmer = HealthConfirmer(clock=clock, stat_size=stat_size, poll_interval=0.01)

    async def advance_clock_alongside() -> None:
        for _ in range(10):
            await asyncio.sleep(0.01)
            clock.advance(0.1)

    task = asyncio.ensure_future(advance_clock_alongside())
    try:
        await confirmer.confirm(process, is_record=True, output_path="/fake/out.ts", timeout=5.0, min_sample_separation=0.2)
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_record_confirm_timeout_when_size_never_grows() -> None:
    process = _fake_process()
    await process.observations.put(Observation(kind="PLAYING", raw="PLAYING"))
    confirmer = HealthConfirmer(stat_size=lambda _: 0, poll_interval=0.01)
    with pytest.raises(ConfirmTimeout):
        await confirmer.confirm(process, is_record=True, output_path="/fake/out.ts", timeout=0.1, min_sample_separation=0.02)


# ── integration tests: real fake_child.py subprocess ────────────────────────


@pytest.mark.asyncio
async def test_confirms_after_real_playing_observation() -> None:
    supervisor = ProcessSupervisor()
    process = await supervisor.start(_spec("playing"), "health:playing")
    try:
        confirmer = HealthConfirmer()
        await confirmer.confirm(process, is_record=False, timeout=5.0)
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_record_confirms_after_real_growth(tmp_path: Path) -> None:
    output = tmp_path / "seg.ts"
    supervisor = ProcessSupervisor()
    process = await supervisor.start(_spec(f"grow:{output}"), "health:grow")
    try:
        confirmer = HealthConfirmer(poll_interval=0.05)
        await confirmer.confirm(
            process, is_record=True, output_path=str(output), timeout=5.0, min_sample_separation=0.25
        )
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_real_hang_child_times_out() -> None:
    supervisor = ProcessSupervisor()
    process = await supervisor.start(_spec("hang"), "health:hang")
    try:
        confirmer = HealthConfirmer(poll_interval=0.02)
        with pytest.raises(ConfirmTimeout):
            await confirmer.confirm(process, is_record=False, timeout=0.2)
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_real_error_child_raises_element_error() -> None:
    supervisor = ProcessSupervisor()
    process = await supervisor.start(_spec("error"), "health:error")
    try:
        confirmer = HealthConfirmer()
        with pytest.raises(ElementError):
            await confirmer.confirm(process, is_record=False, timeout=5.0)
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)

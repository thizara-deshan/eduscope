from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from pipeline_manager.pipelines.builder import PipelineSpec
from pipeline_manager.supervisor.process import ProcessSupervisor, classify_line

FAKE_CHILD = Path(__file__).resolve().parent / "fake_child.py"


def _spec(mode: str) -> PipelineSpec:
    argv = (sys.executable, str(FAKE_CHILD), mode)
    return PipelineSpec(argv=argv, required_roles=(), encode_slots=0, outputs=())


@dataclass
class _Call:
    args: tuple
    kwargs: dict


@dataclass
class SpyPopen:
    calls: list[_Call] = field(default_factory=list)

    def __call__(self, *args, **kwargs) -> subprocess.Popen:
        self.calls.append(_Call(args=args, kwargs=kwargs))
        return subprocess.Popen(*args, **kwargs)


def test_classify_line() -> None:
    assert classify_line("PLAYING") == "PLAYING"
    assert classify_line("bus: state PLAYING reached") == "PLAYING"
    assert classify_line("Got EOS") == "EOS"
    assert classify_line("ERROR: element foo") == "ERROR"
    assert classify_line("QOS: dropped=3") == "QOS"
    assert classify_line("some other diagnostic line") is None
    assert classify_line("") is None


@pytest.mark.asyncio
async def test_popen_called_with_shell_false() -> None:
    spy = SpyPopen()
    supervisor = ProcessSupervisor(popen=spy)
    process = await supervisor.start(_spec("playing"), "test:shell-false")
    try:
        assert spy.calls[0].kwargs["shell"] is False
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_popen_called_with_start_new_session_true() -> None:
    spy = SpyPopen()
    supervisor = ProcessSupervisor(popen=spy)
    process = await supervisor.start(_spec("playing"), "test:new-session")
    try:
        assert spy.calls[0].kwargs["start_new_session"] is True
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_popen_called_with_list_argv_not_a_string() -> None:
    spy = SpyPopen()
    supervisor = ProcessSupervisor(popen=spy)
    process = await supervisor.start(_spec("playing"), "test:list-argv")
    try:
        argv = spy.calls[0].args[0]
        assert isinstance(argv, list)
        assert not isinstance(argv, str)
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_managed_process_captures_pid_and_pgid() -> None:
    supervisor = ProcessSupervisor()
    process = await supervisor.start(_spec("playing"), "test:pid")
    try:
        assert process.pid == process.popen.pid
        assert process.pgid is not None
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_playing_observation_is_parsed_from_real_child() -> None:
    supervisor = ProcessSupervisor()
    process = await supervisor.start(_spec("playing"), "test:playing-obs")
    try:
        observation = await process.observations.get()
        assert observation.kind == "PLAYING"
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_error_observation_is_parsed_from_real_child() -> None:
    supervisor = ProcessSupervisor()
    process = await supervisor.start(_spec("error"), "test:error-obs")
    try:
        observation = await process.observations.get()
        assert observation.kind == "ERROR"
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)


@pytest.mark.asyncio
async def test_raw_lines_preserved_for_diagnostics() -> None:
    supervisor = ProcessSupervisor()
    process = await supervisor.start(_spec("qos"), "test:raw-lines")
    try:
        # Consume observations until at least one QOS line has been classified,
        # proving the raw buffer captured the underlying text too.
        for _ in range(4):
            await process.observations.get()
        assert any("QOS" in line for line in process.raw_lines)
    finally:
        process.popen.terminate()
        process.popen.wait(timeout=5)

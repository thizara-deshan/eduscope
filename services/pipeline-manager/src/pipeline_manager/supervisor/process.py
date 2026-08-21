from __future__ import annotations

import asyncio
import os
import subprocess
from dataclasses import dataclass, field
from typing import Callable, Literal

from ..pipelines.builder import PipelineSpec

ObservationKind = Literal["PLAYING", "EOS", "ERROR", "QOS"]

MAX_RAW_LINES = 100


@dataclass(frozen=True)
class Observation:
    kind: ObservationKind
    raw: str


def classify_line(line: str) -> ObservationKind | None:
    """Parse only normalized observations; everything else stays raw diagnostics."""
    stripped = line.strip()
    if not stripped:
        return None
    if "Got EOS" in stripped:
        return "EOS"
    if stripped.startswith("ERROR"):
        return "ERROR"
    if "PLAYING" in stripped:
        return "PLAYING"
    if stripped.startswith("QOS"):
        return "QOS"
    return None


@dataclass
class ManagedProcess:
    identity: str
    pid: int
    pgid: int
    popen: subprocess.Popen
    observations: "asyncio.Queue[Observation]" = field(default_factory=asyncio.Queue)
    raw_lines: list[str] = field(default_factory=list)
    eos_seen: asyncio.Event = field(default_factory=asyncio.Event)
    # stdout/stderr reader futures (populated by `ProcessSupervisor.start`) so a
    # failed-start rollback can cancel them once the pipes are closed (A-REV-005).
    reader_futures: list = field(default_factory=list)


PopenFactory = Callable[..., subprocess.Popen]


class ProcessSupervisor:
    """Argv-only child ownership (rule: shell=False, never a shell string).

    `popen` is injected so tests can spy on the exact spawn arguments without
    depending on POSIX process-group behavior being available on the dev host.
    """

    def __init__(self, popen: PopenFactory = subprocess.Popen, max_raw_lines: int = MAX_RAW_LINES) -> None:
        self._popen = popen
        self._max_raw_lines = max_raw_lines
        self.processes: dict[str, ManagedProcess] = {}

    async def start(self, spec: PipelineSpec, identity: str) -> ManagedProcess:
        argv = list(spec.argv)
        popen = self._popen(
            argv,
            shell=False,
            start_new_session=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        pgid = os.getpgid(popen.pid) if hasattr(os, "getpgid") else popen.pid

        process = ManagedProcess(identity=identity, pid=popen.pid, pgid=pgid, popen=popen)
        self.processes[identity] = process

        loop = asyncio.get_running_loop()
        for stream in (popen.stdout, popen.stderr):
            if stream is not None:
                process.reader_futures.append(loop.run_in_executor(None, self._read_stream, stream, process, loop))

        return process

    def forget(self, identity: str) -> None:
        """Drop the registry entry for a child that has reached a terminal
        state (stopped, crashed, or rolled back after a failed confirm) — a
        dead identity must never linger and read as still-owned (A-REV-004/005).
        """
        self.processes.pop(identity, None)

    def _read_stream(self, stream, process: ManagedProcess, loop: asyncio.AbstractEventLoop) -> None:
        for line in iter(stream.readline, ""):
            if not line:
                break
            text = line.rstrip("\n")
            process.raw_lines.append(text)
            if len(process.raw_lines) > self._max_raw_lines:
                del process.raw_lines[: len(process.raw_lines) - self._max_raw_lines]
            kind = classify_line(text)
            if kind is not None:
                asyncio.run_coroutine_threadsafe(
                    process.observations.put(Observation(kind=kind, raw=text)), loop
                )
                if kind == "EOS":
                    loop.call_soon_threadsafe(process.eos_seen.set)

from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
import threading
import time
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

from ..pipelines.builder import PipelineSpec
from .recovery import Sidecar, SIDECAR_MARKER, argv_hash, real_proc_scanner, remove_sidecar, write_sidecar

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
    # Dedicated daemon readers avoid consuming asyncio's bounded default
    # executor for the entire lifetime of every stdout/stderr pipe.
    reader_threads: list[threading.Thread] = field(default_factory=list)


PopenFactory = Callable[..., subprocess.Popen]


class AdoptedPopen:
    """Duck-types the subset of `subprocess.Popen` the rest of this module
    relies on, for a pid this instance never forked and therefore can never
    `os.waitpid` on directly (A-REV-007). Liveness is polled via `os.kill(pid,
    0)` instead of reaped; no pipes exist to a process we didn't spawn, so
    stdin/stdout/stderr stay `None` (no reader threads, no EOS-line capture —
    a stop of an adopted child always falls through to the SIGKILL deadline).
    """

    def __init__(self, pid: int, poll_interval: float = 0.2) -> None:
        self.pid = pid
        self.returncode: int | None = None
        self.stdin = None
        self.stdout = None
        self.stderr = None
        self._poll_interval = poll_interval

    def _is_alive(self) -> bool:
        try:
            os.kill(self.pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True  # exists, just not signalable by us
        return True

    def poll(self) -> int | None:
        if self.returncode is None and not self._is_alive():
            self.returncode = 0  # the real exit code is unknowable for a non-child pid
        return self.returncode

    def wait(self, timeout: float | None = None) -> int:
        deadline = None if timeout is None else time.monotonic() + timeout
        while self.poll() is None:
            if deadline is not None and time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired(cmd=f"pid {self.pid}", timeout=timeout)
            time.sleep(self._poll_interval)
        return self.returncode

    def kill(self) -> None:
        with suppress(ProcessLookupError):
            os.kill(self.pid, getattr(signal, "SIGKILL", signal.SIGTERM))

    def terminate(self) -> None:
        with suppress(ProcessLookupError):
            os.kill(self.pid, signal.SIGTERM)


class ProcessSupervisor:
    """Argv-only child ownership (rule: shell=False, never a shell string).

    `popen` is injected so tests can spy on the exact spawn arguments without
    depending on POSIX process-group behavior being available on the dev host.
    `runtime_dir` is the sidecar-ownership seam (A-REV-007): `None` (the
    hermetic default, kept for every unit test and for `create_app` without a
    production factory) skips sidecar I/O entirely; a real path makes writing
    one at spawn and removing it at `forget()` part of owning a child, not a
    separate bolt-on step a caller can forget.
    """

    def __init__(
        self,
        popen: PopenFactory = subprocess.Popen,
        max_raw_lines: int = MAX_RAW_LINES,
        runtime_dir: Path | None = None,
    ) -> None:
        self._popen = popen
        self._max_raw_lines = max_raw_lines
        self._runtime_dir = runtime_dir
        self.processes: dict[str, ManagedProcess] = {}

    async def start(self, spec: PipelineSpec, identity: str) -> ManagedProcess:
        argv = list(spec.argv)
        # Test supervisors inject a fake Popen that deliberately consumes the
        # declarative gst argv.  Only the real subprocess boundary needs the
        # board worker wrapper.
        if spec.resilient_roles and self._popen is subprocess.Popen:
            argv = [
                sys.executable,
                "-m",
                "pipeline_manager.pipelines.resilient_record",
                "--graph",
                " ".join(argv[3:]),
                "--roles",
                json.dumps([role.value for role in spec.resilient_roles]),
            ]
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
                reader = threading.Thread(
                    target=self._read_stream,
                    args=(stream, process, loop),
                    daemon=True,
                    name=f"pm-pipe-{identity}",
                )
                reader.start()
                process.reader_threads.append(reader)

        if tuple(argv) != spec.argv:
            from dataclasses import replace

            spec = replace(spec, argv=tuple(argv))
        self._write_sidecar(spec, process)
        return process

    def _write_sidecar(self, spec: PipelineSpec, process: ManagedProcess) -> None:
        if self._runtime_dir is None:
            return
        stat = real_proc_scanner(process.pid)
        if stat is None:
            return  # the child already exited between spawn and this read
        write_sidecar(
            self._runtime_dir,
            Sidecar(
                marker=SIDECAR_MARKER,
                identity=process.identity,
                pid=process.pid,
                pgid=process.pgid,
                argv_hash=argv_hash(spec.argv),
                kind=process.identity.split(":", 1)[0],
                output_path=spec.outputs[0] if spec.outputs else None,
                started_at_ms=int(time.time() * 1000),
                proc_start_ticks=stat.start_time_ticks,
            ),
        )

    def forget(self, identity: str) -> None:
        """Drop the registry entry for a child that has reached a terminal
        state (stopped, crashed, or rolled back after a failed confirm) — a
        dead identity must never linger and read as still-owned (A-REV-004/005).
        Also removes its sidecar, if any: ownership ending here is exactly
        the signal that identity is no longer a valid adoption candidate.
        """
        self.processes.pop(identity, None)
        if self._runtime_dir is not None:
            remove_sidecar(self._runtime_dir, identity)

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

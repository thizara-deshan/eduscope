from __future__ import annotations

import asyncio
import os
import signal
from collections import deque
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any

BLOCK_SIZE = 3200  # 100ms @ 16kHz mono S16LE (1600 samples * 2 bytes/sample)
TERMINATE_TIMEOUT_SECONDS = 3.0
MAX_STDERR_CHARS = 4000

# RK3588 production is POSIX-only and always has real SIGKILL; the fallback
# only lets this module import/execute on a non-POSIX dev host running tests.
SIGKILL = getattr(signal, "SIGKILL", signal.SIGTERM)

SubprocessExecFn = Callable[..., Awaitable[Any]]
SignalFn = Callable[[int, int], None]


def build_reader_argv(socket_path: str) -> tuple[str, ...]:
    return (
        "gst-launch-1.0", "-q",
        "shmsrc", f"socket-path={socket_path}", "is-live=true", "do-timestamp=true",
        "!", "audio/x-raw,format=S16LE,rate=48000,channels=2",
        "!", "audioconvert", "!", "audioresample",
        "!", "audio/x-raw,format=S16LE,rate=16000,channels=1",
        "!", "fdsink", "fd=1",
    )


def send_group_signal(pgid: int, sig: int) -> None:
    """Targeted signal to exactly one process group — never a broad-pattern
    process-kill tool or a shell."""
    if hasattr(os, "killpg"):
        os.killpg(pgid, sig)
    else:
        os.kill(pgid, sig)


class DropOldestPcmRing:
    """Bounded ring of fixed-size PCM blocks between the reader and the
    recognizer loop. `push` never waits for a consumer: past capacity it
    drops the oldest block rather than block the producer (the prototype's
    unbounded-queue OOM must not recur)."""

    def __init__(self, max_blocks: int = 600) -> None:
        self.max_blocks = max_blocks
        self._blocks: deque[bytes] = deque()
        self.dropped_blocks = 0
        self._data_available = asyncio.Event()

    def push(self, block: bytes) -> None:
        if len(self._blocks) >= self.max_blocks:
            self._blocks.popleft()
            self.dropped_blocks += 1
        self._blocks.append(block)
        self._data_available.set()

    def pop_nowait(self) -> bytes | None:
        if not self._blocks:
            return None
        return self._blocks.popleft()

    async def get(self) -> bytes:
        while not self._blocks:
            await self._data_available.wait()
            self._data_available.clear()
        return self._blocks.popleft()

    def __len__(self) -> int:
        return len(self._blocks)


class GstShmReader:
    """Argv-only shm reader child (§1.1): spawns the gst-launch-1.0 pipeline
    that downmixes/resamples pipeline-manager's 48kHz stereo publisher into
    16kHz mono S16LE, and pushes each 3,200-byte block into the ring. Never
    opens ALSA, calls the LLM, or back-pressures the publisher — this is a
    reader, never a pipeline owner.
    """

    max_stderr_chars = MAX_STDERR_CHARS

    def __init__(
        self,
        socket_path: str,
        ring: DropOldestPcmRing,
        *,
        subprocess_exec: SubprocessExecFn = asyncio.create_subprocess_exec,
        send_signal: SignalFn = send_group_signal,
        terminate_timeout: float = TERMINATE_TIMEOUT_SECONDS,
    ) -> None:
        self._socket_path = socket_path
        self._ring = ring
        self._subprocess_exec = subprocess_exec
        self._send_signal = send_signal
        self._terminate_timeout = terminate_timeout
        self._process: Any = None
        self._stdout_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None
        self.last_error: str = ""

    async def start(self) -> None:
        argv = build_reader_argv(self._socket_path)
        self._process = await self._subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        self._stdout_task = asyncio.create_task(self._read_stdout())
        self._stderr_task = asyncio.create_task(self._read_stderr())

    async def _read_stdout(self) -> None:
        stdout = self._process.stdout
        with suppress(asyncio.CancelledError):
            while True:
                try:
                    block = await stdout.readexactly(BLOCK_SIZE)
                except asyncio.IncompleteReadError:
                    return
                self._ring.push(block)

    async def _read_stderr(self) -> None:
        stderr = self._process.stderr
        buffer = bytearray()
        with suppress(asyncio.CancelledError):
            while True:
                chunk = await stderr.read(4096)
                if not chunk:
                    return
                buffer.extend(chunk)
                if len(buffer) > self.max_stderr_chars:
                    del buffer[: len(buffer) - self.max_stderr_chars]
                self.last_error = buffer.decode("utf-8", errors="replace")

    async def stop(self) -> None:
        process = self._process
        if process is None:
            return
        # `start_new_session=True` (setsid) makes the spawned child both
        # session leader and process-group leader, so its own pid is its pgid.
        pgid = process.pid
        with suppress(ProcessLookupError):
            self._send_signal(pgid, signal.SIGTERM)
        try:
            await asyncio.wait_for(process.wait(), timeout=self._terminate_timeout)
        except TimeoutError:
            with suppress(ProcessLookupError):
                self._send_signal(pgid, SIGKILL)
            await process.wait()

        for task in (self._stdout_task, self._stderr_task):
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        self._stdout_task = None
        self._stderr_task = None
        self._process = None

from __future__ import annotations

import asyncio
import signal

import pytest

from stt_service.reader import (
    BLOCK_SIZE,
    DropOldestPcmRing,
    GstShmReader,
    build_reader_argv,
)


def test_build_reader_argv_is_exact() -> None:
    assert build_reader_argv("/tmp/audio.sock") == (
        "gst-launch-1.0", "-q",
        "shmsrc", "socket-path=/tmp/audio.sock", "is-live=true", "do-timestamp=true",
        "!", "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved",
        "!", "audioconvert", "!", "audioresample",
        "!", "audio/x-raw,format=S16LE,rate=16000,channels=1",
        "!", "fdsink", "fd=1",
    )


def test_build_reader_argv_has_no_shell_tokens() -> None:
    argv = build_reader_argv("/tmp/audio.sock")
    forbidden = {"|", "&&", ";", ">", "<", "$(", "`"}
    joined = " ".join(argv)
    assert not any(token in joined for token in forbidden)


class FakeStreamReader:
    def __init__(self, chunks: list[bytes]) -> None:
        self._data = b"".join(chunks)
        self._offset = 0

    async def readexactly(self, n: int) -> bytes:
        remaining = len(self._data) - self._offset
        if remaining < n:
            partial = self._data[self._offset:]
            self._offset = len(self._data)
            raise asyncio.IncompleteReadError(partial, n)
        block = self._data[self._offset:self._offset + n]
        self._offset += n
        return block

    async def read(self, n: int = -1) -> bytes:
        if self._offset >= len(self._data):
            return b""
        end = len(self._data) if n < 0 else min(len(self._data), self._offset + n)
        chunk = self._data[self._offset:end]
        self._offset = end
        return chunk


class FakeProcess:
    """`hangs` models a child that ignores SIGTERM but dies immediately on
    SIGKILL — `kill_now()` is wired to a fake `send_signal` so tests never
    need a real multi-second sleep to observe the escalation."""

    def __init__(self, pid: int, stdout: FakeStreamReader, stderr: FakeStreamReader, *, hangs: bool = False) -> None:
        self.pid = pid
        self.stdout = stdout
        self.stderr = stderr
        self._hangs = hangs
        self._exited = asyncio.Event()
        if not hangs:
            self._exited.set()

    def kill_now(self) -> None:
        self._exited.set()

    async def wait(self) -> int:
        await self._exited.wait()
        return 0


def make_subprocess_exec(process: FakeProcess, calls: list):
    async def fake_exec(*argv, **kwargs):
        calls.append((argv, kwargs))
        return process

    return fake_exec


class TestDropOldestPcmRing:
    def test_drop_oldest_after_capacity(self) -> None:
        ring = DropOldestPcmRing(max_blocks=600)
        for i in range(601):
            ring.push(i.to_bytes(4, "big"))

        assert ring.dropped_blocks == 1
        assert len(ring) == 600

        collected = []
        while len(ring):
            collected.append(int.from_bytes(ring.pop_nowait(), "big"))

        assert collected == list(range(1, 601))

    def test_push_never_waits_for_consumer(self) -> None:
        ring = DropOldestPcmRing(max_blocks=2)
        # A plain (non-async) call proves push() cannot itself await a consumer.
        ring.push(b"a")
        ring.push(b"b")
        ring.push(b"c")
        assert ring.dropped_blocks == 1
        assert len(ring) == 2


class TestGstShmReader:
    async def test_start_spawns_via_injected_subprocess_exec(self) -> None:
        argv = build_reader_argv("/tmp/audio.sock")
        process = FakeProcess(4321, FakeStreamReader([]), FakeStreamReader([]))
        calls: list = []
        ring = DropOldestPcmRing()
        reader = GstShmReader("/tmp/audio.sock", ring, subprocess_exec=make_subprocess_exec(process, calls))

        await reader.start()
        await reader.stop()

        assert len(calls) == 1
        called_argv, kwargs = calls[0]
        assert called_argv == argv
        assert kwargs["stdout"] == asyncio.subprocess.PIPE
        assert kwargs["stderr"] == asyncio.subprocess.PIPE
        assert kwargs["start_new_session"] is True

    async def test_reads_exact_blocks_into_ring(self) -> None:
        blocks = [bytes([n % 256]) * BLOCK_SIZE for n in range(5)]
        process = FakeProcess(1111, FakeStreamReader(blocks), FakeStreamReader([]))
        ring = DropOldestPcmRing()
        reader = GstShmReader("/tmp/audio.sock", ring, subprocess_exec=make_subprocess_exec(process, []))

        await reader.start()
        for expected in blocks:
            got = await asyncio.wait_for(ring.get(), timeout=1)
            assert got == expected
        await reader.stop()

    async def test_stop_sends_sigterm_and_no_sigkill_on_quick_exit(self) -> None:
        process = FakeProcess(2222, FakeStreamReader([]), FakeStreamReader([]))
        signals: list[tuple[int, int]] = []
        ring = DropOldestPcmRing()
        reader = GstShmReader(
            "/tmp/audio.sock", ring,
            subprocess_exec=make_subprocess_exec(process, []),
            send_signal=lambda pgid, sig: signals.append((pgid, sig)),
            terminate_timeout=1.0,
        )

        await reader.start()
        await reader.stop()

        assert signals == [(2222, signal.SIGTERM)]

    async def test_stop_escalates_to_sigkill_after_timeout(self) -> None:
        process = FakeProcess(3333, FakeStreamReader([]), FakeStreamReader([]), hangs=True)
        signals: list[tuple[int, int]] = []

        def fake_send_signal(pgid: int, sig: int) -> None:
            signals.append((pgid, sig))
            if sig == signal.SIGKILL:
                process.kill_now()

        ring = DropOldestPcmRing()
        reader = GstShmReader(
            "/tmp/audio.sock", ring,
            subprocess_exec=make_subprocess_exec(process, []),
            send_signal=fake_send_signal,
            terminate_timeout=0.01,
        )

        await reader.start()
        await reader.stop()

        assert signals == [(3333, signal.SIGTERM), (3333, signal.SIGKILL)]

    async def test_stderr_is_bounded_and_drained(self) -> None:
        chunk = b"warning line\n" * 500  # far larger than the bounded buffer
        process = FakeProcess(4444, FakeStreamReader([]), FakeStreamReader([chunk]))
        ring = DropOldestPcmRing()
        reader = GstShmReader("/tmp/audio.sock", ring, subprocess_exec=make_subprocess_exec(process, []))

        await reader.start()
        await asyncio.sleep(0.05)
        await reader.stop()

        assert len(reader.last_error) <= reader.max_stderr_chars
        assert "warning line" in reader.last_error

    async def test_no_shell_api_is_referenced(self) -> None:
        import stt_service.reader as reader_module
        source = reader_module.__file__
        with open(source, encoding="utf-8") as fh:
            text = fh.read()
        for forbidden in ("shell=True", "create_subprocess_shell", "sudo", "pkill", "killall"):
            assert forbidden not in text

from __future__ import annotations

import asyncio
import re
import time
from contextlib import suppress
from typing import Awaitable, Callable, Sequence

from ..models import AudioLevelSample, SourceRole

MIN_SAMPLE_PERIOD_SECONDS = 0.1  # caps the sampler at <=10 Hz


class AudioLevelSampler:
    """One sampler task, monotonic 100 ms minimum period. Reads the
    publisher's existing meter tap — it never opens a second ALSA capture
    device. Reference-counted: emits `{roleId, rms}` only while the
    subscriber count is > 0 (subscribe/unsubscribe via the async context).
    """

    def __init__(
        self,
        read_rms: Callable[[], float],
        *,
        role: SourceRole = SourceRole.MIC_LECTURER,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        min_period: float = MIN_SAMPLE_PERIOD_SECONDS,
    ) -> None:
        self._read_rms = read_rms
        self.role = role
        self._clock = clock
        self._sleep = sleep
        self._min_period = min_period
        self._subscribers = 0
        self._task: asyncio.Task | None = None
        self.emitted: list[AudioLevelSample] = []
        self._listeners: list[Callable[[AudioLevelSample], None]] = []

    @property
    def subscriber_count(self) -> int:
        return self._subscribers

    def add_listener(self, listener: Callable[[AudioLevelSample], None]) -> None:
        self._listeners.append(listener)

    async def __aenter__(self) -> "AudioLevelSampler":
        self._subscribers += 1
        if self._subscribers == 1 and self._task is None:
            self._task = asyncio.ensure_future(self._run())
        return self

    async def __aexit__(self, *exc_info) -> None:
        self._subscribers = max(0, self._subscribers - 1)
        if self._subscribers == 0 and self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def drain(self) -> None:
        """Force every subscriber off and stop the sampler task (A-REV-012)
        — called on app shutdown so an open `/audio/levels/subscriptions`
        entry never leaks the background task past process lifetime. Safe
        to call with zero subscribers (idempotent, matches `__aexit__`)."""
        self._subscribers = 0
        if self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self) -> None:
        last_sample_at = self._clock() - self._min_period
        while self._subscribers > 0:
            now = self._clock()
            wait = self._min_period - (now - last_sample_at)
            if wait > 0:
                await self._sleep(wait)
            if self._subscribers <= 0:
                return
            last_sample_at = self._clock()
            raw_rms = self._read_rms()
            normalized = max(0.0, min(1.0, raw_rms))
            sample = AudioLevelSample(role_id=self.role, rms=normalized)
            self.emitted.append(sample)
            for listener in self._listeners:
                listener(sample)


_NUM = rb"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|-?inf"
# GStreamer serializes level RMS as GstValueList `{ ... }`, GstValueArray
# `< ... >`, or a scalar depending on the installed version/plugins.  An
# optional type annotation can name a scalar type or the container itself.
_RMS_LIST = re.compile(rb"rms=(?:\([^)]*\))?\s*[{<]([^}>]*)[}>]")
_RMS_SCALAR = re.compile(rb"rms=(?:\([^)]*\))?\s*(" + _NUM + rb")")
_LEVEL_ELEMENT = re.compile(
    rb'(?:GstLevel:|from element ["\'])(lvl_mic_(?:lecturer|room))'
)
_ELEMENT_ROLES = {
    b"lvl_mic_lecturer": SourceRole.MIC_LECTURER,
    b"lvl_mic_room": SourceRole.MIC_ROOM,
}
LEVEL_TAP_INTERVAL_NS = 100_000_000  # matches MIN_SAMPLE_PERIOD_SECONDS (10 Hz)
LEVEL_TAP_RECONNECT_SECONDS = 0.5


def _parse_latest_rms(line: bytes) -> float | None:
    """Return first-channel RMS dBFS from a ``gst-launch -m`` level line."""
    match = _RMS_LIST.search(line)
    if match:
        numbers = re.findall(_NUM, match.group(1))
        return float(numbers[0]) if numbers else None
    scalar_match = _RMS_SCALAR.search(line)
    return float(scalar_match.group(1)) if scalar_match else None


def _rms_db_to_linear(db: float) -> float:
    """GStreamer's `level` element reports RMS in dBFS (<=0 dB); convert to
    the 0..1 linear scale `AudioLevelSample.rms` expects, clamped both ends
    (a post-clip signal can read slightly above 0 dB)."""
    return max(0.0, min(1.0, 10 ** (db / 20.0)))


def build_level_tap_argv(socket_path: str, *, interval_ns: int = LEVEL_TAP_INTERVAL_NS) -> tuple[str, ...]:
    """Argv-only subprocess that taps the audio publisher's *own* shm ring
    with a `level` element (A-REV-012) — it never opens a second ALSA
    capture device, the same shm socket every other audio consumer reads
    from. `-m` puts `level`'s periodic bus posts on stdout, the meter tap's
    only signaling channel."""
    return (
        "gst-launch-1.0", "-m",
        "shmsrc", f"socket-path={socket_path}", "is-live=true", "do-timestamp=true", "!",
        "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved", "!",
        "level", f"interval={interval_ns}", "!",
        "fakesink", "sync=false",
    )


class GstLevelMeterTap:
    """The real `read_rms` source for `AudioLevelSampler` (A-REV-012): a
    long-lived argv-only subprocess whose stdout carries periodic `level`
    bus lines, parsed for the latest RMS. Runs independently of subscriber
    count — the sampler's own <=10 Hz cadence is a *read* cadence over
    whatever this tap last observed, not something the tap needs to match
    tick-for-tick.
    """

    def __init__(
        self,
        socket_path: str,
        *,
        spawn: Callable[[Sequence[str]], Awaitable["asyncio.subprocess.Process"]] | None = None,
        reconnect_delay: float = LEVEL_TAP_RECONNECT_SECONDS,
    ) -> None:
        self._argv = build_level_tap_argv(socket_path)
        self._spawn = spawn or self._default_spawn
        self._reconnect_delay = reconnect_delay
        self._process: "asyncio.subprocess.Process | None" = None
        self._reader_task: asyncio.Task | None = None
        self._latest_rms = {
            SourceRole.MIC_LECTURER: 0.0,
            SourceRole.MIC_ROOM: 0.0,
        }
        self._stopping = False

    @staticmethod
    async def _default_spawn(argv: Sequence[str]) -> "asyncio.subprocess.Process":
        return await asyncio.create_subprocess_exec(
            *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )

    def read_rms(self, role: SourceRole = SourceRole.MIC_LECTURER) -> float:
        return self._latest_rms[role]

    def observe_line(self, line: bytes | str) -> None:
        """Consume a publisher ``gst-launch -m`` line and retain role RMS."""
        encoded = line.encode() if isinstance(line, str) else line
        db = _parse_latest_rms(encoded)
        if db is None:
            return
        element = _LEVEL_ELEMENT.search(encoded)
        role = _ELEMENT_ROLES.get(element.group(1)) if element else SourceRole.MIC_LECTURER
        if role is not None:
            self._latest_rms[role] = _rms_db_to_linear(db)

    async def start(self) -> None:
        if self._process is not None:
            return
        self._stopping = False
        self._process = await self._spawn(self._argv)
        self._reader_task = asyncio.ensure_future(self._read_loop())

    async def _read_loop(self) -> None:
        while not self._stopping:
            process = self._process
            assert process is not None and process.stdout is not None
            line = await process.stdout.readline()
            if line:
                self.observe_line(line)
                continue

            # A shm reader gets EOF when core-api rebinds/restarts the audio
            # publisher and replaces /tmp/audio.sock. Keep the meter attached
            # across that normal startup/recovery race instead of silently
            # leaving the panel flat until pipeline-manager itself restarts.
            await process.wait()
            if self._stopping:
                return
            await asyncio.sleep(self._reconnect_delay)
            if not self._stopping:
                self._process = await self._spawn(self._argv)

    async def stop(self) -> None:
        self._stopping = True
        if self._reader_task is not None:
            self._reader_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._reader_task
            self._reader_task = None
        if self._process is not None:
            with suppress(ProcessLookupError):
                self._process.terminate()
            with suppress(Exception):
                await self._process.wait()
            self._process = None

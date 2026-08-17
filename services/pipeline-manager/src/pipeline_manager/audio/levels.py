from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

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

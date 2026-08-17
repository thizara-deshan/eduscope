from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Callable

from .process import ManagedProcess

DEFAULT_START_CONFIRM_TIMEOUT = 5.0
DEFAULT_MIN_SAMPLE_SEPARATION = 0.25


class ConfirmTimeout(TimeoutError):
    pass


class ElementError(RuntimeError):
    def __init__(self, raw: str) -> None:
        super().__init__(raw)
        self.raw = raw


def _default_stat_size(path: str) -> int:
    try:
        return os.stat(path).st_size
    except FileNotFoundError:
        return 0


@dataclass
class HealthConfirmer:
    """A child is never exposed as `running` before confirmation:
    non-file consumers confirm on PLAYING alone; `record` additionally needs
    the target file to grow across two samples at least `min_sample_separation`
    apart (G-CONSUMER-CONFIRMED).
    """

    clock: Callable[[], float] = field(default=time.monotonic)
    stat_size: Callable[[str], int] = field(default=_default_stat_size)
    poll_interval: float = 0.05

    async def confirm(
        self,
        process: ManagedProcess,
        *,
        is_record: bool,
        output_path: str | None = None,
        timeout: float = DEFAULT_START_CONFIRM_TIMEOUT,
        min_sample_separation: float = DEFAULT_MIN_SAMPLE_SEPARATION,
    ) -> None:
        deadline = self.clock() + timeout
        await self._await_playing(process, deadline)
        if is_record:
            if not output_path:
                raise ValueError("record confirmation requires output_path")
            await self._await_growth(output_path, deadline, min_sample_separation)

    async def _await_playing(self, process: ManagedProcess, deadline: float) -> None:
        while True:
            remaining = deadline - self.clock()
            if remaining <= 0:
                raise ConfirmTimeout("no PLAYING observation before T-START-CONFIRM")
            try:
                observation = await asyncio.wait_for(process.observations.get(), timeout=remaining)
            except asyncio.TimeoutError as exc:
                raise ConfirmTimeout("no PLAYING observation before T-START-CONFIRM") from exc
            if observation.kind == "ERROR":
                raise ElementError(observation.raw)
            if observation.kind == "PLAYING":
                return

    async def _await_growth(self, output_path: str, deadline: float, min_sample_separation: float) -> None:
        baseline_size = self.stat_size(output_path)
        baseline_time = self.clock()
        while True:
            remaining = deadline - self.clock()
            if remaining <= 0:
                raise ConfirmTimeout("file did not grow across two samples before T-START-CONFIRM")
            await asyncio.sleep(min(self.poll_interval, max(remaining, 0)))
            now = self.clock()
            if now - baseline_time < min_sample_separation:
                continue
            size = self.stat_size(output_path)
            if size > baseline_size:
                return
            baseline_size, baseline_time = size, now

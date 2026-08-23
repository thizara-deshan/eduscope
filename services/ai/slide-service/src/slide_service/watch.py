from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import watchfiles
from PIL import Image, UnidentifiedImageError

AwatchFn = Callable[..., Any]
SleepFn = Callable[[float], Awaitable[None]]


class SnapshotWatcher:
    """Watches one atomically-replaced PNG (A publishes it via `os.replace`)
    and yields the target path whenever a *new* valid image lands. Watches
    the parent directory, not the file itself, because a replace swaps the
    directory entry rather than mutating the old inode in place.

    Falls back to an injected-clock one-second stat loop when the
    `watchfiles.awatch` backend fails to start (e.g. an exhausted inotify
    instance limit) — the fallback is chosen once, at startup, not on a
    later mid-stream watch error.
    """

    def __init__(
        self,
        target: Path,
        *,
        poll_interval: float = 1.0,
        awatch: AwatchFn = watchfiles.awatch,
        force_polling: bool | None = None,
        sleep: SleepFn = asyncio.sleep,
    ) -> None:
        self._target = target
        self._poll_interval = poll_interval
        self._awatch = awatch
        self._force_polling = force_polling
        self._sleep = sleep
        self._last_seen: tuple[int, int] | None = None  # (mtime_ns, size)

    async def frames(self) -> AsyncIterator[Path]:
        watch_started = False
        try:
            async for _changes in self._awatch(self._target.parent, force_polling=self._force_polling):
                watch_started = True
                frame = self._check_and_record()
                if frame is not None:
                    yield frame
        except OSError:
            if watch_started:
                raise
            async for frame in self._poll():
                yield frame

    async def _poll(self) -> AsyncIterator[Path]:
        while True:
            frame = self._check_and_record()
            if frame is not None:
                yield frame
            await self._sleep(self._poll_interval)

    def _check_and_record(self) -> Path | None:
        try:
            stat = self._target.stat()
        except OSError:
            return None
        if stat.st_size == 0:
            return None
        marker = (stat.st_mtime_ns, stat.st_size)
        if marker == self._last_seen:
            return None
        if not self._verify_png(self._target):
            return None
        self._last_seen = marker
        return self._target

    @staticmethod
    def _verify_png(path: Path) -> bool:
        try:
            with Image.open(path) as image:
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError):
            return False
        return True

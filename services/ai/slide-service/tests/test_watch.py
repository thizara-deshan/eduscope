from __future__ import annotations

import asyncio
from contextlib import suppress
from pathlib import Path

from slide_service.watch import SnapshotWatcher

from fixtures.slides import make_corrupt_png, make_slide, make_zero_byte_png


class FakeAwatchOSError:
    """`awatch` replacement whose first iteration raises `OSError`,
    simulating a watch backend that fails to start (e.g. an inotify instance
    limit) so `SnapshotWatcher` must fall back to polling."""

    def __call__(self, *_args, **_kwargs) -> "FakeAwatchOSError":
        return self

    def __aiter__(self) -> "FakeAwatchOSError":
        return self

    async def __anext__(self):
        raise OSError("inotify watch limit reached")


class FakeAwatch:
    """`awatch` replacement driven by an externally-triggered event per
    emitted change batch, standing in for `watchfiles.awatch`."""

    def __init__(self) -> None:
        self._pending: list[set] = []
        self._signal = asyncio.Event()
        self.calls: list[tuple[tuple, dict]] = []

    def trigger(self) -> None:
        self._pending.append({("modified", "irrelevant")})
        self._signal.set()

    def __call__(self, *args, **kwargs) -> "FakeAwatch":
        self.calls.append((args, kwargs))
        return self

    def __aiter__(self) -> "FakeAwatch":
        return self

    async def __anext__(self):
        while not self._pending:
            await self._signal.wait()
            self._signal.clear()
        return self._pending.pop(0)


async def _collect_n(watcher: SnapshotWatcher, n: int) -> list[Path]:
    seen: list[Path] = []
    gen = watcher.frames()
    try:
        async for frame in gen:
            seen.append(frame)
            if len(seen) >= n:
                return seen
    finally:
        await gen.aclose()
    return seen


class TestAtomicReplace:
    async def test_atomic_rename_triggers_one_observation(self, tmp_path: Path) -> None:
        target = tmp_path / "current.png"
        staged = tmp_path / "current.png.tmp"
        make_slide(staged, title="Title Slide")

        fake_awatch = FakeAwatch()
        watcher = SnapshotWatcher(target, awatch=fake_awatch)

        task = asyncio.create_task(_collect_n(watcher, 1))
        await asyncio.sleep(0)
        staged.replace(target)
        fake_awatch.trigger()

        seen = await asyncio.wait_for(task, timeout=2.0)
        assert seen == [target]

    async def test_duplicate_mtime_and_content_is_ignored(self, tmp_path: Path) -> None:
        target = tmp_path / "current.png"
        make_slide(target, title="Title Slide")

        fake_awatch = FakeAwatch()
        watcher = SnapshotWatcher(target, awatch=fake_awatch)

        seen: list[Path] = []

        async def collect() -> None:
            async for frame in watcher.frames():
                seen.append(frame)

        task = asyncio.create_task(collect())
        await asyncio.sleep(0)

        fake_awatch.trigger()  # first observation of the already-existing file
        await asyncio.sleep(0.05)
        fake_awatch.trigger()  # nothing changed on disk — same (mtime_ns, size)
        await asyncio.sleep(0.05)

        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

        assert seen == [target]

    async def test_corrupt_and_zero_byte_pngs_are_skipped(self, tmp_path: Path) -> None:
        target = tmp_path / "current.png"
        make_corrupt_png(target)

        fake_awatch = FakeAwatch()
        watcher = SnapshotWatcher(target, awatch=fake_awatch)

        seen: list[Path] = []

        async def collect() -> None:
            async for frame in watcher.frames():
                seen.append(frame)

        task = asyncio.create_task(collect())
        await asyncio.sleep(0)
        fake_awatch.trigger()
        await asyncio.sleep(0.05)

        make_zero_byte_png(target)
        fake_awatch.trigger()
        await asyncio.sleep(0.05)

        make_slide(target, title="Valid At Last")
        fake_awatch.trigger()
        await asyncio.sleep(0.05)

        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

        assert seen == [target]


class TestPollFallback:
    async def test_watch_startup_oserror_switches_to_poll(self, tmp_path: Path) -> None:
        target = tmp_path / "current.png"
        make_slide(target, title="Frame 1")

        sleeps: list[float] = []

        async def fake_sleep(delay: float) -> None:
            sleeps.append(delay)
            if len(sleeps) == 1:
                make_slide(target, title="Frame 2")
            await asyncio.sleep(0)

        watcher = SnapshotWatcher(
            target, awatch=FakeAwatchOSError(), poll_interval=1.0, sleep=fake_sleep
        )

        # first observation (the pre-existing file) is immediate; the second
        # requires a poll tick — proving the fallback loop actually polls.
        seen = await asyncio.wait_for(_collect_n(watcher, 2), timeout=2.0)
        assert seen == [target, target]
        assert sleeps and all(delay == 1.0 for delay in sleeps)

    async def test_inotify_and_poll_fallback_converge(self, tmp_path: Path) -> None:
        target = tmp_path / "current.png"
        make_slide(target, title="Frame 1")

        fake_awatch = FakeAwatch()
        watch_watcher = SnapshotWatcher(target, awatch=fake_awatch)

        async def fake_sleep(delay: float) -> None:
            await asyncio.sleep(0)

        poll_watcher = SnapshotWatcher(
            target, awatch=FakeAwatchOSError(), poll_interval=1.0, sleep=fake_sleep
        )

        watch_task = asyncio.create_task(_collect_n(watch_watcher, 2))
        poll_task = asyncio.create_task(_collect_n(poll_watcher, 2))
        await asyncio.sleep(0)

        fake_awatch.trigger()  # initial Frame 1 observation
        await asyncio.sleep(0.05)

        make_slide(target, title="Frame 2")
        fake_awatch.trigger()

        watch_seen = await asyncio.wait_for(watch_task, timeout=2.0)
        poll_seen = await asyncio.wait_for(poll_task, timeout=2.0)

        assert watch_seen == [target, target]
        assert poll_seen == [target, target]


class TestCancellation:
    async def test_cancellation_stops_within_one_tick(self, tmp_path: Path) -> None:
        target = tmp_path / "current.png"
        make_slide(target, title="Frame 1")
        fake_awatch = FakeAwatch()
        watcher = SnapshotWatcher(target, awatch=fake_awatch)

        async def consume() -> None:
            async for _ in watcher.frames():
                pass

        task = asyncio.create_task(consume())
        await asyncio.sleep(0)
        task.cancel()

        async with asyncio.timeout(1.0):
            with suppress(asyncio.CancelledError):
                await task
        assert task.done()

    async def test_watches_the_parent_directory(self, tmp_path: Path) -> None:
        target = tmp_path / "sub" / "current.png"
        fake_awatch = FakeAwatch()
        watcher = SnapshotWatcher(target, awatch=fake_awatch)

        task = asyncio.create_task(_collect_n(watcher, 1))
        await asyncio.sleep(0)
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

        assert fake_awatch.calls
        args, _kwargs = fake_awatch.calls[0]
        assert args[0] == target.parent

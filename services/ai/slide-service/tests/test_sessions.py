from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from slide_service.events import SlideCapturedEvent
from slide_service.sessions import (
    InvalidSlidePathError,
    ResumeSlideSessionRequest,
    SessionActiveError,
    SessionNotFoundError,
    SlideSessionController,
    SlideStatus,
    StartSlideSessionRequest,
)

from fixtures.slides import make_slide

RUNTIME_ROOT = Path("/run/eduscope")
RECORDINGS_ROOT = Path("/media/eduscope/recordings")
SESSION = "01J00000000000000000000000"
SOURCE = RUNTIME_ROOT / "slides" / SESSION / "current.png"
IMAGE_DIR = RECORDINGS_ROOT / "sessions" / SESSION / "slides"


def _distinct_frame(path: Path, index: int) -> None:
    """pHash is a structural (DCT-based) measure, largely insensitive to a
    flat background's raw luminance — consecutive frames must differ in
    text layout/amount, not just color, to reliably exceed the threshold."""
    make_slide(
        path,
        title=f"Slide {index}",
        lines=[f"Distinct content block {index} filler line {n}" for n in range(2 + index)],
        bg=(255, 255, 255) if index % 2 == 0 else (0, 0, 0),
    )


class FakeWatcher:
    """Driven externally by pushing paths onto a queue, standing in for
    `SnapshotWatcher`. A `RuntimeError` sentinel simulates a dead watcher."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[Path | None | Exception] = asyncio.Queue()

    def push(self, path: Path) -> None:
        self._queue.put_nowait(path)

    def crash(self, exc: Exception) -> None:
        self._queue.put_nowait(exc)

    async def frames(self) -> AsyncIterator[Path]:
        while True:
            item = await self._queue.get()
            if item is None:
                return
            if isinstance(item, Exception):
                raise item
            yield item


class RecordingBroker:
    def __init__(self) -> None:
        self.events: list[tuple[str, object]] = []

    def publish(self, event: str, payload: object) -> int:
        self.events.append((event, payload))
        return len(self.events)


class ScriptedOcrEngine:
    def __init__(self, default: str | None = "default text") -> None:
        self._default = default
        self.calls: list[Path] = []

    async def extract(self, path: Path) -> str | None:
        self.calls.append(path)
        return self._default


class SteppedClock:
    def __init__(self, start: datetime) -> None:
        self._now = start

    def __call__(self) -> datetime:
        return self._now

    def advance(self, ms: int) -> None:
        self._now = self._now + timedelta(milliseconds=ms)


def make_controller(
    *,
    broker=None,
    ocr_engine=None,
    clock=None,
    ocr_queue_size: int = 4,
    threshold: int = 10,
    runtime_root: Path = RUNTIME_ROOT,
    recordings_root: Path = RECORDINGS_ROOT,
):
    watcher_holder: dict[str, FakeWatcher] = {}

    def watcher_factory(source_path: Path) -> FakeWatcher:
        watcher = FakeWatcher()
        watcher_holder["watcher"] = watcher
        return watcher

    controller = SlideSessionController(
        watcher_factory=watcher_factory,
        ocr_engine=ocr_engine or ScriptedOcrEngine(),
        broker=broker or RecordingBroker(),
        runtime_root=runtime_root,
        recordings_root=recordings_root,
        threshold=threshold,
        ocr_queue_size=ocr_queue_size,
        clock=clock or SteppedClock(datetime(2026, 8, 14, 9, 0, 0, tzinfo=UTC)),
    )
    return controller, watcher_holder


def _roots(tmp_path: Path) -> tuple[Path, Path]:
    """Real, writable roots for tests that exercise the actual capture
    pipeline (`atomic_copy` writes real files) — the literal production
    roots (`/run`, `/media`) are not writable in a hermetic test environment."""
    return tmp_path / "run" / "eduscope", tmp_path / "media" / "eduscope" / "recordings"


async def _settle() -> None:
    for _ in range(10):
        await asyncio.sleep(0)


async def _wait_for_events(broker: RecordingBroker, count: int, *, timeout: float = 2.0) -> None:
    async with asyncio.timeout(timeout):
        while len(broker.events) < count:
            await asyncio.sleep(0.01)


class TestPathValidation:
    async def test_wrong_source_path_is_rejected(self) -> None:
        controller, _ = make_controller()
        with pytest.raises(InvalidSlidePathError):
            await controller.start(SESSION, IMAGE_DIR, Path("/tmp/not-approved/current.png"), 0)

    async def test_wrong_image_dir_is_rejected(self) -> None:
        controller, _ = make_controller()
        with pytest.raises(InvalidSlidePathError):
            await controller.start(SESSION, Path("/tmp/not-approved"), SOURCE, 0)

    async def test_source_path_for_a_different_session_is_rejected(self) -> None:
        controller, _ = make_controller()
        other_source = RUNTIME_ROOT / "slides" / "other-session" / "current.png"
        with pytest.raises(InvalidSlidePathError):
            await controller.start(SESSION, IMAGE_DIR, other_source, 0)


class TestLifecycle:
    async def test_one_active_session_raises_session_active(self) -> None:
        controller, _ = make_controller()
        await controller.start(SESSION, IMAGE_DIR, SOURCE, 0)
        with pytest.raises(SessionActiveError) as exc_info:
            await controller.start("other-session", IMAGE_DIR, SOURCE, 0)
        assert exc_info.value.session_id == SESSION
        await controller.shutdown()

    async def test_same_session_start_is_idempotent(self) -> None:
        controller, _ = make_controller()
        await controller.start(SESSION, IMAGE_DIR, SOURCE, 0)
        await controller.start(SESSION, IMAGE_DIR, SOURCE, 5000)  # ignored, not applied
        assert controller.status().state == "watching"
        assert controller.status().sessionId == SESSION
        await controller.shutdown()

    async def test_resume_wrong_session_raises_not_found(self) -> None:
        controller, _ = make_controller()
        await controller.start(SESSION, IMAGE_DIR, SOURCE, 0)
        with pytest.raises(SessionNotFoundError):
            await controller.resume("other-session", 1000)
        await controller.shutdown()

    async def test_resume_with_no_active_session_raises_not_found(self) -> None:
        controller, _ = make_controller()
        with pytest.raises(SessionNotFoundError):
            await controller.resume(SESSION, 0)

    async def test_delete_is_idempotent_for_unknown_session(self) -> None:
        controller, _ = make_controller()
        await controller.delete("never-started")  # must not raise
        assert controller.status().state == "idle"

    async def test_delete_is_idempotent_when_called_twice(self, tmp_path: Path) -> None:
        controller, watcher_holder = make_controller()
        await controller.start(SESSION, IMAGE_DIR, SOURCE, 0)
        await controller.delete(SESSION)
        await controller.delete(SESSION)  # no error, no re-flush
        assert controller.status().state == "idle"

    async def test_fresh_process_status_is_idle(self) -> None:
        controller, _ = make_controller()
        status = controller.status()
        assert status.state == "idle"
        assert status.sessionId is None
        assert status.slideCount == 0
        assert status.ocrBacklog == 0

    async def test_repost_after_restart_recovers_cleanly(self) -> None:
        """Simulates B reconnecting after a process restart: a fresh
        controller (idle) accepts the same previously-active sessionId as an
        ordinary new start — no special-cased recovery path needed."""
        controller, _ = make_controller()
        await controller.start(SESSION, IMAGE_DIR, SOURCE, 10_000)
        assert controller.status().state == "watching"
        await controller.shutdown()


class TestCaptureSequence:
    async def test_distinct_slide_produces_one_capture_event(self, tmp_path: Path) -> None:
        runtime_root, recordings_root = _roots(tmp_path)
        source = runtime_root / "slides" / SESSION / "current.png"
        image_dir = recordings_root / "sessions" / SESSION / "slides"
        broker = RecordingBroker()
        ocr = ScriptedOcrEngine(default="Conservation of Energy")
        controller, watcher_holder = make_controller(
            broker=broker, ocr_engine=ocr, runtime_root=runtime_root, recordings_root=recordings_root
        )
        await controller.start(SESSION, image_dir, source, 1000)

        frame1 = tmp_path / "f1.png"
        make_slide(frame1, title="Title Slide")
        frame2 = tmp_path / "f2.png"
        make_slide(frame2, title="Second Slide", lines=["Totally different"] * 4, bg=(20, 20, 20))

        watcher_holder["watcher"].push(frame1)
        await _settle()
        watcher_holder["watcher"].push(frame2)
        await _wait_for_events(broker, 1)

        captured = [payload for name, payload in broker.events if name == "evt.slide.captured"]
        assert len(captured) == 1
        assert isinstance(captured[0], SlideCapturedEvent)
        assert captured[0].sessionId == SESSION
        assert captured[0].ocrText == "Conservation of Energy"
        assert captured[0].isSlideChange is True
        assert captured[0].imagePath == str(image_dir / "slide-001.png")
        await controller.shutdown()

    async def test_sequence_across_slides_allocates_increasing_ordinals(self, tmp_path: Path) -> None:
        runtime_root, recordings_root = _roots(tmp_path)
        source = runtime_root / "slides" / SESSION / "current.png"
        image_dir = recordings_root / "sessions" / SESSION / "slides"
        broker = RecordingBroker()
        controller, watcher_holder = make_controller(
            broker=broker, runtime_root=runtime_root, recordings_root=recordings_root
        )
        await controller.start(SESSION, image_dir, source, 0)

        frames = []
        for index in range(3):
            frame = tmp_path / f"slide-{index}.png"
            _distinct_frame(frame, index)
            frames.append(frame)

        for frame in frames:
            watcher_holder["watcher"].push(frame)
            await _settle()

        await controller.delete(SESSION)  # flushes the final pending candidate
        await _wait_for_events(broker, 3)

        captured = [payload for name, payload in broker.events if name == "evt.slide.captured"]
        assert len(captured) == 3
        assert [payload.imagePath for payload in captured] == [
            str(image_dir / "slide-001.png"),
            str(image_dir / "slide-002.png"),
            str(image_dir / "slide-003.png"),
        ]

    async def test_delete_flushes_final_pending_candidate_then_idle(self, tmp_path: Path) -> None:
        runtime_root, recordings_root = _roots(tmp_path)
        source = runtime_root / "slides" / SESSION / "current.png"
        image_dir = recordings_root / "sessions" / SESSION / "slides"
        broker = RecordingBroker()
        controller, watcher_holder = make_controller(
            broker=broker, runtime_root=runtime_root, recordings_root=recordings_root
        )
        await controller.start(SESSION, image_dir, source, 0)

        frame = tmp_path / "only.png"
        make_slide(frame, title="Only Slide")
        watcher_holder["watcher"].push(frame)
        await _settle()

        await controller.delete(SESSION)
        await _wait_for_events(broker, 1)

        captured = [payload for name, payload in broker.events if name == "evt.slide.captured"]
        assert len(captured) == 1
        status = controller.status()
        assert status.state == "idle"
        assert status.sessionId is None

    async def test_offset_uses_anchor_plus_elapsed_since_start(self, tmp_path: Path) -> None:
        runtime_root, recordings_root = _roots(tmp_path)
        source = runtime_root / "slides" / SESSION / "current.png"
        image_dir = recordings_root / "sessions" / SESSION / "slides"
        broker = RecordingBroker()
        clock = SteppedClock(datetime(2026, 8, 14, 9, 0, 0, tzinfo=UTC))
        controller, watcher_holder = make_controller(
            broker=broker, clock=clock, runtime_root=runtime_root, recordings_root=recordings_root
        )
        await controller.start(SESSION, image_dir, source, 5000)

        clock.advance(2000)
        frame1 = tmp_path / "f1.png"
        make_slide(frame1, title="Title Slide")
        watcher_holder["watcher"].push(frame1)
        await _settle()

        clock.advance(1000)
        frame2 = tmp_path / "f2.png"
        make_slide(frame2, title="Second Slide", lines=["Totally different"] * 4, bg=(20, 20, 20))
        watcher_holder["watcher"].push(frame2)
        await _wait_for_events(broker, 1)

        captured = [payload for name, payload in broker.events if name == "evt.slide.captured"]
        assert captured[0].offsetMs == 5000 + 2000  # anchor + elapsed at frame1's own observation
        await controller.shutdown()

    async def test_resume_rebases_offset_to_new_anchor(self, tmp_path: Path) -> None:
        runtime_root, recordings_root = _roots(tmp_path)
        source = runtime_root / "slides" / SESSION / "current.png"
        image_dir = recordings_root / "sessions" / SESSION / "slides"
        broker = RecordingBroker()
        clock = SteppedClock(datetime(2026, 8, 14, 9, 0, 0, tzinfo=UTC))
        controller, watcher_holder = make_controller(
            broker=broker, clock=clock, runtime_root=runtime_root, recordings_root=recordings_root
        )
        await controller.start(SESSION, image_dir, source, 0)
        await controller.resume(SESSION, 42_000)

        clock.advance(500)
        frame1 = tmp_path / "f1.png"
        make_slide(frame1, title="Title Slide")
        watcher_holder["watcher"].push(frame1)
        await _settle()

        clock.advance(500)
        frame2 = tmp_path / "f2.png"
        make_slide(frame2, title="Second Slide", lines=["Totally different"] * 4, bg=(20, 20, 20))
        watcher_holder["watcher"].push(frame2)
        await _wait_for_events(broker, 1)

        captured = [payload for name, payload in broker.events if name == "evt.slide.captured"]
        assert captured[0].offsetMs == 42_000 + 500
        await controller.shutdown()


class TestOcrBacklog:
    async def test_overflowing_queue_drops_oldest_without_ocr(self, tmp_path: Path) -> None:
        runtime_root, recordings_root = _roots(tmp_path)
        source = runtime_root / "slides" / SESSION / "current.png"
        image_dir = recordings_root / "sessions" / SESSION / "slides"
        broker = RecordingBroker()
        stall = asyncio.Event()

        class StallingOcr:
            async def extract(self, path: Path) -> str | None:
                await stall.wait()
                return "late text"

        controller, watcher_holder = make_controller(
            broker=broker,
            ocr_engine=StallingOcr(),
            ocr_queue_size=1,
            runtime_root=runtime_root,
            recordings_root=recordings_root,
        )
        await controller.start(SESSION, image_dir, source, 0)

        frames = []
        for index in range(4):
            frame = tmp_path / f"slide-{index}.png"
            _distinct_frame(frame, index)
            frames.append(frame)

        for frame in frames:
            watcher_holder["watcher"].push(frame)
            await _settle()

        # The worker is stuck OCR-ing the first finalized candidate; the
        # queue (size 1) can hold only one more before it must drop the
        # oldest still-queued (not yet OCR'd) candidate.
        await _wait_for_events(broker, 1)
        dropped = [payload for name, payload in broker.events if name == "evt.slide.captured"][0]
        assert dropped.ocrText is None

        status = controller.status()
        assert status.ocrBacklog <= 1

        stall.set()
        await controller.shutdown()


class TestHealth:
    async def test_idle_is_healthy(self) -> None:
        controller, _ = make_controller()
        assert controller.is_healthy() is True

    async def test_active_session_with_live_watch_is_healthy(self) -> None:
        controller, _ = make_controller()
        await controller.start(SESSION, IMAGE_DIR, SOURCE, 0)
        assert controller.is_healthy() is True
        await controller.shutdown()

    async def test_dead_watch_task_is_unhealthy(self) -> None:
        controller, watcher_holder = make_controller()
        await controller.start(SESSION, IMAGE_DIR, SOURCE, 0)
        watcher_holder["watcher"].crash(RuntimeError("watcher died"))
        await _settle()
        assert controller.is_healthy() is False
        await controller.shutdown()


class TestStrictModels:
    @pytest.mark.parametrize(
        "model,kwargs",
        [
            (
                StartSlideSessionRequest,
                {"sessionId": "s1", "imageDir": "/a", "sourcePath": "/b", "anchorOffsetMs": 0, "extra": "nope"},
            ),
            (ResumeSlideSessionRequest, {"anchorOffsetMs": 0, "extra": "nope"}),
            (
                SlideStatus,
                {
                    "state": "idle", "sessionId": None, "slideCount": 0,
                    "lastCaptureAt": None, "ocrBacklog": 0, "extra": "nope",
                },
            ),
            (
                SlideCapturedEvent,
                {
                    "sessionId": "s1", "capturedAt": "2026-01-01T00:00:00Z", "offsetMs": 0,
                    "imagePath": "/x", "ocrText": None, "dedupeHash": "abc", "isSlideChange": True,
                    "extra": "nope",
                },
            ),
        ],
    )
    def test_extra_fields_are_forbidden(self, model, kwargs) -> None:
        with pytest.raises(ValidationError):
            model(**kwargs)

    def test_anchor_offset_must_be_nonnegative(self) -> None:
        with pytest.raises(ValidationError):
            StartSlideSessionRequest(sessionId="s1", imageDir="/a", sourcePath="/b", anchorOffsetMs=-1)
        with pytest.raises(ValidationError):
            ResumeSlideSessionRequest(anchorOffsetMs=-1)

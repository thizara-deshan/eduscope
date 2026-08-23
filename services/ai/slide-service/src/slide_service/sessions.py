from __future__ import annotations

import asyncio
import os
import posixpath
import shutil
import tempfile
from collections import deque
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from .dedupe import FinalizedCandidate, SlideCandidateMachine
from .events import SlideCapturedEvent
from .ocr import atomic_copy

State = Literal["idle", "watching"]


class StartSlideSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sessionId: str = Field(min_length=1)
    imageDir: Path
    sourcePath: Path
    anchorOffsetMs: int = Field(ge=0)


class ResumeSlideSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    anchorOffsetMs: int = Field(ge=0)


class SlideStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: State
    sessionId: str | None
    slideCount: int = Field(ge=0)
    lastCaptureAt: datetime | None
    ocrBacklog: int = Field(ge=0)


class SessionActiveError(Exception):
    """A second `sessionId` was posted while one is already active — 409
    `session_active`."""

    def __init__(self, session_id: str) -> None:
        super().__init__(session_id)
        self.session_id = session_id


class SessionNotFoundError(Exception):
    """A command targeted a `sessionId` that is not the active one — 404
    `session_not_found`."""


class InvalidSlidePathError(Exception):
    """`sourcePath`/`imageDir` did not resolve to the one approved path for
    this session — 400 `invalid_path`."""


class WatcherLike(Protocol):
    def frames(self) -> AsyncIterator[Path]: ...


class OcrEngineLike(Protocol):
    async def extract(self, path: Path) -> str | None: ...


WatcherFactory = Callable[[Path], WatcherLike]
ClockFn = Callable[[], datetime]


def _default_clock() -> datetime:
    return datetime.now(UTC)


def _format_iso_millis(value: datetime) -> str:
    value = value.astimezone(UTC)
    return value.strftime("%Y-%m-%dT%H:%M:%S") + f".{value.microsecond // 1000:03d}Z"


def _resolve_source_path(path: Path, runtime_root: Path, session_id: str) -> Path:
    expected = PurePosixPath(posixpath.normpath((runtime_root / "slides" / session_id / "current.png").as_posix()))
    given = PurePosixPath(posixpath.normpath(path.as_posix()))
    if given != expected:
        raise InvalidSlidePathError("sourcePath must be the approved tmpfs slide snapshot path for this session")
    real_root = PurePosixPath(os.path.realpath(PurePosixPath(posixpath.normpath((runtime_root / "slides").as_posix()))))
    real_given = PurePosixPath(os.path.realpath(given))
    if real_root not in real_given.parents:
        raise InvalidSlidePathError("sourcePath must be the approved tmpfs slide snapshot path for this session")
    return Path(given)


def _resolve_image_dir(path: Path, recordings_root: Path, session_id: str) -> Path:
    expected = PurePosixPath(
        posixpath.normpath((recordings_root / "sessions" / session_id / "slides").as_posix())
    )
    given = PurePosixPath(posixpath.normpath(path.as_posix()))
    if given != expected:
        raise InvalidSlidePathError("imageDir must be the approved recordings-root slides directory for this session")
    real_root = PurePosixPath(os.path.realpath(PurePosixPath(posixpath.normpath(recordings_root.as_posix()))))
    real_given = PurePosixPath(os.path.realpath(given))
    if real_root not in real_given.parents:
        raise InvalidSlidePathError("imageDir must be the approved recordings-root slides directory for this session")
    return Path(given)


@dataclass
class _OcrJob:
    ordinal: int
    candidate: FinalizedCandidate
    skip_ocr: bool = False


@dataclass
class _SessionPaths:
    image_dir: Path
    source_path: Path


class SlideSessionController:
    """One-writer in-memory session controller: alone mutates session state,
    under a single `asyncio.Lock`, and is the only publisher on the shared
    `SseBroker`. Unlike STT there is no pause route — pipeline-manager's
    snapshot-consumer stop is the pause; slide-service only starts, resumes,
    and deletes."""

    def __init__(
        self,
        *,
        watcher_factory: WatcherFactory,
        ocr_engine: OcrEngineLike,
        broker,
        runtime_root: Path,
        recordings_root: Path,
        threshold: int = 10,
        ocr_queue_size: int = 4,
        clock: ClockFn = _default_clock,
    ) -> None:
        self._watcher_factory = watcher_factory
        self._ocr_engine = ocr_engine
        self._broker = broker
        self._runtime_root = runtime_root
        self._recordings_root = recordings_root
        self._threshold = threshold
        self._ocr_queue_size = ocr_queue_size
        self._clock = clock

        self._lock = asyncio.Lock()
        self._session_id: str | None = None
        self._state: State = "idle"
        self._paths: _SessionPaths | None = None
        self._anchor_offset_ms = 0
        self._epoch: datetime | None = None
        self._slide_count = 0
        self._last_capture_at: datetime | None = None

        self._temp_dir: Path | None = None
        self._candidate_machine: SlideCandidateMachine | None = None
        self._watch_task: asyncio.Task | None = None
        self._ocr_deque: deque[_OcrJob] = deque()
        self._ocr_signal = asyncio.Event()
        self._ocr_worker_task: asyncio.Task | None = None
        self._in_flight_job: _OcrJob | None = None
        self._dropped_job_tasks: set[asyncio.Task] = set()

    def status(self) -> SlideStatus:
        return SlideStatus(
            state=self._state,
            sessionId=self._session_id,
            slideCount=self._slide_count,
            lastCaptureAt=self._last_capture_at,
            ocrBacklog=len(self._ocr_deque),
        )

    def is_healthy(self) -> bool:
        if self._state == "idle":
            return True
        task = self._watch_task
        return task is not None and not task.done()

    async def start(self, session_id: str, image_dir: Path, source_path: Path, anchor_offset_ms: int) -> None:
        async with self._lock:
            if self._session_id == session_id:
                return  # idempotent same-session start — the new anchor is not applied
            if self._session_id is not None:
                raise SessionActiveError(self._session_id)
            resolved_source = _resolve_source_path(source_path, self._runtime_root, session_id)
            resolved_image_dir = _resolve_image_dir(image_dir, self._recordings_root, session_id)
            await self._attach(session_id, resolved_image_dir, resolved_source, anchor_offset_ms)

    async def resume(self, session_id: str, anchor_offset_ms: int) -> None:
        async with self._lock:
            if self._session_id != session_id or self._paths is None:
                raise SessionNotFoundError(session_id)
            paths = self._paths
            await self._detach()
            await self._attach(session_id, paths.image_dir, paths.source_path, anchor_offset_ms)

    async def delete(self, session_id: str) -> None:
        async with self._lock:
            if self._session_id != session_id:
                return  # idempotent no-op — nothing to flush for a session we do not own
            await self._detach(flush=True)
            self._session_id = None
            self._state = "idle"
            self._paths = None
            self._anchor_offset_ms = 0
            self._slide_count = 0
            self._last_capture_at = None

    async def shutdown(self) -> None:
        async with self._lock:
            await self._detach()
            self._session_id = None
            self._state = "idle"

    async def _attach(self, session_id: str, image_dir: Path, source_path: Path, anchor_offset_ms: int) -> None:
        self._session_id = session_id
        self._paths = _SessionPaths(image_dir=image_dir, source_path=source_path)
        self._anchor_offset_ms = anchor_offset_ms
        self._epoch = self._clock()
        self._temp_dir = Path(tempfile.mkdtemp(prefix="slide-candidates-"))
        self._candidate_machine = SlideCandidateMachine(temp_dir=self._temp_dir, threshold=self._threshold)
        self._ocr_deque.clear()
        self._ocr_signal.clear()
        watcher = self._watcher_factory(source_path)
        self._ocr_worker_task = asyncio.create_task(self._ocr_worker())
        self._watch_task = asyncio.create_task(self._watch_loop(watcher))
        self._state = "watching"

    async def _detach(self, *, flush: bool = False) -> None:
        watch_task = self._watch_task
        self._watch_task = None
        if watch_task is not None:
            watch_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await watch_task

        ocr_worker_task = self._ocr_worker_task
        self._ocr_worker_task = None
        if ocr_worker_task is not None:
            ocr_worker_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await ocr_worker_task

        # Cancelling the worker only stops it from picking up *new* work —
        # any job it had already popped off the deque (in flight) or that
        # never got a turn (still queued) must still be processed here, or
        # an already-accepted candidate would silently vanish on stop/resume.
        if self._dropped_job_tasks:
            with suppress(Exception):
                await asyncio.gather(*self._dropped_job_tasks)

        backlog = list(self._ocr_deque)
        self._ocr_deque.clear()
        if self._in_flight_job is not None:
            backlog.insert(0, self._in_flight_job)
            self._in_flight_job = None
        for job in backlog:
            await self._process_job(job)

        if flush and self._candidate_machine is not None:
            finalized = self._candidate_machine.finalize_pending()
            if finalized is not None:
                await self._process_finalized(finalized)

        self._candidate_machine = None
        if self._temp_dir is not None:
            shutil.rmtree(self._temp_dir, ignore_errors=True)
            self._temp_dir = None
        self._state = "idle"

    async def _watch_loop(self, watcher: WatcherLike) -> None:
        async for path in watcher.frames():
            assert self._candidate_machine is not None
            offset_ms = self._current_offset_ms()
            finalized = self._candidate_machine.observe(path, offset_ms)
            if finalized is not None:
                self._enqueue(finalized)

    def _current_offset_ms(self) -> int:
        assert self._epoch is not None
        elapsed_ms = int((self._clock() - self._epoch).total_seconds() * 1000)
        return self._anchor_offset_ms + elapsed_ms

    def _enqueue(self, candidate: FinalizedCandidate) -> None:
        ordinal = self._slide_count + 1
        self._slide_count = ordinal
        job = _OcrJob(ordinal=ordinal, candidate=candidate)
        if len(self._ocr_deque) >= self._ocr_queue_size:
            dropped = self._ocr_deque.popleft()
            dropped.skip_ocr = True
            task = asyncio.create_task(self._process_job(dropped))
            self._dropped_job_tasks.add(task)
            task.add_done_callback(self._dropped_job_tasks.discard)
        self._ocr_deque.append(job)
        self._ocr_signal.set()

    async def _ocr_worker(self) -> None:
        while True:
            while not self._ocr_deque:
                self._ocr_signal.clear()
                await self._ocr_signal.wait()
            job = self._ocr_deque.popleft()
            self._in_flight_job = job
            await self._process_job(job)
            self._in_flight_job = None

    async def _process_finalized(self, candidate: FinalizedCandidate) -> None:
        ordinal = self._slide_count + 1
        self._slide_count = ordinal
        await self._process_job(_OcrJob(ordinal=ordinal, candidate=candidate))

    async def _process_job(self, job: _OcrJob) -> None:
        assert self._paths is not None
        destination = self._paths.image_dir / f"slide-{job.ordinal:03d}.png"
        await atomic_copy(job.candidate.source_path, destination)
        ocr_text = None if job.skip_ocr else await self._ocr_engine.extract(destination)
        self._emit(job, destination, ocr_text)

    def _emit(self, job: _OcrJob, destination: Path, ocr_text: str | None) -> None:
        captured_at = self._clock()
        self._last_capture_at = captured_at
        event = SlideCapturedEvent(
            sessionId=self._session_id,
            capturedAt=_format_iso_millis(captured_at),
            offsetMs=job.candidate.observed_offset_ms,
            imagePath=str(destination),
            ocrText=ocr_text,
            dedupeHash=job.candidate.dedupe_hash,
        )
        self._broker.publish("evt.slide.captured", event)

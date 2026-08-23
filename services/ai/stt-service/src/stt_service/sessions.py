from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from .events import SttSegmentEvent, SttStateEvent
from .reader import DropOldestPcmRing
from .recognizer import RecognizedUtterance, RecognizerLoop, SpeechRecognizer

State = Literal["idle", "listening", "paused", "degraded"]

SAMPLES_PER_MS = 16


class StartSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sessionId: str = Field(min_length=1)
    anchorOffsetMs: int = Field(ge=0)


class ResumeSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    anchorOffsetMs: int = Field(ge=0)


class AudioSourceStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attached: bool
    fps: float | None = None


class SttStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: State
    sessionId: str | None
    model: str | None
    modelVersion: str | None
    samplesConsumed: int | None
    queueDepth: int = Field(ge=0, le=600)
    droppedBlocks: int = Field(ge=0)
    lastSegmentAt: datetime | None
    audioSource: AudioSourceStatus | None


class SessionActiveError(Exception):
    """A second `sessionId` was posted while one is already active (mirrors
    INV-LS-1) — 409 `session_active`."""

    def __init__(self, session_id: str) -> None:
        super().__init__(session_id)
        self.session_id = session_id


class SessionNotFoundError(Exception):
    """A command targeted a `sessionId` that is not the active one — 404
    `session_not_found`."""


class EngineLike(Protocol):
    def create_recognizer(self, sample_rate: int = 16000) -> SpeechRecognizer: ...


class ReaderLike(Protocol):
    async def start(self) -> None: ...
    async def stop(self) -> None: ...


ReaderFactory = Callable[[DropOldestPcmRing], ReaderLike]
ClockFn = Callable[[], datetime]


def _default_clock() -> datetime:
    return datetime.now(UTC)


class SttSessionController:
    """One-writer in-memory session controller (§1.3/§1.4): alone mutates
    session state, under a single `asyncio.Lock`, and is the only publisher
    on the shared `SseBroker`."""

    def __init__(
        self,
        *,
        engine: EngineLike,
        reader_factory: ReaderFactory,
        broker,
        model_name: str,
        model_version: str,
        min_words: int = 3,
        ring_blocks: int = 600,
        no_audio_after_sec: float = 10.0,
        clock: ClockFn = _default_clock,
    ) -> None:
        self._engine = engine
        self._reader_factory = reader_factory
        self._broker = broker
        self._model_name = model_name
        self._model_version = model_version
        self._min_words = min_words
        self._ring_blocks = ring_blocks
        self._no_audio_after_sec = no_audio_after_sec
        self._clock = clock

        self._lock = asyncio.Lock()
        self._session_id: str | None = None
        self._state: State = "idle"
        self._anchor_offset_ms = 0
        self._ring: DropOldestPcmRing | None = None
        self._reader: ReaderLike | None = None
        self._recognizer_loop: RecognizerLoop | None = None
        self._pump_task: asyncio.Task | None = None
        self._last_segment_at: datetime | None = None

    def status(self) -> SttStatus:
        audio_source = AudioSourceStatus(attached=True, fps=None) if self._reader is not None else None
        return SttStatus(
            state=self._state,
            sessionId=self._session_id,
            model=self._model_name,
            modelVersion=self._model_version,
            samplesConsumed=self._recognizer_loop.samples_consumed if self._recognizer_loop is not None else None,
            queueDepth=len(self._ring) if self._ring is not None else 0,
            droppedBlocks=self._ring.dropped_blocks if self._ring is not None else 0,
            lastSegmentAt=self._last_segment_at,
            audioSource=audio_source,
        )

    def is_healthy(self) -> bool:
        """200 while idle/paused (the model is loaded and ready either way);
        503 only once an active listen/degrade loop has actually died."""
        if self._state in ("idle", "paused"):
            return True
        task = self._pump_task
        return task is not None and not task.done()

    async def start(self, session_id: str, anchor_offset_ms: int) -> None:
        async with self._lock:
            if self._session_id == session_id:
                return  # idempotent same-session start — the new anchor is not applied
            if self._session_id is not None:
                raise SessionActiveError(self._session_id)
            await self._attach(session_id, anchor_offset_ms)
            self._state = "listening"

    async def pause(self, session_id: str) -> None:
        async with self._lock:
            if self._session_id != session_id:
                raise SessionNotFoundError(session_id)
            if self._state == "paused":
                return  # idempotent
            await self._detach()
            self._state = "paused"

    async def resume(self, session_id: str, anchor_offset_ms: int) -> None:
        async with self._lock:
            if self._session_id != session_id:
                raise SessionNotFoundError(session_id)
            await self._detach()
            await self._attach(session_id, anchor_offset_ms)
            self._state = "listening"

    async def delete(self, session_id: str) -> None:
        async with self._lock:
            if self._session_id != session_id:
                return  # idempotent no-op — nothing to flush for a session we do not own
            await self._detach(flush=True)
            self._session_id = None
            self._state = "idle"
            self._anchor_offset_ms = 0

    async def shutdown(self) -> None:
        async with self._lock:
            await self._detach()
            self._session_id = None
            self._state = "idle"

    async def _attach(self, session_id: str, anchor_offset_ms: int) -> None:
        self._session_id = session_id
        self._anchor_offset_ms = anchor_offset_ms
        recognizer = self._engine.create_recognizer()
        self._recognizer_loop = RecognizerLoop(recognizer, min_words=self._min_words)
        self._ring = DropOldestPcmRing(max_blocks=self._ring_blocks)
        self._reader = self._reader_factory(self._ring)
        await self._reader.start()
        self._pump_task = asyncio.create_task(self._pump(session_id, self._ring, self._recognizer_loop))

    async def _detach(self, *, flush: bool = False) -> None:
        task = self._pump_task
        self._pump_task = None
        if task is not None:
            task.cancel()
            # A task that already died on its own (e.g. the recognizer
            # crashed — exactly what `is_healthy()` surfaces before this
            # runs) finishes `cancel()` as a no-op and re-raises its own
            # exception here rather than `CancelledError`; teardown must not
            # propagate it.
            with suppress(asyncio.CancelledError, Exception):
                await task
        reader = self._reader
        self._reader = None
        if reader is not None:
            await reader.stop()
        if flush and self._recognizer_loop is not None:
            utterance = self._recognizer_loop.flush()
            if utterance is not None:
                self._emit_segment(utterance)
        self._recognizer_loop = None
        self._ring = None

    async def _pump(self, session_id: str, ring: DropOldestPcmRing, recognizer_loop: RecognizerLoop) -> None:
        degraded = False
        while True:
            try:
                block = await asyncio.wait_for(ring.get(), timeout=self._no_audio_after_sec)
            except TimeoutError:
                if not degraded:
                    degraded = True
                    self._state = "degraded"
                    self._broker.publish(
                        "evt.stt.state",
                        SttStateEvent(sessionId=session_id, state="degraded", reason="no-audio"),
                    )
                continue
            if degraded:
                degraded = False
                self._state = "listening"
                self._broker.publish("evt.stt.state", SttStateEvent(sessionId=session_id, state="listening"))
            utterance = recognizer_loop.accept_block(block)
            if utterance is not None:
                self._emit_segment(utterance)

    def _emit_segment(self, utterance: RecognizedUtterance) -> None:
        start_offset = self._anchor_offset_ms + utterance.start_sample // SAMPLES_PER_MS
        end_offset = self._anchor_offset_ms + utterance.end_sample // SAMPLES_PER_MS
        event = SttSegmentEvent(
            sessionId=self._session_id,
            startOffsetMs=start_offset,
            endOffsetMs=end_offset,
            text=utterance.text,
            confidence=utterance.confidence,
            modelVersion=self._model_version,
        )
        self._last_segment_at = self._clock()
        self._broker.publish("evt.stt.segment", event)

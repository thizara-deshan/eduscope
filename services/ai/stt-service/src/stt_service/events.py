from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class SttSegmentEvent(BaseModel):
    """`evt.stt.segment` (§1.4) — published directly as SSE `data`, not
    nested under `payload`, matching current B's `parseAiSseStream`."""

    model_config = ConfigDict(extra="forbid")
    sessionId: str
    startOffsetMs: int
    endOffsetMs: int
    text: str
    confidence: float | None
    engine: Literal["vosk"] = "vosk"
    modelVersion: str


class SttStateEvent(BaseModel):
    """`evt.stt.state` (§1.4) — e.g. `degraded{no-audio}` when the shm reader
    has delivered no samples for `NO_AUDIO_AFTER_SEC`, back to `listening` on
    recovery."""

    model_config = ConfigDict(extra="forbid")
    sessionId: str
    state: Literal["listening", "paused", "degraded", "idle"]
    reason: str | None = None

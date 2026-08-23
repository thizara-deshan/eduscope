from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class SlideCapturedEvent(BaseModel):
    """`evt.slide.captured` — published directly as SSE `data`, not nested
    under `payload`, matching current B's `parseAiSseStream`. `capturedAt` is
    a pre-formatted ISO-8601-with-milliseconds string (not a `datetime`
    field) because current B reads it as an opaque string (`clients.ts`
    `data.capturedAt: string`) and stores it verbatim."""

    model_config = ConfigDict(extra="forbid")
    sessionId: str
    capturedAt: str
    offsetMs: int
    imagePath: str
    ocrText: str | None
    dedupeHash: str
    isSlideChange: Literal[True] = True

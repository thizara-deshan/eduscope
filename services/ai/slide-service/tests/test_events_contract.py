from __future__ import annotations

import json
from pathlib import Path

from slide_service.events import SlideCapturedEvent

FIXTURES = Path(__file__).parents[2] / "test" / "contract" / "fixtures"

# The exact fields current B's `AiIngest.#runSlideLoop` reads directly off
# `frame.data` (services/core-api/src/modules/ai/ingest.ts) — the payload is
# published unnested, not wrapped under `payload`.
B_CAPTURED_FIELDS = {"capturedAt", "offsetMs", "imagePath", "ocrText", "dedupeHash", "isSlideChange"}


def test_slide_captured_fixture_matches_c_model_and_b_direct_fields() -> None:
    raw = json.loads((FIXTURES / "slide-captured.json").read_text())
    event = SlideCapturedEvent(**raw)
    assert event.model_dump(mode="json") == raw
    assert B_CAPTURED_FIELDS <= raw.keys()
    assert event.isSlideChange is True

from __future__ import annotations

import json
from pathlib import Path

from stt_service.events import SttSegmentEvent, SttStateEvent

FIXTURES = Path(__file__).parents[2] / "test" / "contract" / "fixtures"

# The exact fields current B's `AiIngest.#runSttLoop` reads directly off
# `frame.data` (services/core-api/src/modules/ai/ingest.ts) — the payload is
# published unnested, not wrapped under `payload`.
B_SEGMENT_FIELDS = {"startOffsetMs", "endOffsetMs", "text", "confidence", "engine", "modelVersion"}


def test_stt_segment_fixture_matches_c_model_and_b_direct_fields() -> None:
    raw = json.loads((FIXTURES / "stt-segment.json").read_text())
    event = SttSegmentEvent(**raw)
    assert event.model_dump(mode="json") == raw
    assert B_SEGMENT_FIELDS <= raw.keys()


def test_stt_state_fixture_matches_c_model() -> None:
    raw = json.loads((FIXTURES / "stt-state.json").read_text())
    event = SttStateEvent(**raw)
    assert event.model_dump(mode="json") == raw
    assert event.state == "degraded"
    assert event.reason == "no-audio"

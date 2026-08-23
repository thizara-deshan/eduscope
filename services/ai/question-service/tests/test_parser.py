from __future__ import annotations

import json
from pathlib import Path

import pytest
from question_service.parser import (
    ExtractionError,
    extract_first_json_array,
    salvage_questions,
)

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "responses"


def _fixture_content(name: str) -> str:
    payload = json.loads((FIXTURE_DIR / f"{name}.json").read_text())
    return payload["content"]


class TestExtractFirstJsonArray:
    def test_extracts_a_bare_array(self) -> None:
        text = '[{"prompt":"p","options":[]}]'
        assert extract_first_json_array(text) == text

    def test_ignores_brackets_inside_strings_and_escapes(self) -> None:
        text = '[{"prompt":"contains [brackets] and \\"quotes\\" and a \\\\ backslash","options":[]}]'
        assert extract_first_json_array(text) == text

    def test_extracts_through_a_markdown_fence_and_prefix_text(self) -> None:
        content = _fixture_content("fenced")
        extracted = extract_first_json_array(content)
        parsed = json.loads(extracted)
        assert isinstance(parsed, list)
        assert len(parsed) == 4

    def test_returns_only_the_first_top_level_array(self) -> None:
        text = '[{"prompt":"first","options":[]}] and then [{"prompt":"second","options":[]}]'
        extracted = extract_first_json_array(text)
        assert json.loads(extracted) == [{"prompt": "first", "options": []}]

    def test_raises_on_unbalanced_input(self) -> None:
        with pytest.raises(ExtractionError):
            extract_first_json_array(_fixture_content("unbalanced"))

    def test_raises_when_no_array_is_present(self) -> None:
        with pytest.raises(ExtractionError):
            extract_first_json_array("no array here, just prose.")


class TestSalvageQuestions:
    def test_none_content_yields_no_survivors(self) -> None:
        result = salvage_questions(None)
        assert result.survivors == []
        assert result.dropped_invalid == 0

    def test_empty_content_yields_no_survivors(self) -> None:
        result = salvage_questions("")
        assert result.survivors == []
        assert result.dropped_invalid == 0

    def test_valid_fixture_all_survive(self) -> None:
        result = salvage_questions(_fixture_content("valid"))
        assert len(result.survivors) == 4
        assert result.dropped_invalid == 0

    def test_fenced_fixture_extracts_and_all_survive(self) -> None:
        result = salvage_questions(_fixture_content("fenced"))
        assert len(result.survivors) == 4
        assert result.dropped_invalid == 0

    def test_partly_invalid_fixture_keeps_only_survivors(self) -> None:
        result = salvage_questions(_fixture_content("partly-invalid"))
        assert len(result.survivors) == 3
        assert result.dropped_invalid == 2
        assert len(result.errors) == 2

    def test_repairable_fixture_has_zero_survivors_but_nonempty_content(self) -> None:
        content = _fixture_content("repairable")
        result = salvage_questions(content)
        assert result.survivors == []
        assert result.dropped_invalid == 3
        assert content  # the repair trigger condition: zero survivors, non-empty content

    def test_duplicate_fixture_drops_the_near_duplicate_question(self) -> None:
        result = salvage_questions(_fixture_content("duplicates"))
        assert len(result.survivors) == 2
        assert result.dropped_invalid == 1

    def test_unbalanced_fixture_yields_no_survivors_and_no_drop_count(self) -> None:
        result = salvage_questions(_fixture_content("unbalanced"))
        assert result.survivors == []
        assert result.dropped_invalid == 0

    def test_unknown_item_fields_are_dropped_not_stripped(self) -> None:
        batch = [
            {"prompt": "p", "options": [{"text": "a", "isCorrect": True}, {"text": "b", "isCorrect": False}], "id": "01J..."},
            {"prompt": "q", "options": [{"text": "a", "isCorrect": True}, {"text": "b", "isCorrect": False}]},
        ]
        result = salvage_questions(json.dumps(batch))
        assert len(result.survivors) == 1
        assert result.dropped_invalid == 1

    def test_duplicate_detection_uses_unicode_nfkc_casefold_and_trim(self) -> None:
        batch = [
            {
                "prompt": "Which unit measures energy?",
                "options": [
                    {"text": "Joule", "isCorrect": True},
                    # NFKC-normalizes to the same text as "Joule" after trim+casefold,
                    # using full-width characters and surrounding whitespace.
                    {"text": "  ｊｏｕｌｅ  ", "isCorrect": False},
                ],
            },
            {
                "prompt": "second question",
                "options": [{"text": "a", "isCorrect": True}, {"text": "b", "isCorrect": False}],
            },
            {
                "prompt": "third question",
                "options": [{"text": "a", "isCorrect": True}, {"text": "b", "isCorrect": False}],
            },
        ]
        result = salvage_questions(json.dumps(batch))
        assert len(result.survivors) == 2
        assert result.dropped_invalid == 1

    def test_display_text_is_normalized_but_not_casefolded(self) -> None:
        batch = [
            {
                "prompt": "  Energy   is conserved  ",
                "options": [{"text": "  Energy  ", "isCorrect": True}, {"text": "Momentum", "isCorrect": False}],
            }
        ]
        result = salvage_questions(json.dumps(batch))
        assert len(result.survivors) == 1
        assert result.survivors[0].prompt == "Energy is conserved"
        assert result.survivors[0].options[0].text == "Energy"

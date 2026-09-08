from __future__ import annotations

import json
from pathlib import Path

import pytest
import zxingcpp
from PIL import Image
from pydantic import ValidationError

from pipeline_manager.overlays import render_question_card
from pipeline_manager.pipelines.projector import QuestionOverlay

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "projector" / "question.json"


def _payload(**overrides) -> QuestionOverlay:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    data.update(overrides)
    return QuestionOverlay.model_validate(data)


def _options(n: int) -> list[dict]:
    labels = ["A", "B", "C", "D"]
    return [{"id": f"opt-{i}", "label": labels[i], "text": f"Option {labels[i]} text"} for i in range(n)]


def test_output_is_1920x1080_png(tmp_path: Path) -> None:
    path = render_question_card(_payload(), tmp_path)
    with Image.open(path) as image:
        assert image.size == (1920, 1080)
        assert image.format == "PNG"


def test_card_is_published_at_publication_id_path(tmp_path: Path) -> None:
    payload = _payload(publicationId="pub-XYZ")
    path = render_question_card(payload, tmp_path)
    assert Path(path) == tmp_path / "projector" / "pub-XYZ.png"
    assert Path(path).exists()


def test_publication_is_atomic_leaving_no_temp_files(tmp_path: Path) -> None:
    render_question_card(_payload(), tmp_path)
    leftovers = list((tmp_path / "projector").glob("*.tmp"))
    assert leftovers == []
    files = list((tmp_path / "projector").iterdir())
    assert len(files) == 1


def test_render_is_deterministic(tmp_path: Path) -> None:
    a = render_question_card(_payload(publicationId="det-1"), tmp_path)
    b = render_question_card(_payload(publicationId="det-2"), tmp_path)
    assert Path(a).read_bytes() == Path(b).read_bytes()


@pytest.mark.parametrize("count", [2, 3, 4])
def test_two_three_and_four_options_render(tmp_path: Path, count: int) -> None:
    payload = _payload(options=_options(count), correctOptionId=None)
    path = render_question_card(payload, tmp_path)
    with Image.open(path) as image:
        assert image.size == (1920, 1080)


def test_qr_decodes_back_to_join_url(tmp_path: Path) -> None:
    payload = _payload(joinUrl="https://quiz.example.edu/j/DECODE9")
    path = render_question_card(payload, tmp_path)
    with Image.open(path) as image:
        results = zxingcpp.read_barcodes(image)
    assert any(result.text == "https://quiz.example.edu/j/DECODE9" for result in results)


def test_join_code_changes_the_pixels(tmp_path: Path) -> None:
    a = render_question_card(_payload(publicationId="code-1", joinCode="AAA111", joinUrl="https://q/x"), tmp_path)
    b = render_question_card(_payload(publicationId="code-2", joinCode="BBB222", joinUrl="https://q/x"), tmp_path)
    assert Path(a).read_bytes() != Path(b).read_bytes()


def test_five_hundred_character_prompt_wraps_without_error(tmp_path: Path) -> None:
    long_prompt = "Word " * 100  # 500 characters
    long_prompt = long_prompt[:500]
    payload = _payload(prompt=long_prompt)
    path = render_question_card(payload, tmp_path)
    with Image.open(path) as image:
        assert image.size == (1920, 1080)


def test_correct_option_highlight_is_deterministic(tmp_path: Path) -> None:
    reveal = render_question_card(_payload(publicationId="rev-1", correctOptionId="opt-b"), tmp_path)
    plain = render_question_card(_payload(publicationId="rev-2", correctOptionId=None), tmp_path)
    # A reveal highlight changes the rendered pixels vs. the no-answer card.
    assert Path(reveal).read_bytes() != Path(plain).read_bytes()


@pytest.mark.parametrize(
    "forbidden",
    ["leaderboard", "participantCount", "score", "studentId", "name", "responses", "correctCount"],
)
def test_no_leaderboard_participant_or_score_fields_accepted(forbidden: str) -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    data[forbidden] = "should not be allowed"
    with pytest.raises(ValidationError):
        QuestionOverlay.model_validate(data)

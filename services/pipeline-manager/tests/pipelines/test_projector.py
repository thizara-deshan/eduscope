from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from pipeline_manager.pipelines.builder import DisplayPlacement
from pipeline_manager.pipelines.platforms.base import DisplayOut
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.projector import (
    ProjectorMode,
    QuestionOverlay,
    build_projector,
    encode_control_message,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "projector" / "question.json"


def _load_question() -> QuestionOverlay:
    return QuestionOverlay.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))


def test_passthrough_and_question_modes_share_the_same_build() -> None:
    """No mode parameter exists on build_projector — switching modes never
    regenerates the pipeline, so the same argv/child serves both (A-22)."""
    first = build_projector(RK3588Profile())
    second = build_projector(RK3588Profile())
    assert first.argv == second.argv


def test_question_data_is_a_control_message_not_argv() -> None:
    spec = build_projector(RK3588Profile())
    question = _load_question()
    message = encode_control_message(ProjectorMode.QUESTION, question)
    assert question.question_text not in spec.argv
    assert b"question_text" not in b"".join(token.encode() for token in spec.argv)
    assert b"question_text" in message


def test_control_message_is_length_delimited_json() -> None:
    question = _load_question()
    message = encode_control_message(ProjectorMode.QUESTION, question)
    header, _, body = message.partition(b"\n")
    assert int(header) == len(body)
    decoded = json.loads(body)
    assert decoded["mode"] == "question"
    assert decoded["payload"]["question_text"] == question.question_text


def test_passthrough_message_has_no_payload() -> None:
    message = encode_control_message(ProjectorMode.PASSTHROUGH)
    _, _, body = message.partition(b"\n")
    decoded = json.loads(body)
    assert decoded["payload"] is None


@pytest.mark.parametrize("forbidden_field", ["leaderboard", "answer", "participantCount", "score"])
def test_no_leaderboard_answer_or_participant_fields_accepted(forbidden_field: str) -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    payload[forbidden_field] = "should not be allowed"
    with pytest.raises(ValidationError):
        QuestionOverlay.model_validate(payload)


def test_hdmi_1_placement_is_selected() -> None:
    spec = build_projector(RK3588Profile())
    assert isinstance(spec.placement, DisplayPlacement)
    assert spec.placement.output is DisplayOut.HDMI_1

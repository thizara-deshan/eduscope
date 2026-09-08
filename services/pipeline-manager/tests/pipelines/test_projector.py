from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from pipeline_manager.api.routes import ProjectorModeBody
from pipeline_manager.pipelines.builder import DisplayPlacement
from pipeline_manager.pipelines.platforms.base import DisplayOut
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.projector import (
    InvalidControlFrame,
    ProjectorControlMessage,
    ProjectorMode,
    QuestionOverlay,
    build_projector,
    decode_control_message,
    encode_control_message,
    worker_argv,
    worker_graph,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "projector" / "question.json"


def _load_question() -> QuestionOverlay:
    return QuestionOverlay.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))


# ── E-49 A/B payload reconciliation ─────────────────────────────────────────
# The exact internal question payload B sends (core-api `PmProjectorRequest`)
# must parse against A's `ProjectorModeBody`/`QuestionOverlay` with no snake_case
# translation and no pre-rendered path — one canonical DTO on both sides.
_B_QUESTION_PAYLOAD = {
    "publicationId": "01K4A8E0600000000000000042",
    "prompt": "Which layer owns the process supervisor?",
    "options": [
        {"id": "opt-a", "label": "A", "text": "core-api"},
        {"id": "opt-b", "label": "B", "text": "pipeline-manager"},
        {"id": "opt-c", "label": "C", "text": "the frontend panel"},
        {"id": "opt-d", "label": "D", "text": "nginx"},
    ],
    "correctOptionId": "opt-b",
    "joinUrl": "https://quiz.example.edu/j/E49TEST",
    "joinCode": "E49TEST",
}


def test_b_question_payload_parses_against_a_projector_mode_body() -> None:
    body = ProjectorModeBody.model_validate({"mode": "question", "questionPayload": _B_QUESTION_PAYLOAD})
    assert body.questionPayload is not None
    assert body.questionPayload.publicationId == "01K4A8E0600000000000000042"
    assert [o.label for o in body.questionPayload.options] == ["A", "B", "C", "D"]
    assert body.questionPayload.joinUrl == "https://quiz.example.edu/j/E49TEST"


@pytest.mark.parametrize("forbidden", ["leaderboard", "participantCount", "score", "studentId", "responses"])
def test_projector_mode_body_rejects_privacy_fields(forbidden: str) -> None:
    payload = {**_B_QUESTION_PAYLOAD, forbidden: "nope"}
    with pytest.raises(ValidationError):
        ProjectorModeBody.model_validate({"mode": "question", "questionPayload": payload})


def test_passthrough_and_question_modes_share_the_same_build() -> None:
    """No mode parameter exists on build_projector — switching modes never
    regenerates the pipeline, so the same argv/child serves both (A-22)."""
    first = build_projector(RK3588Profile())
    second = build_projector(RK3588Profile())
    assert first.argv == second.argv


def test_question_text_never_reaches_argv() -> None:
    spec = build_projector(RK3588Profile())
    question = _load_question()
    joined = b"".join(token.encode() for token in spec.argv)
    # The prompt (and join code) are distinctive question data; the projector
    # argv is fixed at build time and never carries any of it.
    assert question.prompt.encode() not in joined
    assert question.joinCode.encode() not in joined
    assert question.joinUrl.encode() not in joined


def test_question_control_message_carries_only_a_card_path() -> None:
    message = encode_control_message(ProjectorMode.QUESTION, card_png_path="/run/eduscope/projector/pub-1.png")
    header, _, body = message.partition(b"\n")
    assert int(header) == len(body)
    decoded = json.loads(body)
    assert decoded["mode"] == "question"
    assert decoded["card"]["card_png_path"] == "/run/eduscope/projector/pub-1.png"


def test_passthrough_message_has_no_card() -> None:
    message = encode_control_message(ProjectorMode.PASSTHROUGH)
    _, _, body = message.partition(b"\n")
    decoded = json.loads(body)
    assert decoded["card"] is None


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


class TestWorkerArgv:
    """A-REV-009: `build_projector` spawns a real long-running Python worker
    (mode-switching a running `input-selector` needs GObject property access
    `gst-launch-1.0` has no way to reach) instead of a plain `gst-launch-1.0`
    command."""

    def test_argv_is_a_python_worker_invocation(self) -> None:
        spec = build_projector(RK3588Profile())
        assert spec.argv[0] == sys.executable
        assert "-m" in spec.argv
        assert "pipeline_manager.pipelines.projector" in spec.argv
        assert "--worker" in spec.argv

    def test_worker_argv_helper_takes_an_explicit_python_executable(self) -> None:
        argv = worker_argv("video/x-raw,format=NV12", "xvimagesink sync=false", python_executable="python3")
        assert argv[0] == "python3"

    def test_argv_carries_platform_caps_and_display_sink(self) -> None:
        from pipeline_manager.models import SourceRole

        spec = build_projector(RK3588Profile())
        assert RK3588Profile().shm_video_caps(SourceRole.PRESENTATION) in spec.argv
        assert "xvimagesink" in " ".join(spec.argv)


class TestWorkerGraph:
    def test_passthrough_pad_is_the_real_presentation_source(self) -> None:
        graph = worker_graph("video/x-raw,format=NV12", "xvimagesink sync=false")
        assert "socket-path=/tmp/usb.sock" in graph
        assert "sel.sink_0" in graph

    def test_question_pad_overlays_a_single_rendered_card_image(self) -> None:
        graph = worker_graph("video/x-raw,format=NV12", "xvimagesink sync=false")
        assert "gdkpixbufoverlay name=card" in graph
        assert "sel.sink_1" in graph
        # The full card is a rendered PNG; no per-line text overlay remains.
        assert "textoverlay" not in graph

    def test_single_named_selector_drives_the_switch(self) -> None:
        graph = worker_graph("video/x-raw,format=NV12", "xvimagesink sync=false")
        assert graph.count("input-selector name=sel") == 1

    def test_display_sink_tokens_are_injected_verbatim(self) -> None:
        graph = worker_graph("video/x-raw,format=NV12", "xvimagesink sync=false")
        assert graph.endswith("xvimagesink sync=false")


class TestControlFrameRoundTrip:
    """The worker's stdin reader decodes exactly what `encode_control_message`
    (already written to `process.popen.stdin` by `ProjectorConsumer.set_mode`)
    produces — proven by round-tripping through both functions."""

    def test_passthrough_round_trips(self) -> None:
        message = encode_control_message(ProjectorMode.PASSTHROUGH)
        header, _, body = message.partition(b"\n")
        decoded = decode_control_message(header.decode("ascii"), body)
        assert decoded == ProjectorControlMessage(mode=ProjectorMode.PASSTHROUGH)

    def test_question_round_trips_with_card_path(self) -> None:
        message = encode_control_message(ProjectorMode.QUESTION, card_png_path="/run/eduscope/projector/p.png")
        header, _, body = message.partition(b"\n")
        decoded = decode_control_message(header.decode("ascii"), body)
        assert decoded.mode is ProjectorMode.QUESTION
        assert decoded.card is not None
        assert decoded.card.card_png_path == "/run/eduscope/projector/p.png"

    def test_length_mismatch_rejected(self) -> None:
        with pytest.raises(InvalidControlFrame):
            decode_control_message("5", b"{}")

    def test_malformed_json_rejected(self) -> None:
        with pytest.raises(InvalidControlFrame):
            decode_control_message("2", b"{{")

    def test_non_integer_header_rejected(self) -> None:
        with pytest.raises(InvalidControlFrame):
            decode_control_message("not-a-number", b"{}")

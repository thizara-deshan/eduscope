from __future__ import annotations

import json

import pytest
from pydantic import ValidationError
from question_service.models import (
    AiProblem,
    GenerateRequest,
    GenerateResponse,
    GeneratedQuestion,
    QuestionCount,
)

VALID_REQUEST = {
    "sessionId": "01J00000000000000000000000",
    "questionSetId": "01J00000000000000000000001",
    "count": {"min": 3, "max": 5},
    "transcript": {"fromOffsetMs": 0, "toOffsetMs": 60000, "text": "Energy cannot be created or destroyed."},
    "slides": [{"offsetMs": 30000, "ocrText": "Conservation of Energy"}],
    "promptVersion": "mcq/v1",
    "llmEndpoint": "http://127.0.0.1:7200",
}


def _question(options: list[tuple[str, bool]], prompt: str = "What is conserved?") -> dict:
    return {"prompt": prompt, "options": [{"text": t, "isCorrect": c} for t, c in options]}


class TestGenerateRequest:
    def test_accepts_the_shape_used_by_core_api_clients_ts(self) -> None:
        request = GenerateRequest.model_validate(VALID_REQUEST)
        assert request.sessionId == VALID_REQUEST["sessionId"]
        assert request.questionSetId == VALID_REQUEST["questionSetId"]
        assert request.count.min == 3
        assert request.count.max == 5
        assert request.promptVersion == "mcq/v1"

    def test_prompt_version_is_optional(self) -> None:
        body = {**VALID_REQUEST}
        del body["promptVersion"]
        request = GenerateRequest.model_validate(body)
        assert request.promptVersion is None

    def test_forbids_unknown_top_level_fields(self) -> None:
        with pytest.raises(ValidationError):
            GenerateRequest.model_validate({**VALID_REQUEST, "unexpected": True})

    @pytest.mark.parametrize(
        "endpoint",
        [
            "not-a-url",
            "ftp://127.0.0.1:7200",
            "http://",
            "http://user:pass@127.0.0.1:7200",
            "http://127.0.0.1:7200#fragment",
        ],
    )
    def test_rejects_invalid_llm_endpoints(self, endpoint: str) -> None:
        with pytest.raises(ValidationError):
            GenerateRequest.model_validate({**VALID_REQUEST, "llmEndpoint": endpoint})

    def test_validator_messages_never_embed_the_offending_url(self) -> None:
        # The validator's own `msg` text is static — it never interpolates the
        # value — so it stays safe even before any redaction. Pydantic's
        # structured `input` field still carries the raw value for
        # programmatic handling; callers that render/log this error use
        # `errors(include_input=False)` (proven below) instead of `str()`.
        secret_bearing_endpoint = "http://leaked-token@evil.example:7200"
        with pytest.raises(ValidationError) as excinfo:
            GenerateRequest.model_validate({**VALID_REQUEST, "llmEndpoint": secret_bearing_endpoint})
        messages = [err["msg"] for err in excinfo.value.errors()]
        assert any("credentials" in message for message in messages)
        assert not any("leaked-token" in message for message in messages)

    def test_redacted_error_rendering_omits_the_offending_url(self) -> None:
        secret_bearing_endpoint = "http://leaked-token@evil.example:7200"
        with pytest.raises(ValidationError) as excinfo:
            GenerateRequest.model_validate({**VALID_REQUEST, "llmEndpoint": secret_bearing_endpoint})
        redacted = excinfo.value.errors(include_input=False)
        assert "leaked-token" not in json.dumps(redacted, default=str)


class TestQuestionCount:
    def test_rejects_max_below_min(self) -> None:
        with pytest.raises(ValidationError):
            QuestionCount.model_validate({"min": 5, "max": 3})


class TestGeneratedQuestion:
    def test_accepts_two_to_four_options_with_exactly_one_correct(self) -> None:
        for size in (2, 3, 4):
            options = [(f"option {i}", i == 0) for i in range(size)]
            GeneratedQuestion.model_validate(_question(options))

    def test_rejects_one_option(self) -> None:
        with pytest.raises(ValidationError):
            GeneratedQuestion.model_validate(_question([("only", True)]))

    def test_rejects_five_options(self) -> None:
        options = [(f"option {i}", i == 0) for i in range(5)]
        with pytest.raises(ValidationError):
            GeneratedQuestion.model_validate(_question(options))

    def test_rejects_zero_correct_options(self) -> None:
        with pytest.raises(ValidationError):
            GeneratedQuestion.model_validate(_question([("a", False), ("b", False)]))

    def test_rejects_two_correct_options(self) -> None:
        with pytest.raises(ValidationError):
            GeneratedQuestion.model_validate(_question([("a", True), ("b", True)]))

    def test_rejects_blank_option_text(self) -> None:
        with pytest.raises(ValidationError):
            GeneratedQuestion.model_validate(_question([("", True), ("b", False)]))

    def test_rejects_option_text_over_512_chars(self) -> None:
        with pytest.raises(ValidationError):
            GeneratedQuestion.model_validate(_question([("a" * 513, True), ("b", False)]))

    def test_rejects_unknown_fields_on_question_and_option(self) -> None:
        with pytest.raises(ValidationError):
            GeneratedQuestion.model_validate({**_question([("a", True), ("b", False)]), "id": "01J..."})
        with pytest.raises(ValidationError):
            GeneratedQuestion.model_validate(
                {"prompt": "p", "options": [{"text": "a", "isCorrect": True, "label": "A"}, {"text": "b", "isCorrect": False}]}
            )


class TestGenerateResponse:
    def test_echoes_question_set_id_and_carries_provenance(self) -> None:
        response = GenerateResponse.model_validate(
            {
                "questionSetId": "01J00000000000000000000001",
                "promptVersion": "mcq/v1",
                "modelId": "llama-3.1-8b-instruct-q4_k_m",
                "requested": 5,
                "returned": 4,
                "droppedInvalid": 1,
                "questions": [_question([("Energy", True), ("Temperature", False)])],
            }
        )
        assert response.questionSetId == "01J00000000000000000000001"
        assert response.modelId == "llama-3.1-8b-instruct-q4_k_m"

    def test_model_id_is_nullable(self) -> None:
        response = GenerateResponse.model_validate(
            {
                "questionSetId": "01J00000000000000000000001",
                "promptVersion": "mcq/v1",
                "modelId": None,
                "requested": 5,
                "returned": 0,
                "droppedInvalid": 0,
                "questions": [],
            }
        )
        assert response.modelId is None

    def test_forbids_unknown_fields(self) -> None:
        with pytest.raises(ValidationError):
            GenerateResponse.model_validate(
                {
                    "questionSetId": "01J00000000000000000000001",
                    "promptVersion": "mcq/v1",
                    "modelId": None,
                    "requested": 5,
                    "returned": 0,
                    "droppedInvalid": 0,
                    "questions": [],
                    "unexpected": True,
                }
            )


class TestAiProblem:
    def test_round_trips_code_title_status(self) -> None:
        problem = AiProblem(code="llm.unreachable", title="LLM is unreachable", status=503)
        assert problem.model_dump() == {"code": "llm.unreachable", "title": "LLM is unreachable", "status": 503}

    def test_forbids_unknown_fields(self) -> None:
        with pytest.raises(ValidationError):
            AiProblem.model_validate({"code": "x", "title": "y", "status": 1, "detail": "z"})

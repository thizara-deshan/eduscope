"""Cross-service fixture contract: both this Python suite and B's TypeScript
generation classification (`services/core-api/src/modules/ai/generation.ts`)
load the exact same committed JSON — there is no separately drifting copy."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from question_service.app import Settings, create_app
from question_service.llama import GenerationOutcome
from question_service.models import GenerateRequest, GenerateResponse, GeneratedOption, GeneratedQuestion

BEARER = "0123456789abcdef0123456789abcdef"

QUESTION_SERVICE_FIXTURES = Path(__file__).resolve().parent / "fixtures"
SHARED_FIXTURES = Path(__file__).resolve().parents[2] / "test" / "contract" / "fixtures"


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


class _StubLlamaClient:
    def __init__(self, outcome: GenerationOutcome) -> None:
        self._outcome = outcome
        self.http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"status": "ok"}))
        )

    async def generate(self, llm_endpoint, prompt, grammar, *, remaining_budget_ms=None):
        return self._outcome


def test_generate_request_fixture_matches_the_strict_request_model() -> None:
    payload = _load(QUESTION_SERVICE_FIXTURES / "generate-request.json")
    request = GenerateRequest.model_validate(payload)
    assert request.count.min == 3
    assert request.count.max == 5
    assert request.llmEndpoint == "http://127.0.0.1:7200"


def test_generation_response_fixture_matches_the_strict_response_model() -> None:
    payload = _load(SHARED_FIXTURES / "question-generation-response.json")
    response = GenerateResponse.model_validate(payload)
    assert response.questionSetId == "01J00000000000000000000001"
    assert response.promptVersion == "mcq/v1"
    assert response.requested == 5
    assert response.returned == 4
    assert response.droppedInvalid == 1


def test_error_fixtures_carry_the_exact_status_and_body_the_app_returns() -> None:
    errors = _load(SHARED_FIXTURES / "question-errors.json")
    assert set(errors) == {"unreachable", "timeout", "invalidPayload", "badRequest"}

    assert errors["unreachable"] == {
        "status": 503,
        "body": {"code": "llm.unreachable", "title": "LLM is unreachable", "status": 503},
    }
    assert errors["timeout"] == {
        "status": 504,
        "body": {"code": "llm.timeout", "title": "LLM generation timed out", "status": 504},
    }
    assert errors["invalidPayload"] == {
        "status": 422,
        "body": {"code": "llm.invalid-payload", "title": "LLM returned no valid questions", "status": 422},
    }
    assert errors["badRequest"] == {
        "status": 400,
        "body": {"code": "bad-request", "title": "Invalid generation request", "status": 400},
    }


def test_error_fixture_status_codes_match_current_b_failure_classification() -> None:
    # generation.ts: 422 -> invalid-payload, 504 -> timeout, everything else
    # AiServiceError raises -> unreachable. 400 never reaches that classifier
    # (it is a caller bug, not an LLM outcome) — asserted separately above.
    errors = _load(SHARED_FIXTURES / "question-errors.json")
    assert errors["invalidPayload"]["status"] == 422
    assert errors["timeout"]["status"] == 504
    assert errors["unreachable"]["status"] not in (422, 504)


def test_live_app_response_shape_matches_the_committed_fixture() -> None:
    fixture_request = _load(QUESTION_SERVICE_FIXTURES / "generate-request.json")
    fixture_response = _load(SHARED_FIXTURES / "question-generation-response.json")

    survivor = GeneratedQuestion(
        prompt=fixture_response["questions"][0]["prompt"],
        options=[GeneratedOption(**option) for option in fixture_response["questions"][0]["options"]],
    )
    outcome = GenerationOutcome(
        survivors=[survivor] * fixture_response["returned"],
        dropped_invalid=fixture_response["droppedInvalid"],
        model_id=fixture_response["modelId"],
        completion_count=1,
    )

    app = create_app(Settings(internal_bearer=BEARER), llama_client=_StubLlamaClient(outcome))
    with TestClient(app) as client:
        response = client.post(
            "/generate", json=fixture_request, headers={"Authorization": f"Bearer {BEARER}"}
        )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == set(fixture_response)
    assert body["questionSetId"] == fixture_response["questionSetId"]
    assert body["promptVersion"] == fixture_response["promptVersion"]
    assert body["requested"] == fixture_response["requested"]
    assert body["returned"] == fixture_response["returned"]
    assert body["droppedInvalid"] == fixture_response["droppedInvalid"]
    assert body["modelId"] == fixture_response["modelId"]

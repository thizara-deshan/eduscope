from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from question_service.app import Settings, create_app
from question_service.llama import GenerationOutcome, LlamaClient, LlamaUnreachableError
from question_service.models import GeneratedOption, GeneratedQuestion

BEARER = "0123456789abcdef0123456789abcdef"
FIXTURE = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "generate-request.json").read_text()
)


def _settings(**overrides) -> Settings:
    return Settings(internal_bearer=BEARER, **overrides)


def _survivor(prompt: str = "What remains constant?") -> GeneratedQuestion:
    return GeneratedQuestion(
        prompt=prompt,
        options=[GeneratedOption(text="Energy", isCorrect=True), GeneratedOption(text="Temperature", isCorrect=False)],
    )


class _StubLlamaClient:
    """A minimal double satisfying app.py's two touch points on a llama
    client: `.generate(...)` (used by /generate) and `.http_client` (reused
    by /probe so the app doesn't open a second live connection)."""

    def __init__(self, *, outcome=None, exception=None) -> None:
        self._outcome = outcome
        self._exception = exception
        self.calls: list[dict] = []
        self.http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"status": "ok"}))
        )

    async def generate(self, llm_endpoint, prompt, grammar, *, remaining_budget_ms=None):
        self.calls.append({"llm_endpoint": llm_endpoint, "prompt": prompt, "grammar": grammar})
        if self._exception is not None:
            raise self._exception
        return self._outcome


def _outcome(survivor_count: int = 4, dropped: int = 1) -> GenerationOutcome:
    return GenerationOutcome(
        survivors=[_survivor(f"q{i}") for i in range(survivor_count)],
        dropped_invalid=dropped,
        model_id="llama-3.1-8b-instruct-q4_k_m",
        completion_count=1,
    )


def _client(llama_client) -> TestClient:
    app = create_app(_settings(), llama_client=llama_client)
    return TestClient(app)


class TestHealthAndAuth:
    def test_healthz_is_public_and_ok(self) -> None:
        with _client(_StubLlamaClient(outcome=_outcome())) as client:
            response = client.get("/healthz")
        assert response.status_code == 200

    @pytest.mark.parametrize("path", ["/status", "/probe?llmEndpoint=http://127.0.0.1:7200"])
    def test_get_routes_require_bearer(self, path: str) -> None:
        with _client(_StubLlamaClient(outcome=_outcome())) as client:
            response = client.get(path)
        assert response.status_code == 401
        assert response.json() == {"code": "unauthorized", "title": "Unauthorized", "status": 401}

    def test_generate_requires_bearer(self) -> None:
        with _client(_StubLlamaClient(outcome=_outcome())) as client:
            response = client.post("/generate", json=FIXTURE)
        assert response.status_code == 401

    def test_bind_host_rejects_non_loopback(self) -> None:
        with pytest.raises(Exception):
            Settings(internal_bearer=BEARER, bind_host="0.0.0.0")


class TestGenerateRoute:
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {BEARER}"}

    def test_returns_200_with_the_validated_batch(self) -> None:
        with _client(_StubLlamaClient(outcome=_outcome())) as client:
            response = client.post("/generate", json=FIXTURE, headers=self._headers())

        assert response.status_code == 200
        body = response.json()
        assert body["questionSetId"] == FIXTURE["questionSetId"]
        assert body["promptVersion"] == "mcq/v1"
        assert body["requested"] == 5
        assert body["returned"] == 4
        assert body["droppedInvalid"] == 1
        assert body["modelId"] == "llama-3.1-8b-instruct-q4_k_m"

    def test_unknown_prompt_version_is_400_bad_request(self) -> None:
        body = {**FIXTURE, "promptVersion": "mcq/v99"}
        with _client(_StubLlamaClient(outcome=_outcome())) as client:
            response = client.post("/generate", json=body, headers=self._headers())

        assert response.status_code == 400
        assert response.json() == {"code": "bad-request", "title": "Invalid generation request", "status": 400}

    def test_malformed_body_is_400_bad_request(self) -> None:
        malformed = {**FIXTURE, "count": {"min": 3}}  # missing required "max"
        with _client(_StubLlamaClient(outcome=_outcome())) as client:
            response = client.post("/generate", json=malformed, headers=self._headers())

        assert response.status_code == 400
        assert response.json() == {"code": "bad-request", "title": "Invalid generation request", "status": 400}

    def test_unreachable_llm_is_503(self) -> None:
        with _client(_StubLlamaClient(exception=LlamaUnreachableError())) as client:
            response = client.post("/generate", json=FIXTURE, headers=self._headers())

        assert response.status_code == 503
        assert response.json() == {"code": "llm.unreachable", "title": "LLM is unreachable", "status": 503}

    def test_zero_survivors_is_422(self) -> None:
        empty_outcome = GenerationOutcome(survivors=[], dropped_invalid=3, model_id=None, completion_count=2)
        with _client(_StubLlamaClient(outcome=empty_outcome)) as client:
            response = client.post("/generate", json=FIXTURE, headers=self._headers())

        assert response.status_code == 422
        assert response.json() == {
            "code": "llm.invalid-payload",
            "title": "LLM returned no valid questions",
            "status": 422,
        }

    def test_deadline_is_504(self) -> None:
        settings = _settings(generation_deadline_seconds=0.02)

        class SlowStub(_StubLlamaClient):
            async def generate(self, *args, **kwargs):
                import asyncio

                await asyncio.sleep(1.0)
                return _outcome()

        app = create_app(settings, llama_client=SlowStub())
        with TestClient(app) as client:
            response = client.post("/generate", json=FIXTURE, headers={"Authorization": f"Bearer {BEARER}"})

        assert response.status_code == 504
        assert response.json() == {"code": "llm.timeout", "title": "LLM generation timed out", "status": 504}


class TestStatusRoute:
    def test_reports_prompt_versions_and_null_llm_endpoint_before_any_generation(self) -> None:
        with _client(_StubLlamaClient(outcome=_outcome())) as client:
            response = client.get("/status", headers={"Authorization": f"Bearer {BEARER}"})

        assert response.status_code == 200
        body = response.json()
        assert body["promptVersions"] == ["mcq/v1"]
        assert body["llmEndpoint"] is None
        assert body["lastGenerationAt"] is None
        assert body["lastError"] is None

    def test_reflects_last_error_after_a_failed_generation_without_leaking_secrets(self) -> None:
        stub = _StubLlamaClient(exception=LlamaUnreachableError())
        with _client(stub) as client:
            client.post("/generate", json=FIXTURE, headers={"Authorization": f"Bearer {BEARER}"})
            response = client.get("/status", headers={"Authorization": f"Bearer {BEARER}"})

        body = response.json()
        assert body["lastGenerationAt"] is not None
        assert body["lastError"] == {"code": "llm.unreachable", "title": "LLM is unreachable", "status": 503}
        rendered = json.dumps(body)
        assert FIXTURE["llmEndpoint"] not in rendered
        assert FIXTURE["transcript"]["text"] not in rendered

    def test_clears_last_error_after_a_subsequent_success(self) -> None:
        stub = _StubLlamaClient(exception=LlamaUnreachableError())
        with _client(stub) as client:
            client.post("/generate", json=FIXTURE, headers={"Authorization": f"Bearer {BEARER}"})
            stub._exception = None
            stub._outcome = _outcome()
            client.post("/generate", json=FIXTURE, headers={"Authorization": f"Bearer {BEARER}"})
            response = client.get("/status", headers={"Authorization": f"Bearer {BEARER}"})

        assert response.json()["lastError"] is None


class TestProbeRoute:
    def test_probe_reaches_the_llm_health_endpoint(self) -> None:
        real_client = LlamaClient(
            httpx.AsyncClient(
                transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"status": "ok"}))
            )
        )
        with _client(real_client) as client:
            response = client.get(
                "/probe?llmEndpoint=http://127.0.0.1:7200", headers={"Authorization": f"Bearer {BEARER}"}
            )

        assert response.status_code == 200
        assert response.json()["reachable"] is True

    def test_probe_returns_200_even_when_unreachable(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        real_client = LlamaClient(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        with _client(real_client) as client:
            response = client.get(
                "/probe?llmEndpoint=http://127.0.0.1:7200", headers={"Authorization": f"Bearer {BEARER}"}
            )

        assert response.status_code == 200
        body = response.json()
        assert body["reachable"] is False
        assert body["latencyMs"] is None

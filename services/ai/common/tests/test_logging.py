from __future__ import annotations

import json

import httpx
import pytest

from eduscope_ai_common.logging import ProductLogClient, ProductLogError, configure_logging


def test_configure_logging_emits_required_json_keys(capsys: pytest.CaptureFixture[str]) -> None:
    logger = configure_logging("stt")
    logger.info("ready")

    line = capsys.readouterr().err.strip().splitlines()[-1]
    entry = json.loads(line)

    assert entry["service"] == "ai"
    assert entry["context"]["subservice"] == "stt"
    assert entry["level"] == "INFO"
    assert entry["message"] == "ready"
    assert "at" in entry


def test_configure_logging_rejects_secret_shaped_context_keys(
    capsys: pytest.CaptureFixture[str],
) -> None:
    logger = configure_logging("question")
    logger.info(
        "generated",
        extra={
            "context": {
                "promptText": "leak",
                "transcriptWindow": "leak",
                "llmEndpoint": "http://lan/llm",
                "count": 3,
            }
        },
    )

    entry = json.loads(capsys.readouterr().err.strip().splitlines()[-1])

    assert "promptText" not in entry["context"]
    assert "transcriptWindow" not in entry["context"]
    assert "llmEndpoint" not in entry["context"]
    assert entry["context"]["count"] == 3
    assert entry["context"]["subservice"] == "question"


async def test_product_log_client_posts_expected_body_and_headers() -> None:
    captured: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["authorization"] = request.headers["authorization"]
        captured["body"] = json.loads(request.content)
        return httpx.Response(200)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = ProductLogClient(
            core_api_base_url="http://127.0.0.1:5000",
            bearer_token="secret-bearer-value",
            subservice="slide",
            http_client=http_client,
        )
        await client.write(
            "WARN", "System", "ocr failed", session_id="sess-1", context={"queueDepth": 2}
        )

    assert captured["url"] == "http://127.0.0.1:5000/internal/logs"
    assert captured["authorization"] == "Bearer secret-bearer-value"
    assert captured["body"] == {
        "level": "WARN",
        "category": "System",
        "service": "ai",
        "message": "ocr failed",
        "context": {"subservice": "slide", "queueDepth": 2},
        "sessionId": "sess-1",
    }


async def test_product_log_client_strips_secret_shaped_context() -> None:
    captured: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = ProductLogClient(
            core_api_base_url="http://127.0.0.1:5000",
            bearer_token="secret-bearer-value",
            subservice="stt",
            http_client=http_client,
        )
        await client.write("INFO", "Session", "segment", context={"transcript": "leak"})

    body = captured["body"]
    assert "transcript" not in body["context"]  # type: ignore[operator]


async def test_product_log_client_wraps_failure_without_leaking_bearer_or_response() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            503, text="core-api down at http://127.0.0.1:5000/internal/logs?token=leak"
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = ProductLogClient(
            core_api_base_url="http://127.0.0.1:5000",
            bearer_token="super-secret-bearer",
            subservice="stt",
            http_client=http_client,
        )
        with pytest.raises(ProductLogError) as excinfo:
            await client.write("ERROR", "System", "boom")

    message = str(excinfo.value)
    assert "super-secret-bearer" not in message
    assert "token=leak" not in message

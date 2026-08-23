from __future__ import annotations

import httpx
import pytest
from question_service.probe import probe


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_healthy_2xx_response_is_reachable_with_measured_latency() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/health"
        return httpx.Response(200, json={"status": "ok", "model": "llama-3.1-8b-instruct-q4_k_m"})

    ticks = iter([1.0, 1.25])

    async with _client(handler) as http_client:
        result = await probe(http_client, "http://127.0.0.1:7200", clock=lambda: next(ticks))

    assert result.reachable is True
    assert result.latencyMs == pytest.approx(250.0)
    assert result.model == "llama-3.1-8b-instruct-q4_k_m"


@pytest.mark.asyncio
async def test_missing_health_route_falls_back_to_a_one_token_completion() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/health":
            return httpx.Response(404)
        assert request.url.path == "/completion"
        import json

        body = json.loads(request.content)
        assert body == {"prompt": "", "n_predict": 1}
        return httpx.Response(200, json={"content": "x"})

    async with _client(handler) as http_client:
        result = await probe(http_client, "http://127.0.0.1:7200")

    assert calls == ["/health", "/completion"]
    assert result.reachable is True


@pytest.mark.asyncio
async def test_405_on_health_also_falls_back_to_completion() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(405)
        return httpx.Response(200, json={"content": "x"})

    async with _client(handler) as http_client:
        result = await probe(http_client, "http://127.0.0.1:7200")

    assert result.reachable is True


@pytest.mark.asyncio
async def test_fallback_completion_failure_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(404)
        return httpx.Response(500)

    async with _client(handler) as http_client:
        result = await probe(http_client, "http://127.0.0.1:7200")

    assert result.reachable is False
    assert result.latencyMs is None


@pytest.mark.asyncio
async def test_other_status_codes_are_unreachable_without_fallback() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(500)

    async with _client(handler) as http_client:
        result = await probe(http_client, "http://127.0.0.1:7200")

    assert result.reachable is False
    assert calls == ["/health"]


@pytest.mark.asyncio
async def test_connect_failure_is_unreachable_with_http_200_semantics() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    async with _client(handler) as http_client:
        result = await probe(http_client, "http://127.0.0.1:7200")

    assert result.reachable is False
    assert result.latencyMs is None


@pytest.mark.asyncio
async def test_dns_failure_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("name or service not known", request=request)

    async with _client(handler) as http_client:
        result = await probe(http_client, "http://llm.invalid")

    assert result.reachable is False


@pytest.mark.asyncio
async def test_timeout_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    async with _client(handler) as http_client:
        result = await probe(http_client, "http://127.0.0.1:7200")

    assert result.reachable is False


@pytest.mark.asyncio
async def test_recovers_from_unreachable_to_reachable_across_calls() -> None:
    attempts: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(len(attempts))
        if len(attempts) == 1:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(200, json={"status": "ok"})

    async with _client(handler) as http_client:
        first = await probe(http_client, "http://127.0.0.1:7200")
        second = await probe(http_client, "http://127.0.0.1:7200")

    assert first.reachable is False
    assert second.reachable is True


@pytest.mark.asyncio
async def test_strips_a_trailing_slash_from_the_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://127.0.0.1:7200/health"
        return httpx.Response(200, json={"status": "ok"})

    async with _client(handler) as http_client:
        await probe(http_client, "http://127.0.0.1:7200/")

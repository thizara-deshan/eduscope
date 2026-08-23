from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Callable

import httpx
import pytest
from question_service.llama import LlamaClient, LlamaUnreachableError

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "responses"
GRAMMAR = 'root ::= "[" "]"\n'


def _fixture(name: str) -> dict:
    return json.loads((FIXTURE_DIR / f"{name}.json").read_text())


def _make_client(handler: Callable[[httpx.Request], httpx.Response]) -> tuple[LlamaClient, httpx.AsyncClient]:
    transport = httpx.MockTransport(handler)
    http_client = httpx.AsyncClient(transport=transport)
    return LlamaClient(http_client), http_client


@pytest.mark.asyncio
async def test_complete_sends_the_exact_documented_request_body() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"content": "[]", "model": "m"})

    client, http_client = _make_client(handler)
    async with http_client:
        await client.complete("http://127.0.0.1:7200", "the prompt", GRAMMAR)

    assert len(captured) == 1
    request = captured[0]
    assert request.url == httpx.URL("http://127.0.0.1:7200/completion")
    body = json.loads(request.content)
    assert body == {
        "prompt": "the prompt",
        "n_predict": 1200,
        "temperature": 0.3,
        "grammar": GRAMMAR,
        "cache_prompt": True,
    }


@pytest.mark.asyncio
async def test_complete_strips_a_trailing_slash_from_the_endpoint() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"content": "[]", "model": "m"})

    client, http_client = _make_client(handler)
    async with http_client:
        await client.complete("http://127.0.0.1:7200/", "p", GRAMMAR)

    assert str(captured[0].url) == "http://127.0.0.1:7200/completion"


@pytest.mark.asyncio
async def test_connect_refusal_maps_to_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client, http_client = _make_client(handler)
    async with http_client:
        with pytest.raises(LlamaUnreachableError) as excinfo:
            await client.complete("http://127.0.0.1:7200", "p", GRAMMAR)

    assert excinfo.value.problem.code == "llm.unreachable"
    assert excinfo.value.problem.status == 503
    assert "127.0.0.1" not in str(excinfo.value)


@pytest.mark.asyncio
async def test_dns_failure_maps_to_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("name or service not known", request=request)

    client, http_client = _make_client(handler)
    async with http_client:
        with pytest.raises(LlamaUnreachableError):
            await client.complete("http://llm.invalid", "p", GRAMMAR)


@pytest.mark.asyncio
async def test_non_2xx_yields_no_content_without_raising() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="internal error")

    client, http_client = _make_client(handler)
    async with http_client:
        completion = await client.complete("http://127.0.0.1:7200", "p", GRAMMAR)

    assert completion.content is None
    assert completion.model is None


@pytest.mark.asyncio
async def test_invalid_response_body_yields_no_content() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not json")

    client, http_client = _make_client(handler)
    async with http_client:
        completion = await client.complete("http://127.0.0.1:7200", "p", GRAMMAR)

    assert completion.content is None


@pytest.mark.asyncio
async def test_non_string_content_field_is_treated_as_missing() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"content": 12345, "model": "m"})

    client, http_client = _make_client(handler)
    async with http_client:
        completion = await client.complete("http://127.0.0.1:7200", "p", GRAMMAR)

    assert completion.content is None


@pytest.mark.asyncio
async def test_cancellation_propagates_instead_of_being_swallowed() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(30)
        return httpx.Response(200, json={"content": "[]"})

    client, http_client = _make_client(handler)
    async with http_client:
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(client.complete("http://127.0.0.1:7200", "p", GRAMMAR), timeout=0.05)


@pytest.mark.asyncio
async def test_generate_repairs_exactly_once_when_zero_items_survive_nonempty_content() -> None:
    calls: list[dict] = []
    valid_content = _fixture("valid")["content"]

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            return httpx.Response(200, json=_fixture("repairable"))
        return httpx.Response(200, json={"content": valid_content, "model": "m"})

    client, http_client = _make_client(handler)
    async with http_client:
        outcome = await client.generate("http://127.0.0.1:7200", "the prompt", GRAMMAR)

    assert len(calls) == 2
    assert outcome.completion_count == 2
    assert len(outcome.survivors) == 4
    # The repair prompt carries validation errors and the base prompt, but
    # never fabricates prompt/transcript content of its own.
    assert calls[1]["prompt"].startswith("the prompt")
    assert "Return only corrected JSON." in calls[1]["prompt"]
    assert calls[1]["grammar"] == GRAMMAR


@pytest.mark.asyncio
async def test_generate_never_repairs_more_than_once() -> None:
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return httpx.Response(200, json=_fixture("repairable"))

    client, http_client = _make_client(handler)
    async with http_client:
        outcome = await client.generate("http://127.0.0.1:7200", "p", GRAMMAR)

    assert len(calls) == 2
    assert outcome.completion_count == 2
    assert outcome.survivors == []


@pytest.mark.asyncio
async def test_generate_does_not_repair_when_the_first_attempt_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    client, http_client = _make_client(handler)
    async with http_client:
        with pytest.raises(LlamaUnreachableError):
            await client.generate("http://127.0.0.1:7200", "p", GRAMMAR)


@pytest.mark.asyncio
async def test_generate_does_not_repair_when_content_is_empty() -> None:
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return httpx.Response(500, text="down")

    client, http_client = _make_client(handler)
    async with http_client:
        outcome = await client.generate("http://127.0.0.1:7200", "p", GRAMMAR)

    assert len(calls) == 1
    assert outcome.completion_count == 1
    assert outcome.survivors == []


@pytest.mark.asyncio
async def test_generate_does_not_repair_when_the_whole_call_is_cancelled() -> None:
    calls: list[dict] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        await asyncio.sleep(30)
        return httpx.Response(200, json={"content": "[]"})

    client, http_client = _make_client(handler)
    async with http_client:
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(client.generate("http://127.0.0.1:7200", "p", GRAMMAR), timeout=0.05)

    assert len(calls) == 1


@pytest.mark.asyncio
async def test_generate_uses_the_completion_model_without_calling_props() -> None:
    props_calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/props":
            props_calls.append(request)
            return httpx.Response(200, json={"model": "from-props"})
        return httpx.Response(200, json={"content": _fixture("valid")["content"], "model": "from-completion"})

    client, http_client = _make_client(handler)
    async with http_client:
        outcome = await client.generate("http://127.0.0.1:7200", "p", GRAMMAR, remaining_budget_ms=10000)

    assert outcome.model_id == "from-completion"
    assert props_calls == []


@pytest.mark.asyncio
async def test_resolve_model_id_falls_back_to_props_when_budget_permits() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/props"
        return httpx.Response(200, json={"model": "from-props"})

    client, http_client = _make_client(handler)
    async with http_client:
        model_id = await client.resolve_model_id(
            "http://127.0.0.1:7200", completion_model=None, remaining_budget_ms=10000
        )

    assert model_id == "from-props"


@pytest.mark.asyncio
async def test_resolve_model_id_skips_props_when_budget_is_insufficient() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not call the network when the budget is insufficient")

    client, http_client = _make_client(handler)
    async with http_client:
        model_id = await client.resolve_model_id(
            "http://127.0.0.1:7200", completion_model=None, remaining_budget_ms=100
        )

    assert model_id is None


@pytest.mark.asyncio
async def test_resolve_model_id_skips_props_when_budget_is_unspecified() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not call the network when no budget was supplied")

    client, http_client = _make_client(handler)
    async with http_client:
        model_id = await client.resolve_model_id(
            "http://127.0.0.1:7200", completion_model=None, remaining_budget_ms=None
        )

    assert model_id is None


@pytest.mark.asyncio
async def test_resolve_model_id_returns_none_when_props_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    client, http_client = _make_client(handler)
    async with http_client:
        model_id = await client.resolve_model_id(
            "http://127.0.0.1:7200", completion_model=None, remaining_budget_ms=10000
        )

    assert model_id is None

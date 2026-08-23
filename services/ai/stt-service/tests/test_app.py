from __future__ import annotations

import asyncio
import socket

import httpx
import pytest
import uvicorn
from pydantic import ValidationError

from stt_service.app import Settings, create_app
from stt_service.reader import DropOldestPcmRing

BEARER = "0123456789abcdef0123456789abcdef"


class ScriptedRecognizer:
    def __init__(self, is_final_sequence: list[bool], results: list[dict]) -> None:
        self._is_final_sequence = list(is_final_sequence)
        self._results = list(results)
        self._call = 0

    def accept_waveform(self, pcm: bytes) -> bool:
        value = self._is_final_sequence[self._call]
        self._call += 1
        return value

    def result(self) -> dict:
        return self._results.pop(0) if self._results else {}

    def final_result(self) -> dict:
        return self._results.pop(0) if self._results else {}


class ScriptedEngine:
    def __init__(self, recognizer_factory) -> None:
        self._factory = recognizer_factory

    def create_recognizer(self, sample_rate: int = 16000):
        return self._factory()


class FakeReader:
    def __init__(self, ring: DropOldestPcmRing) -> None:
        self.ring = ring

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None


def make_test_app(recognizer_factory=lambda: ScriptedRecognizer([], [])):
    settings = Settings(internal_bearer=BEARER)
    ring_holder: dict[str, DropOldestPcmRing] = {}

    def reader_factory(ring: DropOldestPcmRing) -> FakeReader:
        ring_holder["ring"] = ring
        return FakeReader(ring)

    app = create_app(settings, engine=ScriptedEngine(recognizer_factory), reader_factory=reader_factory)
    return app, ring_holder


def auth_headers() -> dict:
    return {"authorization": f"Bearer {BEARER}"}


@pytest.fixture
async def client():
    app, ring_holder = make_test_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://stt.test") as http_client:
        async with app.router.lifespan_context(app):
            yield http_client, ring_holder


async def test_healthz_is_public() -> None:
    app, _ = make_test_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://stt.test") as http_client:
        response = await http_client.get("/healthz")
    assert response.status_code == 200


async def test_status_requires_bearer(client) -> None:
    http_client, _ = client
    unauthenticated = await http_client.get("/status")
    assert unauthenticated.status_code == 401
    assert unauthenticated.json() == {"code": "unauthorized", "title": "Unauthorized", "status": 401}

    authenticated = await http_client.get("/status", headers=auth_headers())
    assert authenticated.status_code == 200
    assert authenticated.json()["state"] == "idle"


async def test_session_lifecycle_returns_202(client) -> None:
    http_client, _ = client
    start = await http_client.post(
        "/sessions", json={"sessionId": "01J00000000000000000000000", "anchorOffsetMs": 0}, headers=auth_headers()
    )
    assert start.status_code == 202

    pause = await http_client.post("/sessions/01J00000000000000000000000/pause", headers=auth_headers())
    assert pause.status_code == 202

    resume = await http_client.post(
        "/sessions/01J00000000000000000000000/resume", json={"anchorOffsetMs": 42000}, headers=auth_headers()
    )
    assert resume.status_code == 202

    delete = await http_client.delete("/sessions/01J00000000000000000000000", headers=auth_headers())
    assert delete.status_code == 202


async def test_conflicting_session_start_returns_409(client) -> None:
    http_client, _ = client
    await http_client.post("/sessions", json={"sessionId": "s1", "anchorOffsetMs": 0}, headers=auth_headers())
    conflict = await http_client.post("/sessions", json={"sessionId": "s2", "anchorOffsetMs": 0}, headers=auth_headers())
    assert conflict.status_code == 409
    assert conflict.json() == {"code": "session_active", "title": "An STT session is already active", "status": 409}


async def test_resume_wrong_session_returns_404(client) -> None:
    http_client, _ = client
    await http_client.post("/sessions", json={"sessionId": "s1", "anchorOffsetMs": 0}, headers=auth_headers())
    response = await http_client.post("/sessions/s2/resume", json={"anchorOffsetMs": 0}, headers=auth_headers())
    assert response.status_code == 404
    assert response.json() == {"code": "session_not_found", "title": "No matching STT session", "status": 404}


async def test_negative_anchor_offset_returns_422(client) -> None:
    http_client, _ = client
    response = await http_client.post(
        "/sessions", json={"sessionId": "s1", "anchorOffsetMs": -1}, headers=auth_headers()
    )
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "title": "Request validation failed", "status": 422}


async def test_extra_field_in_request_body_returns_422(client) -> None:
    http_client, _ = client
    response = await http_client.post(
        "/sessions", json={"sessionId": "s1", "anchorOffsetMs": 0, "extra": "nope"}, headers=auth_headers()
    )
    assert response.status_code == 422


async def _wait_for_subscriber(broker, timeout: float = 2.0) -> None:
    """SseBroker registers a subscriber only once its `subscribe()` async
    generator is first iterated by Starlette's `StreamingResponse` — pushing
    a block before that registration lands is silently lost (no replay,
    C-01). Poll instead of racing a fixed sleep against that startup."""
    async with asyncio.timeout(timeout):
        while broker.subscriber_count() == 0:
            await asyncio.sleep(0.01)


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def test_events_stream_emits_segment_after_bearer_auth() -> None:
    """Exercises the real SSE wire format end-to-end (Step 6's lifecycle
    check) over a loopback TCP server rather than httpx's in-process
    `ASGITransport`: streaming a `StreamingResponse` through `ASGITransport`
    deadlocks under this host's httpx/anyio/Python combination before
    headers are even sent — reproduced independently against C-01's own
    fixture app — so this is the one test that needs a real server socket.
    """
    recognizer = ScriptedRecognizer([True], [{"text": "one two three"}])
    app, ring_holder = make_test_app(lambda: recognizer)
    port = _free_loopback_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    server_task = asyncio.create_task(server.serve())
    try:
        async with asyncio.timeout(5.0):
            while not server.started:
                await asyncio.sleep(0.01)

        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as http_client:
            await http_client.post(
                "/sessions", json={"sessionId": "s1", "anchorOffsetMs": 0}, headers=auth_headers()
            )

            async with http_client.stream("GET", "/events", headers=auth_headers()) as response:
                assert response.status_code == 200
                await _wait_for_subscriber(app.state.broker)
                ring_holder["ring"].push(bytes(3200))

                async with asyncio.timeout(2.0):
                    collected = ""
                    async for chunk in response.aiter_text():
                        collected += chunk
                        if "evt.stt.segment" in collected:
                            break
                assert "evt.stt.segment" in collected
                assert "one two three" in collected
    finally:
        server.should_exit = True
        await server_task


async def test_events_stream_requires_bearer() -> None:
    app, _ = make_test_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://stt.test") as http_client:
        response = await http_client.get("/events")
    assert response.status_code == 401


class TestSettings:
    def test_requires_minimum_bearer_length(self) -> None:
        with pytest.raises(ValidationError):
            Settings(internal_bearer="short")

    def test_rejects_non_loopback_bind_host(self) -> None:
        with pytest.raises(ValidationError):
            Settings(internal_bearer=BEARER, bind_host="0.0.0.0")

    def test_defaults(self) -> None:
        settings = Settings(internal_bearer=BEARER)
        assert settings.bind_host == "127.0.0.1"
        assert settings.port == 7101
        assert settings.audio_socket == "/tmp/audio.sock"
        assert settings.model_path == "/opt/eduscope/models/vosk-model-en-us-0.22"
        assert settings.model_version == "vosk-model-en-us-0.22"
        assert settings.ring_blocks == 600
        assert settings.min_words == 3
        assert settings.no_audio_after_sec == 10

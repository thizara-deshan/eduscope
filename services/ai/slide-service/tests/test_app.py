from __future__ import annotations

import asyncio
import socket
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import uvicorn
from pydantic import ValidationError

from slide_service.app import Settings, create_app

from fixtures.slides import make_slide

BEARER = "0123456789abcdef0123456789abcdef"
SESSION = "01J00000000000000000000000"
SOURCE = f"/run/eduscope/slides/{SESSION}/current.png"
IMAGE_DIR = f"/media/eduscope/recordings/sessions/{SESSION}/slides"


class FakeWatcher:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[Path | None] = asyncio.Queue()

    def push(self, path: Path) -> None:
        self._queue.put_nowait(path)

    async def frames(self) -> AsyncIterator[Path]:
        while True:
            item = await self._queue.get()
            if item is None:
                return
            yield item


class ScriptedOcrEngine:
    async def extract(self, path: Path) -> str | None:
        return "scripted text"


def make_test_app(*, tmp_recordings_root: str | None = None):
    kwargs = {"internal_bearer": BEARER}
    if tmp_recordings_root is not None:
        kwargs["recordings_root"] = tmp_recordings_root
    settings = Settings(**kwargs)
    watcher_holder: dict[str, FakeWatcher] = {}

    def watcher_factory(source_path: Path) -> FakeWatcher:
        watcher = FakeWatcher()
        watcher_holder["watcher"] = watcher
        return watcher

    app = create_app(settings, watcher_factory=watcher_factory, ocr_engine=ScriptedOcrEngine())
    return app, watcher_holder


def auth_headers() -> dict:
    return {"authorization": f"Bearer {BEARER}"}


@pytest.fixture
async def client():
    app, watcher_holder = make_test_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://slide.test") as http_client:
        async with app.router.lifespan_context(app):
            yield http_client, watcher_holder


async def test_healthz_is_public() -> None:
    app, _ = make_test_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://slide.test") as http_client:
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
        "/sessions",
        json={"sessionId": SESSION, "imageDir": IMAGE_DIR, "sourcePath": SOURCE, "anchorOffsetMs": 0},
        headers=auth_headers(),
    )
    assert start.status_code == 202

    resume = await http_client.post(
        f"/sessions/{SESSION}/resume", json={"anchorOffsetMs": 42000}, headers=auth_headers()
    )
    assert resume.status_code == 202

    delete = await http_client.delete(f"/sessions/{SESSION}", headers=auth_headers())
    assert delete.status_code == 202


async def test_conflicting_session_start_returns_409(client) -> None:
    http_client, _ = client
    await http_client.post(
        "/sessions",
        json={"sessionId": SESSION, "imageDir": IMAGE_DIR, "sourcePath": SOURCE, "anchorOffsetMs": 0},
        headers=auth_headers(),
    )
    other_source = "/run/eduscope/slides/other-session/current.png"
    other_image_dir = "/media/eduscope/recordings/sessions/other-session/slides"
    conflict = await http_client.post(
        "/sessions",
        json={"sessionId": "other-session", "imageDir": other_image_dir, "sourcePath": other_source, "anchorOffsetMs": 0},
        headers=auth_headers(),
    )
    assert conflict.status_code == 409
    assert conflict.json() == {"code": "session_active", "title": "A slide session is already active", "status": 409}


async def test_resume_wrong_session_returns_404(client) -> None:
    http_client, _ = client
    await http_client.post(
        "/sessions",
        json={"sessionId": SESSION, "imageDir": IMAGE_DIR, "sourcePath": SOURCE, "anchorOffsetMs": 0},
        headers=auth_headers(),
    )
    response = await http_client.post(
        "/sessions/other-session/resume", json={"anchorOffsetMs": 0}, headers=auth_headers()
    )
    assert response.status_code == 404
    assert response.json() == {"code": "session_not_found", "title": "No matching slide session", "status": 404}


async def test_invalid_source_path_returns_400(client) -> None:
    http_client, _ = client
    response = await http_client.post(
        "/sessions",
        json={
            "sessionId": SESSION,
            "imageDir": IMAGE_DIR,
            "sourcePath": "/tmp/not-approved/current.png",
            "anchorOffsetMs": 0,
        },
        headers=auth_headers(),
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "invalid_path"
    assert body["status"] == 400


async def test_negative_anchor_offset_returns_422(client) -> None:
    http_client, _ = client
    response = await http_client.post(
        "/sessions",
        json={"sessionId": SESSION, "imageDir": IMAGE_DIR, "sourcePath": SOURCE, "anchorOffsetMs": -1},
        headers=auth_headers(),
    )
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_request", "title": "Request validation failed", "status": 422}


async def test_extra_field_in_request_body_returns_422(client) -> None:
    http_client, _ = client
    response = await http_client.post(
        "/sessions",
        json={
            "sessionId": SESSION, "imageDir": IMAGE_DIR, "sourcePath": SOURCE, "anchorOffsetMs": 0, "extra": "nope",
        },
        headers=auth_headers(),
    )
    assert response.status_code == 422


async def test_events_stream_requires_bearer() -> None:
    app, _ = make_test_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://slide.test") as http_client:
        response = await http_client.get("/events")
    assert response.status_code == 401


async def _wait_for_subscriber(broker, timeout: float = 2.0) -> None:
    async with asyncio.timeout(timeout):
        while broker.subscriber_count() == 0:
            await asyncio.sleep(0.01)


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def test_events_stream_emits_captured_after_bearer_auth(tmp_path: Path) -> None:
    """Exercises the real SSE wire format end-to-end over a loopback TCP
    server (mirrors stt-service's own equivalent test — `httpx`'s in-process
    `ASGITransport` deadlocks on a real `StreamingResponse`)."""
    recordings_root = str(tmp_path / "media" / "eduscope" / "recordings")
    image_dir = f"{recordings_root}/sessions/{SESSION}/slides"
    app, watcher_holder = make_test_app(tmp_recordings_root=recordings_root)
    port = _free_loopback_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    server_task = asyncio.create_task(server.serve())
    try:
        async with asyncio.timeout(5.0):
            while not server.started:
                await asyncio.sleep(0.01)

        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as http_client:
            start_response = await http_client.post(
                "/sessions",
                json={"sessionId": SESSION, "imageDir": image_dir, "sourcePath": SOURCE, "anchorOffsetMs": 0},
                headers=auth_headers(),
            )
            assert start_response.status_code == 202

            async with http_client.stream("GET", "/events", headers=auth_headers()) as response:
                assert response.status_code == 200
                await _wait_for_subscriber(app.state.broker)

                frame1 = tmp_path / "f1.png"
                make_slide(frame1, title="Title Slide")
                frame2 = tmp_path / "f2.png"
                make_slide(frame2, title="Second Slide", lines=["Totally different"] * 4, bg=(20, 20, 20))
                watcher_holder["watcher"].push(frame1)
                await asyncio.sleep(0.05)
                watcher_holder["watcher"].push(frame2)

                async with asyncio.timeout(3.0):
                    collected = ""
                    async for chunk in response.aiter_text():
                        collected += chunk
                        if "evt.slide.captured" in collected:
                            break
                assert "evt.slide.captured" in collected
                assert "scripted text" in collected
    finally:
        server.should_exit = True
        await server_task


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
        assert settings.port == 7102
        assert settings.runtime_root == "/run/eduscope"
        assert settings.recordings_root == "/media/eduscope/recordings"
        assert settings.phash_threshold == 10
        assert settings.poll_interval_sec == 1.0
        assert settings.ocr_queue_size == 4

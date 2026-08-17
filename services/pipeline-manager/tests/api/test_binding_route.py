from __future__ import annotations

import pytest

from pipeline_manager.models import PublisherId
from pipeline_manager.publishers.base import PublisherBinding


@pytest.mark.asyncio
async def test_bind_returns_202_and_never_echoes_credentials(client, auth_headers) -> None:
    response = await client.put(
        "/publishers/rtsp/binding",
        headers=auth_headers,
        json={"address": "rtsp://cam1:554/stream", "credentials": {"username": "admin", "password": "s3cret"}},
    )
    assert response.status_code == 202
    body = response.json()
    assert body == {"publisherId": "rtsp", "state": body["state"]}
    # the password (and any credential) must never appear in the response
    assert "s3cret" not in response.text
    assert "password" not in response.text


@pytest.mark.asyncio
async def test_bind_marks_publisher_bound_in_sources_and_status(client, auth_headers) -> None:
    await client.put(
        "/publishers/rtsp/binding",
        headers=auth_headers,
        json={"address": "rtsp://cam1"},
    )
    sources = (await client.get("/sources", headers=auth_headers)).json()
    assert sources["rtsp"]["bound"] is True
    assert sources["usb"]["bound"] is False

    status = (await client.get("/status", headers=auth_headers)).json()
    assert status["publishers"]["rtsp"]["bound"] is True
    assert status["publishers"]["usb"]["bound"] is False


@pytest.mark.asyncio
async def test_bind_unknown_publisher_is_404(client, auth_headers) -> None:
    response = await client.put(
        "/publishers/nope/binding", headers=auth_headers, json={"address": "rtsp://x"}
    )
    assert response.status_code == 404
    assert response.json()["code"] == "consumer_not_found"


@pytest.mark.asyncio
async def test_bind_stores_structured_binding_and_resets_budget(app, client, auth_headers) -> None:
    controller = app.state.publishers[PublisherId.RTSP]
    controller.restart_budget.record_attempt()
    controller.restart_budget.record_attempt()

    await client.put(
        "/publishers/rtsp/binding",
        headers=auth_headers,
        json={"address": "rtsp://cam1", "credentials": {"username": "u", "password": "p"}, "devicePath": None},
    )

    assert isinstance(controller.binding, PublisherBinding)
    assert controller.binding.address == "rtsp://cam1"
    assert controller.binding.password == "p"  # stored for spawn-time property tokens
    assert controller.binding.redacted().password == "<redacted>"
    assert controller.restart_budget.attempts == []  # budget reset on binding change


@pytest.mark.asyncio
async def test_bind_rejects_extra_fields(client, auth_headers) -> None:
    response = await client.put(
        "/publishers/rtsp/binding",
        headers=auth_headers,
        json={"address": "rtsp://cam1", "surprise": "no"},
    )
    assert response.status_code == 422  # pydantic extra="forbid"

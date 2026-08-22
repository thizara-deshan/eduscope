from __future__ import annotations

import sys

import pytest


@pytest.mark.asyncio
async def test_publisher_start_returns_202(client, auth_headers) -> None:
    response = await client.post("/publishers/usb/start", headers=auth_headers)
    assert response.status_code == 202
    body = response.json()
    assert body["state"] != "running"  # 202 accepted, never final state


@pytest.mark.asyncio
async def test_publisher_stop_returns_202(client, auth_headers) -> None:
    response = await client.post("/publishers/usb/stop", headers=auth_headers)
    assert response.status_code == 202


@pytest.mark.asyncio
async def test_record_start_returns_202_and_never_final_state(client, auth_headers, online_publishers, tmp_path) -> None:
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "cam-1", "outputPath": str(tmp_path / "seg.ts")},
    )
    assert response.status_code == 202
    body = response.json()
    assert body["state"] == "starting"
    assert body["state"] != "running"


@pytest.mark.asyncio
async def test_live_start_returns_202(client, auth_headers, online_publishers) -> None:
    response = await client.post(
        "/consumers/live", headers=auth_headers, json={"preset": "cam-1", "streamKey": "bench"}
    )
    assert response.status_code == 202


@pytest.mark.asyncio
async def test_meeting_start_returns_202(client, auth_headers, online_publishers) -> None:
    response = await client.post("/consumers/meeting", headers=auth_headers, json={"preset": "cam-1"})
    assert response.status_code == 202


@pytest.mark.asyncio
async def test_snapshot_start_returns_202(client, auth_headers, tmp_path) -> None:
    response = await client.post(
        "/consumers/snapshot/start",
        headers=auth_headers,
        json={"intervalSec": 5, "outputPath": str(tmp_path / "out.png")},
    )
    assert response.status_code == 202


@pytest.mark.asyncio
async def test_projector_mode_switch_returns_202(client, auth_headers) -> None:
    response = await client.post("/consumers/projector", headers=auth_headers, json={"mode": "passthrough"})
    assert response.status_code == 202


@pytest.mark.asyncio
async def test_thumbnail_offer_returns_202(client, auth_headers, online_publishers) -> None:
    response = await client.post(
        "/consumers/thumbnails/offer",
        headers=auth_headers,
        json={"negotiationId": "n1", "roleId": "presentation", "sdp": "v=0..."},
    )
    assert response.status_code == 202


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="targeted EOS stop needs real process-group signals; POSIX-only, verified on target")
async def test_thumbnail_close_is_idempotent(client, auth_headers, online_publishers) -> None:
    await client.post(
        "/consumers/thumbnails/offer",
        headers=auth_headers,
        json={"negotiationId": "n1", "roleId": "presentation", "sdp": "v=0..."},
    )
    first = await client.delete("/consumers/thumbnails/n1", headers=auth_headers)
    second = await client.delete("/consumers/thumbnails/n1", headers=auth_headers)
    assert first.status_code == 202
    assert second.status_code == 202


@pytest.mark.asyncio
async def test_generic_stop_on_unknown_consumer_is_404(client, auth_headers) -> None:
    response = await client.post("/consumers/record:does-not-exist/stop", headers=auth_headers)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_audio_control_route(client, auth_headers) -> None:
    response = await client.put("/audio/controls/mic-lecturer", headers=auth_headers, json={"gain": 50, "muted": False})
    assert response.status_code == 200
    assert response.json()["appliedState"] == "failed"  # no real amixer on this dev host


@pytest.mark.asyncio
async def test_audio_level_subscription_create_and_delete(client, auth_headers) -> None:
    created = await client.post("/audio/levels/subscriptions", headers=auth_headers)
    assert created.status_code == 201
    sub_id = created.json()["subscriptionId"]
    deleted = await client.delete(f"/audio/levels/subscriptions/{sub_id}", headers=auth_headers)
    assert deleted.status_code == 204


@pytest.mark.asyncio
async def test_device_led_route(client, auth_headers) -> None:
    response = await client.post("/device/led", headers=auth_headers, json={"mode": "blink"})
    assert response.status_code == 200

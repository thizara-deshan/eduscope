from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_status_includes_required_top_level_fields(client, auth_headers) -> None:
    response = await client.get("/status", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) >= {"platform", "encodeLedger", "publishers", "consumers", "device", "sequence"}


@pytest.mark.asyncio
async def test_status_lists_all_four_publishers(client, auth_headers) -> None:
    response = await client.get("/status", headers=auth_headers)
    body = response.json()
    assert set(body["publishers"].keys()) == {"usb", "rtsp", "rtsp2", "audio"}


@pytest.mark.asyncio
async def test_status_sequence_is_monotonic_and_starts_at_zero(client, auth_headers, tmp_path) -> None:
    first = (await client.get("/status", headers=auth_headers)).json()
    assert first["sequence"] == 0

    await client.post(
        "/consumers/snapshot/start",
        headers=auth_headers,
        json={"intervalSec": 5, "outputPath": str(tmp_path / "out.png")},
    )

    second = (await client.get("/status", headers=auth_headers)).json()
    assert second["sequence"] > first["sequence"]


@pytest.mark.asyncio
async def test_status_encode_ledger_shape(client, auth_headers) -> None:
    response = await client.get("/status", headers=auth_headers)
    ledger = response.json()["encodeLedger"]
    assert ledger["capacity"] == 3
    assert "inUse" in ledger
    assert "reservedBy" in ledger


@pytest.mark.asyncio
async def test_status_reflects_a_running_consumer(client, auth_headers, online_publishers, tmp_path) -> None:
    await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "cam-1", "outputPath": str(tmp_path / "seg.ts")},
    )
    response = await client.get("/status", headers=auth_headers)
    consumers = response.json()["consumers"]
    assert len(consumers) == 1
    assert consumers[0]["state"] == "running"


@pytest.mark.asyncio
async def test_sources_route(client, auth_headers) -> None:
    response = await client.get("/sources", headers=auth_headers)
    assert response.status_code == 200
    assert set(response.json().keys()) == {"usb", "rtsp", "rtsp2", "audio"}

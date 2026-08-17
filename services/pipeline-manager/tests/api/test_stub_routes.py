from __future__ import annotations

import sys

import pytest

from pipeline_manager.models import SourceRole


# ── thumbnails start: allowlist wiring (no process signals — runs anywhere) ──


@pytest.mark.asyncio
async def test_thumbnails_start_sets_and_clears_allowlist(app, client, auth_headers) -> None:
    response = await client.post(
        "/consumers/thumbnails/start",
        headers=auth_headers,
        json={"sources": ["presentation", "lecturer-cam"]},
    )
    assert response.status_code == 202
    assert app.state.thumbnails.allowed_roles == frozenset(
        {SourceRole.PRESENTATION, SourceRole.LECTURER_CAM}
    )

    # start with no sources means "no restriction" — allowlist clears
    await client.post("/consumers/thumbnails/start", headers=auth_headers, json={})
    assert app.state.thumbnails.allowed_roles is None


@pytest.mark.asyncio
async def test_thumbnails_start_rejects_unknown_source(client, auth_headers) -> None:
    response = await client.post(
        "/consumers/thumbnails/start", headers=auth_headers, json={"sources": ["not-a-role"]}
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_preset"


@pytest.mark.asyncio
async def test_thumbnails_stop_is_idempotent_when_none_open(app, client, auth_headers) -> None:
    response = await client.post("/consumers/thumbnails/stop", headers=auth_headers)
    assert response.status_code == 202
    assert app.state.thumbnails.allowed_roles is None


@pytest.mark.asyncio
async def test_snapshot_stop_is_202_when_none_running(client, auth_headers) -> None:
    response = await client.post("/consumers/snapshot/stop", headers=auth_headers)
    assert response.status_code == 202


# ── stop paths that need real process-group signals (POSIX-only) ─────────────


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="stopping a consumer needs real process-group signals; POSIX-only, verified on target")
async def test_snapshot_stop_stops_running_snapshot(app, client, auth_headers, tmp_path) -> None:
    await client.post(
        "/consumers/snapshot/start",
        headers=auth_headers,
        json={"intervalSec": 1, "outputPath": str(tmp_path / "slide.png")},
    )
    assert any(cid.startswith("snapshot:") for cid in app.state.consumers)

    response = await client.post("/consumers/snapshot/stop", headers=auth_headers)
    assert response.status_code == 202
    assert not any(cid.startswith("snapshot:") for cid in app.state.consumers)


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="closing a negotiation stops a worker via process-group signals; POSIX-only, verified on target")
async def test_thumbnails_stop_closes_open_negotiations(app, client, auth_headers, online_publishers) -> None:
    await client.post(
        "/consumers/thumbnails/offer",
        headers=auth_headers,
        json={"negotiationId": "n1", "roleId": "presentation", "sdp": "v=0..."},
    )
    assert app.state.thumbnails.negotiation_count() == 1

    response = await client.post("/consumers/thumbnails/stop", headers=auth_headers)
    assert response.status_code == 202
    assert app.state.thumbnails.negotiation_count() == 0

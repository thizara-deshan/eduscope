from __future__ import annotations

import pytest

from pipeline_manager.models import Problem
from pipeline_manager.pipelines.preflight import PreflightReport


def _assert_problem(response, code: str, status: int) -> None:
    assert response.status_code == status
    body = response.json()
    assert body["code"] == code
    assert body["status"] == status
    Problem.model_validate(body)


@pytest.mark.asyncio
async def test_invalid_preset_is_400(client, auth_headers, online_publishers) -> None:
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "not-a-real-preset", "outputPath": "/media/eduscope/recordings/seg.ts"},
    )
    _assert_problem(response, "invalid_preset", 400)


@pytest.mark.asyncio
async def test_invalid_ratio_is_400(client, auth_headers) -> None:
    response = await client.post(
        "/consumers/snapshot/start", headers=auth_headers, json={"intervalSec": 0, "outputPath": "/x.png"}
    )
    _assert_problem(response, "invalid_ratio", 400)


@pytest.mark.asyncio
async def test_preset_channel_mismatch_is_400(client, auth_headers, online_publishers) -> None:
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "pc-only", "outputPath": "/media/eduscope/recordings/seg.ts"},
    )
    _assert_problem(response, "preset_channel_mismatch", 400)


@pytest.mark.asyncio
async def test_publisher_not_running_is_409(client, auth_headers) -> None:
    # online_publishers fixture deliberately not used — publishers start OFFLINE.
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "cam-1", "outputPath": "/media/eduscope/recordings/seg.ts"},
    )
    _assert_problem(response, "publisher_not_running", 409)
    assert response.json()["meta"]["publisherId"] == "rtsp"


@pytest.mark.asyncio
async def test_encoder_budget_exceeded_is_409(client, auth_headers, online_publishers, tmp_path) -> None:
    await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "fifty-fifty", "outputPath": str(tmp_path / "a.ts")},
    )
    await client.post("/consumers/live", headers=auth_headers, json={"preset": "fifty-fifty", "streamKey": "bench"})
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "fifty-fifty", "outputPath": str(tmp_path / "b.ts")},
    )
    _assert_problem(response, "encoder_budget_exceeded", 409)


@pytest.mark.asyncio
async def test_platform_element_missing_is_422(client, app, auth_headers, online_publishers) -> None:
    app.state.preflight_check = lambda: PreflightReport(
        ok=False,
        present=(),
        problems=(
            Problem(code="platform_element_missing", title="missing", status=422, meta={"element": "mpph264enc"}),
        ),
    )
    response = await client.post(
        "/consumers/live", headers=auth_headers, json={"preset": "cam-1", "streamKey": "bench"}
    )
    _assert_problem(response, "platform_element_missing", 422)
    assert response.json()["meta"]["element"] == "mpph264enc"


@pytest.mark.asyncio
async def test_consumer_not_found_is_404(client, auth_headers) -> None:
    response = await client.post("/consumers/record:unknown/stop", headers=auth_headers)
    _assert_problem(response, "consumer_not_found", 404)


@pytest.mark.asyncio
async def test_capture_card_absent_is_503(client, app, auth_headers, online_publishers) -> None:
    app.state.watchdog.state = "recovering"
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "fifty-fifty", "outputPath": "/media/eduscope/recordings/seg.ts"},
    )
    _assert_problem(response, "capture_card_absent", 503)

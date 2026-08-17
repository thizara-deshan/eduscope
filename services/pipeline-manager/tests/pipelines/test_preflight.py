from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.preflight import PreflightRunner, ProcessResult


def completed(returncode: int, stdout: str = "", stderr: str = "") -> ProcessResult:
    return ProcessResult(returncode=returncode, stdout=stdout, stderr=stderr)


@pytest.mark.asyncio
async def test_missing_element_is_named() -> None:
    run = AsyncMock(side_effect=[completed(0), completed(1, stderr="No such element")])
    report = await PreflightRunner(run=run).inspect(["mpph264enc", "webrtcbin"])
    assert report.ok is False
    assert report.problems[0].code == "platform_element_missing"
    assert report.problems[0].meta == {"element": "webrtcbin"}


@pytest.mark.asyncio
async def test_all_present_reports_ok() -> None:
    run = AsyncMock(side_effect=[completed(0), completed(0)])
    report = await PreflightRunner(run=run).inspect(["mpph264enc", "mppvideodec"])
    assert report.ok is True
    assert report.present == ("mpph264enc", "mppvideodec")
    assert report.problems == ()


@pytest.mark.asyncio
async def test_argv_is_exactly_gst_inspect_and_element() -> None:
    run = AsyncMock(side_effect=[completed(0)])
    await PreflightRunner(run=run).inspect(["mpph264enc"])
    run.assert_awaited_once_with(["gst-inspect-1.0", "mpph264enc"])


@pytest.mark.asyncio
async def test_run_for_profile_excludes_webrtc_by_default() -> None:
    run = AsyncMock(return_value=completed(0))
    report = await PreflightRunner(run=run).run_for_profile(RK3588Profile(), include_webrtc=False)
    checked = {call.args[0][1] for call in run.await_args_list}
    assert "webrtcbin" not in checked
    assert report.ok is True


@pytest.mark.asyncio
async def test_run_for_profile_includes_webrtc_when_requested() -> None:
    run = AsyncMock(return_value=completed(0))
    await PreflightRunner(run=run).run_for_profile(RK3588Profile(), include_webrtc=True)
    checked = {call.args[0][1] for call in run.await_args_list}
    assert "webrtcbin" in checked


@pytest.mark.asyncio
async def test_no_downstream_spawn_on_missing_element() -> None:
    """A missing element must be reported; nothing downstream may act on a doomed pipeline."""
    run = AsyncMock(side_effect=[completed(1, stderr="No such element")])
    report = await PreflightRunner(run=run).inspect(["definitely_missing"])
    assert report.ok is False
    assert run.await_count == 1

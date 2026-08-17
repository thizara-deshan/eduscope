from __future__ import annotations

from typing import Sequence

import pytest

from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.preflight import (
    PreflightReport,
    PreflightRunner,
    ProcessResult,
    as_preflight_check,
    make_preflight_source,
)


def _runner(missing: set[str]) -> PreflightRunner:
    async def run(argv: Sequence[str]) -> ProcessResult:
        element = argv[1]
        code = 1 if element in missing else 0
        return ProcessResult(returncode=code, stderr="No such element" if code else "")

    return PreflightRunner(run=run)


@pytest.mark.asyncio
async def test_source_reports_ok_when_all_present() -> None:
    source = make_preflight_source(RK3588Profile(), runner=_runner(missing=set()))
    report = await source()
    assert report.ok is True
    assert "mpph264enc" in report.present
    assert report.problems == ()


@pytest.mark.asyncio
async def test_source_names_missing_element() -> None:
    source = make_preflight_source(RK3588Profile(), runner=_runner(missing={"webrtcbin"}))
    report = await source()
    assert report.ok is False
    assert report.problems[0].code == "platform_element_missing"
    assert report.problems[0].meta == {"element": "webrtcbin"}


@pytest.mark.asyncio
async def test_source_can_exclude_webrtc() -> None:
    source = make_preflight_source(
        RK3588Profile(), include_webrtc=False, runner=_runner(missing={"webrtcbin"})
    )
    report = await source()
    # webrtcbin was excluded from the required set, so its absence is not a problem
    assert report.ok is True
    assert "webrtcbin" not in report.present


def test_as_preflight_check_wraps_report() -> None:
    report = PreflightReport(ok=True, present=("mpph264enc",), problems=())
    check = as_preflight_check(report)
    assert check() is report

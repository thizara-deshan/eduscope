from __future__ import annotations

import pytest

from pipeline_manager.app import _run_shutdown, _run_startup, create_app
from pipeline_manager.config import Settings
from pipeline_manager.models import PublisherId
from pipeline_manager.pipelines.preflight import PreflightReport
from pipeline_manager.publishers.base import PublisherBinding

TOKEN = "0123456789abcdef0123456789abcdef"


def _app():
    return create_app(Settings(shared_bearer_token=TOKEN))


class _FakeConsumer:
    def __init__(self) -> None:
        self.stopped = False
        self.process = object()

    async def stop(self) -> None:
        self.stopped = True


@pytest.mark.asyncio
async def test_startup_recovers_starts_bound_publishers_and_watchdog() -> None:
    app = _app()
    started: list[PublisherId] = []

    async def spy_start(controller) -> None:
        started.append(controller.publisher_id)

    app.state.start_publisher = spy_start
    app.state.publishers[PublisherId.RTSP].bind(PublisherBinding(address="rtsp://cam1"))

    await _run_startup(app)
    try:
        assert app.state.recovery is not None
        assert app.state.recovery.adopted == ()  # nothing to adopt off-board
        assert started == [PublisherId.RTSP]  # only the bound publisher is started
        assert app.state.watchdog_task is not None
        assert not app.state.watchdog_task.done()
    finally:
        await _run_shutdown(app)

    assert app.state.watchdog_task is None  # shutdown cancelled the loop


@pytest.mark.asyncio
async def test_startup_publishes_preflight_check_when_source_present() -> None:
    app = _app()
    report = PreflightReport(ok=True, present=("mpph264enc",), problems=())

    async def source() -> PreflightReport:
        return report

    app.state.preflight_source = source
    assert app.state.preflight_check is None

    await _run_startup(app)
    try:
        assert app.state.preflight_check() is report
    finally:
        await _run_shutdown(app)


@pytest.mark.asyncio
async def test_shutdown_stops_aux_and_a_non_adopted_record() -> None:
    """Only an *actively adopted* record survives shutdown untouched — a
    record this instance itself spawned (not reconstructed from a prior
    incarnation's sidecar) is stopped like any other consumer (A-REV-007)."""
    app = _app()
    live = _FakeConsumer()
    record = _FakeConsumer()
    app.state.consumers["live:1"] = live
    app.state.consumers["record:1"] = record

    await _run_startup(app)
    await _run_shutdown(app)

    assert live.stopped is True
    assert "live:1" not in app.state.consumers
    assert record.stopped is True
    assert "record:1" not in app.state.consumers


@pytest.mark.asyncio
async def test_shutdown_leaves_an_actively_adopted_record_untouched() -> None:
    app = _app()
    adopted_record = _FakeConsumer()
    adopted_record.adopted = True
    app.state.consumers["record:1"] = adopted_record

    await _run_startup(app)
    await _run_shutdown(app)

    assert adopted_record.stopped is False  # left running for core-api recovery
    assert "record:1" in app.state.consumers

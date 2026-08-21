from __future__ import annotations

import pytest

from pipeline_manager.app import create_production_app
from pipeline_manager.audio.control import real_amixer_exec
from pipeline_manager.audio.levels import AudioLevelSampler
from pipeline_manager.config import Settings
from pipeline_manager.hardware.watchdog import real_v4l2_probe
from pipeline_manager.publishers.coordinator import start_publisher as real_start_publisher
from pipeline_manager.publishers.coordinator import stop_publisher as real_stop_publisher
from pipeline_manager.supervisor.recovery import real_proc_scanner

TOKEN = "0123456789abcdef0123456789abcdef"


def _app():
    return create_production_app(Settings(shared_bearer_token=TOKEN))


def test_watchdog_probe_is_the_real_v4l2_adapter() -> None:
    """A-REV-013: the production factory swaps the no-op probe for a real,
    argv-only `v4l2-ctl` adapter."""
    app = _app()
    assert app.state.watchdog.probe is real_v4l2_probe


def test_audio_exec_is_the_real_amixer_adapter() -> None:
    """A-REV-012: the production factory swaps the no-op audio_exec (which
    always reports rc=1) for the real, argv-only `amixer` adapter."""
    app = _app()
    assert app.state.audio_exec is real_amixer_exec


def test_start_audio_meter_is_not_the_hermetic_noop() -> None:
    """A-REV-012: production wires a real meter-tap starter, not the
    default that leaves the sampler's read_rms at a hardcoded 0.0."""
    app = _app()
    from pipeline_manager.app import _noop_start_audio_meter

    assert app.state.start_audio_meter is not _noop_start_audio_meter


def test_proc_scanner_and_expected_processes_are_real() -> None:
    app = _app()
    assert app.state.proc_scanner is real_proc_scanner


def test_publisher_coordinators_are_wired_to_the_real_functions() -> None:
    app = _app()
    assert app.state.start_publisher.func is real_start_publisher
    assert app.state.stop_publisher.func is real_stop_publisher


@pytest.mark.asyncio
async def test_start_audio_meter_replaces_the_sampler_with_a_real_meter_backed_one(monkeypatch) -> None:
    """A-REV-012: calling the real seam swaps `audio_sampler` for one backed
    by a `GstLevelMeterTap`, never touching a second ALSA capture device —
    proven here with a fake subprocess spawn so the test stays hermetic."""
    app = _app()

    class FakeStdout:
        async def readline(self) -> bytes:
            return b""

    class FakeProcess:
        stdout = FakeStdout()

        def terminate(self) -> None:
            pass

        async def wait(self) -> int:
            return 0

    async def fake_create_subprocess_exec(*argv, **kwargs):
        assert "alsasrc" not in argv  # never a second ALSA capture device
        return FakeProcess()

    monkeypatch.setattr("asyncio.create_subprocess_exec", fake_create_subprocess_exec)

    original_sampler = app.state.audio_sampler
    await app.state.start_audio_meter()

    assert app.state.audio_sampler is not original_sampler
    assert isinstance(app.state.audio_sampler, AudioLevelSampler)
    assert app.state.audio_meter is not None

    await app.state.audio_meter.stop()

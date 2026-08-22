"""Arch integ-B coverage for A-REV-003 (source-loss fallback): real
`gst-launch-1.0` children spawned through the real `ProcessSupervisor` /
`HealthConfirmer`, real `videotestsrc`/`audiotestsrc` placeholders, and a
real "warm publisher" writer feeding the fixed `ROLE_SOCKETS` paths.

`RK3588Profile.encoder()`/`decoder()` name Rockchip MPP hardware elements
(`mpph264enc`/`mppvideodec`) that only exist on the board — everything else
the builder emits (`compositor`, `videoconvert`, `videoscale`, `videorate`,
`mpegtsmux`, `xvimagesink`, `input-selector`, `videotestsrc`,
`audiotestsrc`) is a stock software element also present on Arch (plan §3).
`_SoftwareEncodeProfile` below is a **test-only** `PlatformProfile`
substitute — legitimate under the platform-plug design itself ("porting to
a second board means writing one new module... the builder is untouched")
— so these tests exercise the real `build_record`/`build_meeting` +
`source_branch_normalized` fallback code, real linking, and a real running
pipeline end to end, without needing the RK3588 board.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from pipeline_manager.consumers.record import RecordConsumer
from pipeline_manager.models import ConsumerState, LayoutPresetId, SourceRole
from pipeline_manager.pipelines.builder import ROLE_SOCKETS
from pipeline_manager.pipelines.meeting import MeetingRequest, build_meeting
from pipeline_manager.pipelines.platforms.base import DisplayOut, Pad
from pipeline_manager.pipelines.record import RecordRequest
from pipeline_manager.supervisor.health import HealthConfirmer
from pipeline_manager.supervisor.ledger import EncodeLedger
from pipeline_manager.supervisor.process import ProcessSupervisor
from pipeline_manager.supervisor.stop import STOP_DEADLINE_SECONDS, stop_process

pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("gst-launch-1.0") is None,
    reason="requires a real GStreamer install (Arch integ-B target, plan §3)",
)

PRESENTATION_SOCKET = ROLE_SOCKETS[SourceRole.PRESENTATION]


class _SoftwarePlatform:
    """Same shape as `RK3588Profile`, software-encoder elements only — a
    test-only stand-in so the encode/mux/file-sink stage of a *real*
    composite record can actually run off the RK3588 target.
    """

    id = "arch-software-test"

    def shm_video_caps(self, role: SourceRole) -> str:
        if role in (SourceRole.LECTURER_CAM, SourceRole.STUDENTS_CAM):
            return "video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1"
        return "video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1"

    def audio_caps(self) -> str:
        return "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved"

    def decoder(self) -> list[str]:
        return ["avdec_h264"]

    def convert(self) -> list[str]:
        return ["videoconvert"]

    def scale(self) -> list[str]:
        return ["videoscale"]

    def compositor(self, name: str, pads: list[Pad]) -> list[str]:
        tokens = ["compositor", f"name={name}", "background=black"]
        for pad in pads:
            tokens.append(f"{pad.name}::xpos={pad.xpos}")
            tokens.append(f"{pad.name}::ypos={pad.ypos}")
        return tokens

    def encoder(self, profile) -> list[str]:
        return ["x264enc", "speed-preset=ultrafast", "tune=zerolatency", "bitrate=1000"]

    def audio_encoder(self, profile) -> list[str]:
        return ["avenc_aac", "!", "aacparse"]

    def mux(self, kind: str, name: str) -> list[str]:
        if kind == "mpegts":
            return ["mpegtsmux", f"name={name}", "alignment=7"]
        raise ValueError(kind)

    def display_sink(self, output: DisplayOut) -> list[str]:
        return ["xvimagesink", "sync=false"]

    def rtmp_sink(self, url: str) -> list[str]:
        return ["rtmpsink", f"location={url}", "sync=false"]

    def file_sink(self, path: str) -> list[str]:
        return ["filesink", f"location={path}"]

    def display_place(self, output: DisplayOut):
        return lambda: []

    def required_elements(self) -> list[str]:
        return []


def _start_warm_presentation_writer() -> subprocess.Popen:
    """A real `shmsink` writer standing in for the USB/presentation
    publisher — real GStreamer test-source data flowing through the actual
    `/tmp/usb.sock` `shmsrc` branch `build_record`/`build_meeting` would use.
    """
    Path(PRESENTATION_SOCKET).unlink(missing_ok=True)
    return subprocess.Popen(
        [
            "gst-launch-1.0", "-e",
            "videotestsrc", "is-live=true", "pattern=smpte", "!",
            "video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1", "!",
            "shmsink", f"socket-path={PRESENTATION_SOCKET}", "wait-for-connection=false", "shm-size=64000000",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _stop_writer(writer: subprocess.Popen) -> None:
    writer.terminate()
    with __import__("contextlib").suppress(Exception):
        writer.wait(timeout=5)
    Path(PRESENTATION_SOCKET).unlink(missing_ok=True)


class _RealConfirmer:
    async def confirm(self, process, *, is_record=False, output_path=None, timeout=20.0, **_):
        await HealthConfirmer(poll_interval=0.05).confirm(
            process, is_record=is_record, output_path=output_path, timeout=timeout
        )


@pytest.mark.asyncio
async def test_composite_record_with_one_offline_role_grows_and_finalizes_cleanly(tmp_path) -> None:
    """FIFTY_FIFTY with lecturer-cam + mic already offline at spawn: the
    real pipeline still reaches PLAYING, the file still grows (presentation
    tile is real, lecturer-cam tile is a real `videotestsrc` placeholder,
    audio is real `audiotestsrc` silence), and stop finalizes cleanly."""
    writer = _start_warm_presentation_writer()
    time.sleep(0.5)
    supervisor = ProcessSupervisor()
    ledger = EncodeLedger()
    consumer = RecordConsumer(
        "record:integ-b",
        supervisor=supervisor,
        ledger=ledger,
        confirmer=_RealConfirmer(),
        platform=_SoftwarePlatform(),
        is_publisher_running=lambda role: role is SourceRole.PRESENTATION,
    )
    output_path = str(tmp_path / "fallback.ts")
    try:
        event = await consumer.start(
            RecordRequest(preset=LayoutPresetId.FIFTY_FIFTY, ratio_a=50, ratio_b=50, output_path=output_path)
        )
        assert event.state is ConsumerState.RUNNING
        pgid_before = consumer.pgid

        size_before = Path(output_path).stat().st_size
        time.sleep(1.0)
        size_after = Path(output_path).stat().st_size
        assert size_after > size_before  # the file keeps growing with only one real source

        stop_event = await consumer.stop()
        assert stop_event.truncated is False
        assert consumer.pgid == pgid_before  # same child throughout — never restarted
        assert Path(output_path).stat().st_size > 0
    finally:
        if consumer.process is not None and consumer.process.popen.poll() is None:
            consumer.process.popen.kill()
        if consumer.process is not None:
            consumer.process.popen.wait(timeout=5)
        _stop_writer(writer)


@pytest.mark.skipif(not __import__("os").environ.get("DISPLAY"), reason="xvimagesink needs a real X DISPLAY")
@pytest.mark.asyncio
async def test_meeting_single_tile_with_offline_camera_plays_placeholder_and_stops_cleanly() -> None:
    """CAM_1 meeting preview with its one camera (and mic) offline: fully
    routed through real `videotestsrc`/`audiotestsrc` placeholders (no
    external socket dependency). A single-tile preset has nothing else to
    fall back to, so `MeetingConsumer.start` still refuses this at the
    precondition (covered by the consumer-level unit tests) — this test
    spawns `build_meeting`'s placeholder-only argv directly through the real
    supervisor/confirmer to prove the *pipeline itself* reaches PLAYING and
    stops cleanly (no black/frozen display), independent of that gate.
    """
    supervisor = ProcessSupervisor()
    spec = build_meeting(
        MeetingRequest(preset=LayoutPresetId.CAM_1, hdmi2_alsa_device="null"),
        _SoftwarePlatform(),
        is_role_healthy=lambda role: False,
    )
    process = await supervisor.start(spec, "meeting:integ-b")
    try:
        await _RealConfirmer().confirm(process, is_record=False)
        result = await stop_process(process, STOP_DEADLINE_SECONDS)
        assert result.clean_eos is True
        assert result.truncated is False
    finally:
        if process.popen.poll() is None:
            process.popen.kill()
        process.popen.wait(timeout=5)
        supervisor.forget("meeting:integ-b")

"""Real GStreamer coverage for record camera loss and reconnection."""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from pipeline_manager.models import SourceRole
from pipeline_manager.pipelines.builder import PipelineSpec
from pipeline_manager.supervisor.health import HealthConfirmer
from pipeline_manager.supervisor.process import ProcessSupervisor
from pipeline_manager.supervisor.stop import STOP_DEADLINE_SECONDS, stop_process

SOCKET = Path("/tmp/rtsp.sock")

pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("gst-launch-1.0") is None,
    reason="requires a real GStreamer install",
)


def _writer(pattern: str = "smpte") -> subprocess.Popen:
    SOCKET.unlink(missing_ok=True)
    return subprocess.Popen(
        [
            "gst-launch-1.0", "videotestsrc", "is-live=true", f"pattern={pattern}", "!",
            "video/x-raw,width=640,height=360,framerate=15/1", "!",
            "x264enc", "tune=zerolatency", "speed-preset=ultrafast", "key-int-max=15", "!",
            "h264parse", "config-interval=-1", "!",
            "video/x-h264,stream-format=byte-stream,alignment=au", "!",
            "shmsink", f"socket-path={SOCKET}", "wait-for-connection=false",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _stop_writer(writer: subprocess.Popen) -> None:
    writer.terminate()
    try:
        writer.wait(timeout=5)
    except subprocess.TimeoutExpired:
        writer.kill()
        writer.wait(timeout=5)


async def _wait_line(process, text: str, timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(text in line for line in process.raw_lines):
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"worker did not emit {text!r}: {process.raw_lines!r}")


async def _wait_growth(path: Path, baseline: int, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.stat().st_size > baseline:
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"{path} did not grow beyond {baseline} bytes")


@pytest.mark.asyncio
async def test_camera_loss_uses_placeholder_recovers_same_pgid_and_finalizes(tmp_path) -> None:
    output = tmp_path / "resilient.ts"
    graph = (
        f"shmsrc name=source_lecturer_cam socket-path={SOCKET} is-live=true do-timestamp=true ! "
        "video/x-h264,stream-format=byte-stream,alignment=au,width=640,height=360,framerate=15/1 ! "
        "h264parse ! avdec_h264 ! videoconvert ! queue ! sel_lecturer_cam.sink_0 "
        "videotestsrc is-live=true pattern=black ! video/x-raw,format=I420,width=640,height=360,framerate=15/1 ! "
        'textoverlay text="SOURCE UNAVAILABLE" valignment=center halignment=center ! sel_lecturer_cam.sink_1 '
        "input-selector name=sel_lecturer_cam ! videoconvert ! "
        "x264enc tune=zerolatency speed-preset=ultrafast ! h264parse ! mpegtsmux ! "
        f"filesink location={output}"
    )
    spec = PipelineSpec(
        argv=("gst-launch-1.0", "-e", "-m", *graph.split(" ")),
        required_roles=(SourceRole.LECTURER_CAM,),
        encode_slots=1,
        outputs=(str(output),),
        resilient_roles=(SourceRole.LECTURER_CAM,),
    )
    writer = _writer()
    await asyncio.sleep(0.5)
    supervisor = ProcessSupervisor()
    process = await supervisor.start(spec, "record:resilient-integ")
    replacement = None
    try:
        await HealthConfirmer(poll_interval=0.05).confirm(
            process, is_record=True, output_path=str(output), timeout=20.0
        )
        pgid = process.pgid
        _stop_writer(writer)
        await _wait_line(process, "SOURCE UNAVAILABLE: lecturer-cam")
        lost_size = output.stat().st_size
        await _wait_growth(output, lost_size)
        assert process.popen.poll() is None
        assert process.pgid == pgid

        replacement = _writer("ball")
        await _wait_line(process, "SOURCE RESTORED: lecturer-cam")
        assert process.pgid == pgid

        result = await stop_process(process, STOP_DEADLINE_SECONDS)
        assert result.clean_eos is True
        assert output.stat().st_size > 0
    finally:
        if process.popen.poll() is None:
            process.popen.kill()
        process.popen.wait(timeout=5)
        if replacement is not None and replacement.poll() is None:
            _stop_writer(replacement)
        elif writer.poll() is None:
            _stop_writer(writer)
        SOCKET.unlink(missing_ok=True)

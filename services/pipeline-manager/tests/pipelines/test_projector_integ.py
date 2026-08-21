"""Arch integ-B coverage for A-REV-009: a real, long-running projector
worker process (real GStreamer + PyGObject), driven entirely over its stdin
control channel — proving mode switches actually change the rendered output
(not just that `input-selector.active-pad` gets set) without ever spawning a
second child (same PGID throughout).
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from pipeline_manager.pipelines.builder import ROLE_SOCKETS, PipelineSpec
from pipeline_manager.pipelines.projector import (
    ProjectorMode,
    QuestionOverlay,
    encode_control_message,
    worker_argv,
)
from pipeline_manager.models import SourceRole
from pipeline_manager.supervisor.health import HealthConfirmer
from pipeline_manager.supervisor.process import ProcessSupervisor
from pipeline_manager.supervisor.stop import STOP_DEADLINE_SECONDS, stop_process

pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("gst-launch-1.0") is None,
    reason="requires a real GStreamer + PyGObject install (Arch integ-B target, plan §3)",
)

PRESENTATION_SOCKET = ROLE_SOCKETS[SourceRole.PRESENTATION]
_CAPS = "video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1"


def _start_warm_presentation_writer() -> subprocess.Popen:
    Path(PRESENTATION_SOCKET).unlink(missing_ok=True)
    return subprocess.Popen(
        [
            "gst-launch-1.0", "-e",
            "videotestsrc", "is-live=true", "pattern=smpte", "!",
            _CAPS, "!",
            "shmsink", f"socket-path={PRESENTATION_SOCKET}", "wait-for-connection=false", "shm-size=64000000",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _stop_writer(writer: subprocess.Popen) -> None:
    writer.terminate()
    try:
        writer.wait(timeout=5)
    except Exception:
        writer.kill()
    Path(PRESENTATION_SOCKET).unlink(missing_ok=True)


class _RealConfirmer:
    async def confirm(self, process, *, is_record=False, output_path=None, timeout=20.0, **_):
        await HealthConfirmer(poll_interval=0.05).confirm(
            process, is_record=is_record, output_path=output_path, timeout=timeout
        )


def _write_frame(process, path: Path, *, timeout: float = 5.0) -> bytes:
    """Wait for the capture tap (below) to publish a fresh frame and return it."""
    path.unlink(missing_ok=True)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists() and path.stat().st_size > 0:
            time.sleep(0.2)  # let a second write land so we're not reading mid-write
            return path.read_bytes()
        time.sleep(0.1)
    raise AssertionError(f"no frame captured at {path} within {timeout}s")


@pytest.mark.asyncio
async def test_mode_switch_over_stdin_changes_the_rendered_frame_same_pgid(tmp_path) -> None:
    writer = _start_warm_presentation_writer()
    time.sleep(0.5)

    # A test-only capture tail in place of the real HDMI display sink — same
    # trick as the record/meeting integ-b tests' software platform: swap the
    # *sink*, not the worker/graph logic under test.
    capture_path = tmp_path / "frame.png"
    capture_tail = (
        "videoconvert ! videorate ! video/x-raw,framerate=2/1 ! pngenc snapshot=false ! "
        f"multifilesink location={capture_path} next-file=buffer post-messages=true"
    )
    spec = PipelineSpec(argv=worker_argv(_CAPS, capture_tail), required_roles=(SourceRole.PRESENTATION,), encode_slots=0, outputs=())

    supervisor = ProcessSupervisor()
    process = await supervisor.start(spec, "projector:integ-b")
    try:
        await _RealConfirmer().confirm(process, is_record=False, timeout=20.0)
        pgid_before = process.pgid

        passthrough_frame = _write_frame(process, capture_path)

        from PIL import Image

        qr_path = tmp_path / "qr.png"
        Image.new("RGB", (64, 64), color=(255, 255, 255)).save(qr_path)
        question = QuestionOverlay(
            question_text="What is the capital of France?", options=["Paris", "Lyon"], join_qr_png_path=str(qr_path)
        )
        message = encode_control_message(ProjectorMode.QUESTION, question)
        writer_stdin = process.popen.stdin.buffer
        writer_stdin.write(message)
        writer_stdin.flush()

        question_frame = _write_frame(process, capture_path)
        assert question_frame != passthrough_frame  # the slide really replaced the passthrough

        back = encode_control_message(ProjectorMode.PASSTHROUGH)
        writer_stdin.write(back)
        writer_stdin.flush()
        passthrough_again = _write_frame(process, capture_path)
        assert passthrough_again != question_frame

        assert process.pgid == pgid_before  # never restarted across any of the switches

        result = await stop_process(process, STOP_DEADLINE_SECONDS)
        assert result.clean_eos is True
    finally:
        if process.popen.poll() is None:
            process.popen.kill()
        process.popen.wait(timeout=5)
        supervisor.forget("projector:integ-b")
        _stop_writer(writer)

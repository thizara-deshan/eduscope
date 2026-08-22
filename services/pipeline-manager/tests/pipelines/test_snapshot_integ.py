"""Arch integ-B coverage for A-REV-010: a real snapshot worker process (real
GStreamer + PyGObject, spawned exactly as `create_production_app` would)
against a real `videotestsrc` "warm publisher" writer, proving
`publish_snapshot` actually runs per frame and the published PNGs are valid
and decodable — not just that the argv/graph text looks right.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from pipeline_manager.pipelines.builder import ROLE_SOCKETS
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.snapshot import SnapshotRequest, build_snapshot
from pipeline_manager.models import SourceRole
from pipeline_manager.supervisor.health import HealthConfirmer
from pipeline_manager.supervisor.process import ProcessSupervisor
from pipeline_manager.supervisor.stop import STOP_DEADLINE_SECONDS, stop_process

pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("gst-launch-1.0") is None,
    reason="requires a real GStreamer + PyGObject install (Arch integ-B target, plan §3)",
)

PRESENTATION_SOCKET = ROLE_SOCKETS[SourceRole.PRESENTATION]


def _start_warm_presentation_writer() -> subprocess.Popen:
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


@pytest.mark.asyncio
async def test_snapshot_worker_publishes_at_least_three_valid_pngs(tmp_path) -> None:
    from PIL import Image

    writer = _start_warm_presentation_writer()
    time.sleep(0.5)
    supervisor = ProcessSupervisor()
    output_path = tmp_path / "slide.png"
    spec = build_snapshot(SnapshotRequest(interval_sec=1, output_path=str(output_path)), RK3588Profile())
    process = await supervisor.start(spec, "snapshot:integ-b")
    try:
        await _RealConfirmer().confirm(process, is_record=False, timeout=20.0)

        seen_sizes: set[int] = set()
        deadline = time.monotonic() + 8.0
        while len(seen_sizes) < 3 and time.monotonic() < deadline:
            if output_path.exists():
                with Image.open(output_path) as img:
                    img.verify()
                seen_sizes.add(output_path.stat().st_size)
                # a fresh publish always replaces the whole file, never a
                # partial one — Image.verify() would already have raised.
            time.sleep(0.3)
        assert len(seen_sizes) >= 3  # at least three distinct publish cycles observed

        stop_result = await stop_process(process, STOP_DEADLINE_SECONDS)
        assert stop_result.clean_eos is True

        # The final published PNG is still a complete, decodable image and
        # no `.tmp` sibling is left behind mid-write.
        with Image.open(output_path) as img:
            img.verify()
        assert not Path(f"{output_path}.tmp.tmp").exists()
    finally:
        if process.popen.poll() is None:
            process.popen.kill()
        process.popen.wait(timeout=5)
        supervisor.forget("snapshot:integ-b")
        _stop_writer(writer)

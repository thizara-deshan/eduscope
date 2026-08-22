from __future__ import annotations

import sys
from pathlib import Path

import pytest

from pipeline_manager.models import SourceRole
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.snapshot import (
    InvalidSnapshotInterval,
    SnapshotNotReady,
    SnapshotRequest,
    build_snapshot,
    publish_snapshot,
    temp_path_for,
    worker_argv,
    worker_graph,
)

OUT = "/media/eduscope/slides/out.png"


class TestBuildSnapshot:
    """A-REV-010: `build_snapshot` now returns a Python-worker argv, not a
    plain `gst-launch-1.0` command — the real atomic-publish call
    (`publish_snapshot`) can only happen from Python code running per frame,
    which no gst-launch CLI process can do."""

    def test_interval_at_least_one_accepted(self) -> None:
        spec = build_snapshot(SnapshotRequest(interval_sec=1, output_path=OUT), RK3588Profile())
        assert spec.argv[0] == sys.executable
        assert "--worker" in spec.argv
        assert "1" in spec.argv  # --interval-sec 1

    @pytest.mark.parametrize("interval", [0, -1])
    def test_interval_below_one_rejected(self, interval: int) -> None:
        with pytest.raises(InvalidSnapshotInterval):
            build_snapshot(SnapshotRequest(interval_sec=interval, output_path=OUT), RK3588Profile())

    def test_worker_argv_carries_output_path_and_platform_caps(self) -> None:
        spec = build_snapshot(SnapshotRequest(interval_sec=5, output_path=OUT), RK3588Profile())
        assert OUT in spec.argv
        assert RK3588Profile().shm_video_caps(SourceRole.PRESENTATION) in spec.argv

    def test_required_role_is_presentation_only(self) -> None:
        spec = build_snapshot(SnapshotRequest(interval_sec=5, output_path=OUT), RK3588Profile())
        assert spec.required_roles == (SourceRole.PRESENTATION,)
        assert spec.outputs == (OUT,)

    def test_temp_path_helper(self) -> None:
        assert temp_path_for("/a/b/out.png") == "/a/b/out.png.tmp"


class TestWorkerArgv:
    def test_one_process_per_consumer(self) -> None:
        argv = worker_argv(5, OUT, "video/x-raw,format=NV12", python_executable="python3")
        assert argv[0] == "python3"
        assert "-m" in argv
        assert "pipeline_manager.pipelines.snapshot" in argv
        assert "--worker" in argv


class TestWorkerGraph:
    """Static structure of the gst-launch-syntax body the worker parses via
    `Gst.parse_launch` — real execution is covered by the Arch integ-B test."""

    def test_reads_from_presentation_socket(self) -> None:
        graph = worker_graph(2, "/tmp/out.png.tmp", "video/x-raw,format=NV12")
        assert "socket-path=/tmp/usb.sock" in graph

    def test_writes_to_the_given_tmp_path(self) -> None:
        graph = worker_graph(2, "/tmp/out.png.tmp", "video/x-raw,format=NV12")
        assert "location=/tmp/out.png.tmp" in graph

    def test_multifilesink_overwrites_one_fixed_file_per_frame(self) -> None:
        """`next-file=buffer` + a fixed (non-`%d`) location is what makes
        every frame overwrite the same tmp file instead of numbering a new
        file per frame (A-REV-010)."""
        graph = worker_graph(2, "/tmp/out.png.tmp", "video/x-raw,format=NV12")
        assert "next-file=buffer" in graph
        assert "post-messages=true" in graph

    def test_interval_sets_the_capture_framerate(self) -> None:
        graph = worker_graph(3, "/tmp/out.png.tmp", "video/x-raw,format=NV12")
        assert "framerate=1/3" in graph


class TestPublishSnapshot:
    def test_publishes_atomically_via_rename(self, tmp_path: Path) -> None:
        tmp_file = tmp_path / "out.png.tmp"
        tmp_file.write_bytes(b"\x89PNG\r\n fake but nonzero")
        final_file = tmp_path / "out.png"

        publish_snapshot(tmp_file, final_file)

        assert final_file.exists()
        assert not tmp_file.exists()
        assert final_file.read_bytes().startswith(b"\x89PNG")

    def test_zero_byte_temp_file_is_not_published(self, tmp_path: Path) -> None:
        tmp_file = tmp_path / "out.png.tmp"
        tmp_file.write_bytes(b"")
        final_file = tmp_path / "out.png"

        with pytest.raises(SnapshotNotReady):
            publish_snapshot(tmp_file, final_file)

        assert not final_file.exists()

    def test_no_partial_final_file_ever_observed(self, tmp_path: Path) -> None:
        """Before publish_snapshot runs, the final path must not exist at all —
        readers only ever see a complete file or none (never a partial write)."""
        tmp_file = tmp_path / "out.png.tmp"
        tmp_file.write_bytes(b"partial-write-in-progress")
        final_file = tmp_path / "out.png"

        assert not final_file.exists()
        publish_snapshot(tmp_file, final_file)
        assert final_file.exists()

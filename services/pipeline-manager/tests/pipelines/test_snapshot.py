from __future__ import annotations

from pathlib import Path

import pytest

from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.snapshot import (
    InvalidSnapshotInterval,
    SnapshotNotReady,
    SnapshotRequest,
    build_snapshot,
    publish_snapshot,
    temp_path_for,
)


class TestBuildSnapshot:
    def test_interval_at_least_one_accepted(self) -> None:
        spec = build_snapshot(SnapshotRequest(interval_sec=1, output_path="/media/eduscope/slides/out.png"), RK3588Profile())
        assert "video/x-raw,framerate=1/1" in spec.argv

    @pytest.mark.parametrize("interval", [0, -1])
    def test_interval_below_one_rejected(self, interval: int) -> None:
        with pytest.raises(InvalidSnapshotInterval):
            build_snapshot(SnapshotRequest(interval_sec=interval, output_path="/media/eduscope/slides/out.png"), RK3588Profile())

    def test_writes_to_temporary_sibling_path(self) -> None:
        spec = build_snapshot(SnapshotRequest(interval_sec=5, output_path="/media/eduscope/slides/out.png"), RK3588Profile())
        assert "location=/media/eduscope/slides/out.png.tmp" in spec.argv

    def test_temp_path_helper(self) -> None:
        assert temp_path_for("/a/b/out.png") == "/a/b/out.png.tmp"


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

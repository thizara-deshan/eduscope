from pathlib import Path

from pipeline_manager.models import SourceRole
from pipeline_manager.pipelines.jpeg_previews import build_jpeg_previews, worker_graph
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile


def test_three_one_hz_jpegs_share_one_encode_free_worker() -> None:
    spec = build_jpeg_previews(Path("/tmp/previews"), RK3588Profile())
    assert spec.required_roles == (SourceRole.PRESENTATION, SourceRole.LECTURER_CAM, SourceRole.STUDENTS_CAM)
    assert spec.encode_slots == 0
    assert len(spec.outputs) == 3


def test_graph_uses_one_fps_480x270_and_atomic_tmp_targets() -> None:
    graph = worker_graph(Path("/tmp/previews"), RK3588Profile())
    assert graph.count("jpegenc quality=70") == 3
    assert graph.count("framerate=1/1") == 3
    assert graph.count("width=480,height=270") == 3
    assert graph.count(".jpg.tmp") == 3
    assert "webrtcbin" not in graph
    assert "mpph264enc" not in graph

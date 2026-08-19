from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline_manager.models import LayoutPresetId, SourceRole
from pipeline_manager.pipelines.builder import UnsupportedPipeline
from pipeline_manager.pipelines.layouts import PresetChannelMismatch
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.record import RecordRequest, build_record

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "pipelines" / "record"
OUT = "/media/eduscope/recordings/out.ts"
USB_OUT = "/media/eduscope/recordings/usb.ts"
CAM_OUT = "/media/eduscope/recordings/cam1.ts"


def _golden(name: str) -> list[str]:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


class TestGoldenArgv:
    def test_cam1_passthrough_matches_oracle(self) -> None:
        req = RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT)
        spec = build_record(req, RK3588Profile())
        assert list(spec.argv) == _golden("rec_cam1.json")

    def test_cam2_passthrough_matches_oracle(self) -> None:
        req = RecordRequest(preset=LayoutPresetId.CAM_2, output_path=OUT)
        spec = build_record(req, RK3588Profile())
        assert list(spec.argv) == _golden("rec_cam2.json")

    def test_fifty_fifty_composite_matches_oracle(self) -> None:
        req = RecordRequest(preset=LayoutPresetId.FIFTY_FIFTY, ratio_a=50, ratio_b=50, output_path=OUT)
        spec = build_record(req, RK3588Profile())
        assert list(spec.argv) == _golden("rec_usb_cam1_5050.json")

    def test_separate_files_matches_oracle(self) -> None:
        req = RecordRequest(
            preset=LayoutPresetId.SEPARATE_FILES,
            output_paths={"presentation": USB_OUT, "lecturer-cam": CAM_OUT},
        )
        spec = build_record(req, RK3588Profile())
        assert list(spec.argv) == _golden("rec_usb_cam1_separate.json")


class TestStructuralInvariants:
    def test_argv_begins_with_gst_launch(self) -> None:
        req = RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT)
        spec = build_record(req, RK3588Profile())
        assert spec.argv[:3] == ("gst-launch-1.0", "-e", "-m")

    def test_composite_uses_one_encoder_and_one_mux(self) -> None:
        req = RecordRequest(preset=LayoutPresetId.FIFTY_FIFTY, output_path=OUT)
        spec = build_record(req, RK3588Profile())
        assert spec.argv.count("mpph264enc") == 1
        assert spec.argv.count("mpegtsmux") == 1
        assert spec.encode_slots == 1

    def test_single_h264_camera_uses_no_decoder_or_encoder(self) -> None:
        req = RecordRequest(preset=LayoutPresetId.CAM_1, output_path=OUT)
        spec = build_record(req, RK3588Profile())
        assert "mppvideodec" not in spec.argv
        assert "mpph264enc" not in spec.argv
        assert spec.encode_slots == 0

    def test_side_by_side_re_encodes_and_uses_students_cam(self) -> None:
        req = RecordRequest(preset=LayoutPresetId.SIDE_BY_SIDE, output_path=OUT)
        spec = build_record(req, RK3588Profile())
        assert spec.argv.count("mpph264enc") == 1
        assert "socket-path=/tmp/rtsp2.sock" in spec.argv
        assert "socket-path=/tmp/rtsp.sock" not in spec.argv

    def test_separate_files_uses_one_child_two_muxes_one_usb_encode_one_passthrough(self) -> None:
        req = RecordRequest(
            preset=LayoutPresetId.SEPARATE_FILES,
            output_paths={"presentation": USB_OUT, "lecturer-cam": CAM_OUT},
        )
        spec = build_record(req, RK3588Profile())
        assert spec.argv.count("mpegtsmux") == 2
        assert spec.argv.count("mpph264enc") == 1
        assert spec.encode_slots == 1
        assert "muxu." in spec.argv
        assert "muxc." in spec.argv

    def test_every_output_path_is_an_individual_argv_token(self) -> None:
        req = RecordRequest(
            preset=LayoutPresetId.SEPARATE_FILES,
            output_paths={"presentation": USB_OUT, "lecturer-cam": CAM_OUT},
        )
        spec = build_record(req, RK3588Profile())
        assert f"location={USB_OUT}" in spec.argv
        assert f"location={CAM_OUT}" in spec.argv

    def test_camera_only_builds_without_presentation(self) -> None:
        req = RecordRequest(preset=LayoutPresetId.CAM_2, output_path=OUT)
        spec = build_record(req, RK3588Profile())
        assert SourceRole.PRESENTATION not in spec.required_roles


class TestEarlyRefusal:
    def test_pc_only_refused_on_local(self) -> None:
        with pytest.raises(PresetChannelMismatch):
            build_record(RecordRequest(preset=LayoutPresetId.PC_ONLY, output_path=OUT), RK3588Profile())

    def test_missing_output_path_refused_before_spawn(self) -> None:
        with pytest.raises(UnsupportedPipeline):
            build_record(RecordRequest(preset=LayoutPresetId.CAM_1), RK3588Profile())

    def test_separate_files_missing_output_paths_refused(self) -> None:
        with pytest.raises(UnsupportedPipeline):
            build_record(RecordRequest(preset=LayoutPresetId.SEPARATE_FILES), RK3588Profile())

    def test_invalid_preset_string_raises_before_lookup(self) -> None:
        with pytest.raises(ValueError):
            LayoutPresetId("not-a-real-preset")


class TestEffectiveEncodeProfile:
    """KEEP B-56 gate correction (2026-08-18): a per-channel encoder override
    reaches the next PM start and passthrough/other channels stay unaffected."""

    def test_composite_override_reaches_encoder_argv(self) -> None:
        req = RecordRequest(
            preset=LayoutPresetId.FIFTY_FIFTY, output_path=OUT,
            video_bitrate_bps=5_500_000, fps=24, gop=45, rate_control="vbr", audio_bitrate_bps=96_000,
        )
        spec = build_record(req, RK3588Profile())
        assert "bps=5500000" in spec.argv
        assert "rc-mode=vbr" in spec.argv
        assert "gop=45" in spec.argv
        assert "bitrate=96000" in spec.argv

    def test_composite_without_override_keeps_defaults(self) -> None:
        req = RecordRequest(preset=LayoutPresetId.FIFTY_FIFTY, output_path=OUT)
        spec = build_record(req, RK3588Profile())
        assert "bps=4000000" in spec.argv
        assert "rc-mode=cbr" in spec.argv
        assert "gop=30" in spec.argv

    def test_single_camera_passthrough_ignores_override(self) -> None:
        req = RecordRequest(
            preset=LayoutPresetId.CAM_1, output_path=OUT,
            video_bitrate_bps=7_000_000, gop=90, rate_control="vbr",
        )
        spec = build_record(req, RK3588Profile())
        assert "mpph264enc" not in spec.argv
        assert spec.encode_slots == 0

    def test_local_record_override_does_not_leak_into_default_live_profile(self) -> None:
        from pipeline_manager.pipelines.live import LiveRequest, build_live

        record_spec = build_record(
            RecordRequest(
                preset=LayoutPresetId.FIFTY_FIFTY, output_path=OUT,
                video_bitrate_bps=7_500_000, gop=90, rate_control="vbr",
            ),
            RK3588Profile(),
        )
        live_spec = build_live(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"), RK3588Profile())

        assert "bps=7500000" in record_spec.argv
        assert "bps=7500000" not in live_spec.argv
        assert "gop=60" in live_spec.argv  # live default (unaffected by the record override)

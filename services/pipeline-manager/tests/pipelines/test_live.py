from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline_manager.models import LayoutPresetId
from pipeline_manager.pipelines.layouts import PresetChannelMismatch
from pipeline_manager.pipelines.live import InvalidStreamKey, LiveRequest, build_live
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "pipelines" / "live"


def _golden(name: str) -> list[str]:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


class TestGoldenArgv:
    def test_cam1_matches_oracle(self) -> None:
        spec = build_live(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="test"), RK3588Profile())
        assert list(spec.argv) == _golden("live_cam1.json")

    def test_cam2_matches_oracle(self) -> None:
        spec = build_live(LiveRequest(preset=LayoutPresetId.CAM_2, stream_key="test"), RK3588Profile())
        assert list(spec.argv) == _golden("live_cam2.json")

    def test_pc_only_matches_oracle(self) -> None:
        spec = build_live(LiveRequest(preset=LayoutPresetId.PC_ONLY, stream_key="test"), RK3588Profile())
        assert list(spec.argv) == _golden("live_usb.json")

    def test_fifty_fifty_matches_oracle(self) -> None:
        spec = build_live(
            LiveRequest(preset=LayoutPresetId.FIFTY_FIFTY, stream_key="test", ratio_a=50, ratio_b=50),
            RK3588Profile(),
        )
        assert list(spec.argv) == _golden("live_usb_cam1_5050.json")


class TestEveryStreamingPreset:
    @pytest.mark.parametrize(
        "preset",
        [
            LayoutPresetId.FIFTY_FIFTY,
            LayoutPresetId.SIDE_BY_SIDE,
            LayoutPresetId.CAM_1,
            LayoutPresetId.CAM_2,
            LayoutPresetId.PC_ONLY,
        ],
    )
    def test_gop_sixty_aac_flv_one_encode_slot(self, preset: LayoutPresetId) -> None:
        spec = build_live(LiveRequest(preset=preset, stream_key="bench"), RK3588Profile())
        assert "gop=60" in spec.argv
        assert "voaacenc" in spec.argv
        assert spec.argv.count("flvmux") == 1
        assert "streamable=true" in spec.argv
        assert spec.encode_slots == 1

    def test_meeting_only_preset_rejected(self) -> None:
        with pytest.raises(PresetChannelMismatch):
            build_live(LiveRequest(preset=LayoutPresetId.CAMS_FIFTY_FIFTY, stream_key="bench"), RK3588Profile())

    def test_separate_files_rejected_on_streaming(self) -> None:
        with pytest.raises(PresetChannelMismatch):
            build_live(LiveRequest(preset=LayoutPresetId.SEPARATE_FILES, stream_key="bench"), RK3588Profile())


class TestStreamKeyValidation:
    @pytest.mark.parametrize("key", ["", "a" * 33, "has space", "slash/es", "semi;colon"])
    def test_invalid_keys_rejected(self, key: str) -> None:
        with pytest.raises(InvalidStreamKey):
            build_live(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key=key), RK3588Profile())

    @pytest.mark.parametrize("key", ["a", "A" * 32, "bench-key_1"])
    def test_valid_keys_accepted(self, key: str) -> None:
        spec = build_live(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key=key), RK3588Profile())
        assert key in spec.outputs[0]

    def test_rtmp_target_token_is_exact(self) -> None:
        spec = build_live(LiveRequest(preset=LayoutPresetId.CAM_1, stream_key="bench"), RK3588Profile())
        assert "location=rtmp://127.0.0.1:1935/live/bench live=1" in spec.argv


class TestEffectiveEncodeProfile:
    """KEEP B-56 gate correction (2026-08-18): the streaming channel's override
    reaches the next live-start profile while the local/default record profile
    is untouched — B's per-channel effective-profile resolution depends on
    this PM-side isolation."""

    def test_live_composite_override_reaches_encoder_argv(self) -> None:
        req = LiveRequest(
            preset=LayoutPresetId.FIFTY_FIFTY, stream_key="bench", ratio_a=50, ratio_b=50,
            video_bitrate_bps=6_000_000, fps=25, gop=50, rate_control="vbr", audio_bitrate_bps=112_000,
        )
        spec = build_live(req, RK3588Profile())
        assert "bps=6000000" in spec.argv
        assert "rc-mode=vbr" in spec.argv
        assert "gop=50" in spec.argv
        assert "bitrate=112000" in spec.argv

    def test_streaming_override_does_not_change_default_local_record_profile(self) -> None:
        from pipeline_manager.pipelines.record import RecordRequest, build_record

        live_spec = build_live(
            LiveRequest(
                preset=LayoutPresetId.CAM_1, stream_key="bench",
                video_bitrate_bps=8_000_000, gop=90, rate_control="vbr",
            ),
            RK3588Profile(),
        )
        record_spec = build_record(
            RecordRequest(preset=LayoutPresetId.FIFTY_FIFTY, output_path="/media/eduscope/recordings/out.ts"),
            RK3588Profile(),
        )

        assert "bps=8000000" in live_spec.argv
        assert "bps=8000000" not in record_spec.argv
        assert "gop=30" in record_spec.argv  # record default, untouched by the live override

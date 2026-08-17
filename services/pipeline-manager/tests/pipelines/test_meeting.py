from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline_manager.models import LayoutPresetId
from pipeline_manager.pipelines.layouts import PresetChannelMismatch
from pipeline_manager.pipelines.meeting import MeetingRequest, build_meeting
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "pipelines" / "meeting"
HDMI2_DEVICE = "hw:2,0"


def _golden(name: str) -> list[str]:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


def test_cams_fifty_fifty_matches_oracle() -> None:
    req = MeetingRequest(preset=LayoutPresetId.CAMS_FIFTY_FIFTY, hdmi2_alsa_device=HDMI2_DEVICE, ratio_a=50, ratio_b=50)
    spec = build_meeting(req, RK3588Profile())
    assert list(spec.argv) == _golden("prev_cam1_cam2_5050.json")


@pytest.mark.parametrize("preset", [LayoutPresetId.CAMS_FIFTY_FIFTY, LayoutPresetId.CAM_1, LayoutPresetId.CAM_2])
def test_no_video_encoder(preset: LayoutPresetId) -> None:
    spec = build_meeting(MeetingRequest(preset=preset, hdmi2_alsa_device=HDMI2_DEVICE), RK3588Profile())
    assert "mpph264enc" not in spec.argv
    assert spec.encode_slots == 0


@pytest.mark.parametrize("preset", [LayoutPresetId.CAMS_FIFTY_FIFTY, LayoutPresetId.CAM_1, LayoutPresetId.CAM_2])
def test_hdmi2_xvimagesink_present(preset: LayoutPresetId) -> None:
    spec = build_meeting(MeetingRequest(preset=preset, hdmi2_alsa_device=HDMI2_DEVICE), RK3588Profile())
    assert "xvimagesink" in spec.argv


def test_mic_branch_targets_configured_hdmi_alsa_device() -> None:
    spec = build_meeting(MeetingRequest(preset=LayoutPresetId.CAM_1, hdmi2_alsa_device=HDMI2_DEVICE), RK3588Profile())
    assert "alsasink" in spec.argv
    assert f"device={HDMI2_DEVICE}" in spec.argv
    # No mux/encode consumes the mic branch — it's a direct display-audio sink.
    assert "mpegtsmux" not in spec.argv
    assert "flvmux" not in spec.argv


def test_rejects_presentation_presets() -> None:
    for preset in (LayoutPresetId.FIFTY_FIFTY, LayoutPresetId.SIDE_BY_SIDE, LayoutPresetId.PC_ONLY):
        with pytest.raises(PresetChannelMismatch):
            build_meeting(MeetingRequest(preset=preset, hdmi2_alsa_device=HDMI2_DEVICE), RK3588Profile())


def test_works_without_usb_publisher() -> None:
    spec = build_meeting(MeetingRequest(preset=LayoutPresetId.CAM_1, hdmi2_alsa_device=HDMI2_DEVICE), RK3588Profile())
    assert "socket-path=/tmp/usb.sock" not in spec.argv


def test_placement_is_hdmi2_fullscreen() -> None:
    spec = build_meeting(MeetingRequest(preset=LayoutPresetId.CAM_1, hdmi2_alsa_device=HDMI2_DEVICE), RK3588Profile())
    assert spec.placement is not None
    assert spec.placement.fullscreen is True
    assert spec.placement.x == 1920

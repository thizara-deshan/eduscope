from __future__ import annotations

import pytest

from pipeline_manager.pipelines.profiles import (
    ProfileKind,
    UnsupportedProfile,
    get_profile,
)


def test_record_composite_bitrate_and_fps_appear_in_rendered_profile() -> None:
    profile = get_profile(ProfileKind.RECORD_COMPOSITE)
    assert profile.video_bitrate_bps == 4_000_000
    assert profile.fps == 30
    assert profile.gop == 30
    assert profile.container == "mpegts"


def test_live_composite_uses_gop_sixty() -> None:
    profile = get_profile(ProfileKind.LIVE_COMPOSITE)
    assert profile.gop == 60
    assert profile.container == "flv"


def test_record_usb_reencode_bitrate() -> None:
    profile = get_profile(ProfileKind.RECORD_USB_REENCODE)
    assert profile.video_bitrate_bps == 6_000_000


def test_passthrough_has_no_encode() -> None:
    profile = get_profile(ProfileKind.PASSTHROUGH)
    assert profile.video_bitrate_bps == 0


def test_thumbnail_profile_present() -> None:
    profile = get_profile(ProfileKind.THUMBNAIL)
    assert profile.container == "none"


def test_bitrate_override_within_range_applies() -> None:
    profile = get_profile(ProfileKind.RECORD_COMPOSITE, {"video_bitrate_bps": 5_000_000})
    assert profile.video_bitrate_bps == 5_000_000


@pytest.mark.parametrize("bitrate", [1_999_000, 8_001_000])
def test_bitrate_override_out_of_range_rejected(bitrate: int) -> None:
    with pytest.raises(ValueError):
        get_profile(ProfileKind.RECORD_COMPOSITE, {"video_bitrate_bps": bitrate})


def test_fps_override_zero_rejected() -> None:
    with pytest.raises(ValueError):
        get_profile(ProfileKind.RECORD_COMPOSITE, {"fps": 0})


def test_fps_override_applies_and_preserves_bitrate() -> None:
    profile = get_profile(ProfileKind.RECORD_COMPOSITE, {"fps": 25})
    assert profile.fps == 25
    assert profile.video_bitrate_bps == 4_000_000


def test_unsupported_container_override_rejected() -> None:
    with pytest.raises(ValueError):
        get_profile(ProfileKind.RECORD_COMPOSITE, {"container": "avi"})


def test_unsupported_profile_kind_rejected() -> None:
    with pytest.raises(UnsupportedProfile):
        get_profile("not-a-real-kind")  # type: ignore[arg-type]


def test_gop_override_applies() -> None:
    profile = get_profile(ProfileKind.RECORD_COMPOSITE, {"gop": 45})
    assert profile.gop == 45


def test_gop_override_non_positive_rejected() -> None:
    with pytest.raises(ValueError):
        get_profile(ProfileKind.RECORD_COMPOSITE, {"gop": 0})


def test_rate_control_override_applies() -> None:
    profile = get_profile(ProfileKind.RECORD_COMPOSITE, {"rc_mode": "vbr"})
    assert profile.rc_mode == "vbr"


def test_rate_control_override_unsupported_rejected() -> None:
    with pytest.raises(ValueError):
        get_profile(ProfileKind.RECORD_COMPOSITE, {"rc_mode": "abr"})


def test_audio_bitrate_override_applies() -> None:
    profile = get_profile(ProfileKind.RECORD_COMPOSITE, {"audio_bitrate_bps": 96_000})
    assert profile.audio_bitrate_bps == 96_000


def test_audio_bitrate_override_non_positive_rejected() -> None:
    with pytest.raises(ValueError):
        get_profile(ProfileKind.RECORD_COMPOSITE, {"audio_bitrate_bps": 0})


def test_all_five_editable_knobs_apply_together() -> None:
    profile = get_profile(
        ProfileKind.LIVE_COMPOSITE,
        {
            "video_bitrate_bps": 6_500_000,
            "fps": 24,
            "gop": 48,
            "rc_mode": "vbr",
            "audio_bitrate_bps": 160_000,
        },
    )
    assert profile.video_bitrate_bps == 6_500_000
    assert profile.fps == 24
    assert profile.gop == 48
    assert profile.rc_mode == "vbr"
    assert profile.audio_bitrate_bps == 160_000
    assert profile.container == "flv"  # container is fixed by pipeline kind, not a knob

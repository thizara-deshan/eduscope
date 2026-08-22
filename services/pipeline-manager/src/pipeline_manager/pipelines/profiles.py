from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
from typing import Literal, Mapping

# KEEP B-56 — the only user/knob-facing encode controls.
BITRATE_MIN_BPS = 2_000_000
BITRATE_MAX_BPS = 8_000_000

_CONTAINERS = ("mpegts", "flv", "none")
_RATE_CONTROL_MODES = ("cbr", "vbr")


class ProfileKind(str, Enum):
    RECORD_COMPOSITE = "record-composite"
    RECORD_USB_REENCODE = "record-usb-reencode"
    LIVE_COMPOSITE = "live-composite"
    PASSTHROUGH = "passthrough"
    THUMBNAIL = "thumbnail"


class UnsupportedProfile(ValueError):
    pass


@dataclass(frozen=True)
class EncodeProfile:
    id: str
    video_bitrate_bps: int
    fps: int
    rc_mode: str
    gop: int
    h264_profile: str
    audio_bitrate_bps: int
    container: Literal["mpegts", "flv", "none"]


_BASE_PROFILES: dict[ProfileKind, EncodeProfile] = {
    ProfileKind.RECORD_COMPOSITE: EncodeProfile(
        id="record-composite",
        video_bitrate_bps=4_000_000,
        fps=30,
        rc_mode="cbr",
        gop=30,
        h264_profile="high",
        audio_bitrate_bps=128_000,
        container="mpegts",
    ),
    ProfileKind.RECORD_USB_REENCODE: EncodeProfile(
        id="record-usb-reencode",
        video_bitrate_bps=6_000_000,
        fps=30,
        rc_mode="cbr",
        gop=30,
        h264_profile="high",
        audio_bitrate_bps=128_000,
        container="mpegts",
    ),
    ProfileKind.LIVE_COMPOSITE: EncodeProfile(
        id="live-composite",
        video_bitrate_bps=4_000_000,
        fps=30,
        rc_mode="cbr",
        gop=60,
        h264_profile="high",
        audio_bitrate_bps=128_000,
        container="flv",
    ),
    ProfileKind.PASSTHROUGH: EncodeProfile(
        # Remux only — no encoder session is consumed (§4.1 efficiency win).
        id="passthrough",
        video_bitrate_bps=0,
        fps=30,
        rc_mode="none",
        gop=0,
        h264_profile="high",
        audio_bitrate_bps=128_000,
        container="mpegts",
    ),
    ProfileKind.THUMBNAIL: EncodeProfile(
        # Provisional bench default pending B-T7; frame budget (480x270/15fps)
        # is fixed by A-06, not this profile.
        id="thumbnail",
        video_bitrate_bps=800_000,
        fps=15,
        rc_mode="cbr",
        gop=30,
        h264_profile="baseline",
        audio_bitrate_bps=0,
        container="none",
    ),
}


def get_profile(kind: ProfileKind, overrides: Mapping[str, object] | None = None) -> EncodeProfile:
    try:
        base = _BASE_PROFILES[kind]
    except KeyError as exc:
        raise UnsupportedProfile(f"unsupported profile kind: {kind}") from exc

    if not overrides:
        return base

    changes: dict[str, object] = {}
    if "video_bitrate_bps" in overrides:
        bitrate = overrides["video_bitrate_bps"]
        if not isinstance(bitrate, int) or not (BITRATE_MIN_BPS <= bitrate <= BITRATE_MAX_BPS):
            raise ValueError(
                f"videoBitrateKbps override must be within {BITRATE_MIN_BPS}..{BITRATE_MAX_BPS} bps"
            )
        changes["video_bitrate_bps"] = bitrate
    if "fps" in overrides:
        fps = overrides["fps"]
        if not isinstance(fps, int) or fps <= 0:
            raise ValueError("fps override must be a positive integer")
        changes["fps"] = fps
    if "container" in overrides:
        container = overrides["container"]
        if container not in _CONTAINERS:
            raise ValueError(f"unsupported container: {container!r}")
        changes["container"] = container
    # KEEP B-56 correction (2026-08-18 gate) — gop/rateControl/audioBitrateBps
    # join bitrate/fps as editable knobs; passthrough callers never pass
    # overrides, so the remux profile is unaffected by design.
    if "gop" in overrides:
        gop = overrides["gop"]
        if not isinstance(gop, int) or gop <= 0:
            raise ValueError("gop override must be a positive integer")
        changes["gop"] = gop
    if "rc_mode" in overrides:
        rc_mode = overrides["rc_mode"]
        if rc_mode not in _RATE_CONTROL_MODES:
            raise ValueError(f"unsupported rateControl: {rc_mode!r}")
        changes["rc_mode"] = rc_mode
    if "audio_bitrate_bps" in overrides:
        audio_bitrate = overrides["audio_bitrate_bps"]
        if not isinstance(audio_bitrate, int) or audio_bitrate <= 0:
            raise ValueError("audioBitrateBps override must be a positive integer")
        changes["audio_bitrate_bps"] = audio_bitrate

    return replace(base, **changes)

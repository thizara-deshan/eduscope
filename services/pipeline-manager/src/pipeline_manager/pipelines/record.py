from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping

from ..models import Channel, LayoutPresetId, SourceRole
from .builder import (
    CAMERA_ROLES,
    ROLE_SOCKETS,
    PipelineBuilder,
    PipelineSpec,
    UnsupportedPipeline,
    audio_branch,
    source_branch_normalized,
)
from .layouts import LayoutPreset, get_layout
from .platforms.base import Pad, PlatformProfile
from .profiles import ProfileKind, get_profile

AUDIO_ROLE = SourceRole.MIC_LECTURER


@dataclass(frozen=True)
class RecordRequest:
    preset: LayoutPresetId
    ratio_a: int | None = None
    ratio_b: int | None = None
    output_path: str | None = None
    output_paths: Mapping[str, str] | None = None
    video_bitrate_bps: int | None = None
    fps: int | None = None
    gop: int | None = None
    rate_control: str | None = None
    audio_bitrate_bps: int | None = None


def _profile_overrides(req: RecordRequest) -> Mapping[str, object] | None:
    changes: dict[str, object] = {}
    if req.video_bitrate_bps is not None:
        changes["video_bitrate_bps"] = req.video_bitrate_bps
    if req.fps is not None:
        changes["fps"] = req.fps
    if req.gop is not None:
        changes["gop"] = req.gop
    if req.rate_control is not None:
        changes["rc_mode"] = req.rate_control
    if req.audio_bitrate_bps is not None:
        changes["audio_bitrate_bps"] = req.audio_bitrate_bps
    return changes or None


def build_record(
    req: RecordRequest,
    platform: PlatformProfile,
    *,
    is_role_healthy: Callable[[SourceRole], bool] = lambda role: True,
) -> PipelineSpec:
    """`is_role_healthy` (A-REV-003) is the debounced publisher-health lookup
    a caller may inject — every existing caller that omits it gets the
    original "every required role is healthy" behavior byte-for-byte
    (`PipelineBuilder` only takes the `healthy=False` branch when a role is
    reported down), so this is additive: no existing argv changes.
    """
    layout = get_layout(req.preset, Channel.LOCAL, req.ratio_a, req.ratio_b)
    if layout.kind == "multi-file":
        return _build_separate(req, layout, platform)
    if layout.passthrough_eligible and _is_h264_single(layout):
        return _build_camera_passthrough(req, layout, platform)
    return _build_composite_or_raw(req, layout, platform, is_role_healthy)


def _is_h264_single(layout: LayoutPreset) -> bool:
    return len(layout.tiles) == 1 and layout.tiles[0].role in CAMERA_ROLES


def _require_output_path(req: RecordRequest) -> str:
    if not req.output_path:
        raise UnsupportedPipeline("record requires outputPath")
    return req.output_path


def _build_composite_or_raw(
    req: RecordRequest,
    layout: LayoutPreset,
    platform: PlatformProfile,
    is_role_healthy: Callable[[SourceRole], bool] = lambda role: True,
) -> PipelineSpec:
    output_path = _require_output_path(req)
    profile = get_profile(ProfileKind.RECORD_COMPOSITE, _profile_overrides(req))
    builder = PipelineBuilder()
    multi_tile = len(layout.tiles) > 1

    if not multi_tile:
        tile = layout.tiles[0]
        _record_source_branch(
            builder, platform, tile.role, target_width=tile.w, target_height=tile.h,
            apply_scale=False, sink_pad=None, healthy=is_role_healthy(tile.role), fps=profile.fps,
        )
        builder.add(*platform.encoder(profile), "!", "h264parse", "config-interval=1", "!", "queue", "!", "mux.")
        degraded_start_ok = True
    else:
        pads = []
        for index, tile in enumerate(layout.tiles):
            sink_pad = f"comp.sink_{index}"
            _record_source_branch(
                builder, platform, tile.role,
                target_width=tile.w, target_height=tile.h, apply_scale=True, sink_pad=sink_pad,
                healthy=is_role_healthy(tile.role), fps=profile.fps,
            )
            pads.append(Pad(name=f"sink_{index}", xpos=tile.x, ypos=tile.y, width=tile.w, height=tile.h))
        builder.add(*platform.compositor("comp", pads), "!")
        builder.add(
            f"video/x-raw,width=1920,height=1080,framerate={profile.fps}/1",
            "!",
            "queue",
            "!",
            *platform.encoder(profile),
            "!",
            "h264parse",
            "config-interval=1",
            "!",
            "queue",
            "!",
            "mux.",
        )
        degraded_start_ok = True

    audio_branch(builder, platform, profile, "mux.", healthy=is_role_healthy(AUDIO_ROLE))
    builder.add(*platform.mux("mpegts", "mux"), "!", *platform.file_sink(output_path))

    return PipelineSpec(
        argv=builder.build(),
        required_roles=layout.required_roles,
        encode_slots=1,
        outputs=(output_path,),
        degraded_start_ok=degraded_start_ok,
        resilient_roles=tuple(
            tile.role for tile in layout.tiles if tile.role in CAMERA_ROLES and is_role_healthy(tile.role)
        ),
    )


def _record_source_branch(
    builder: PipelineBuilder,
    platform: PlatformProfile,
    role: SourceRole,
    *,
    target_width: int,
    target_height: int,
    apply_scale: bool,
    sink_pad: str | None,
    healthy: bool,
    fps: int,
) -> None:
    """Build a camera branch with a live, switchable placeholder.

    The resilient record worker handles errors from the named ``shmsrc`` and
    changes this selector without rebuilding the mux or changing its PGID.
    Non-camera roles retain the regular builder path.
    """
    if role not in CAMERA_ROLES:
        source_branch_normalized(
            builder, platform, role, target_width=target_width, target_height=target_height,
            apply_scale=apply_scale, sink_pad=sink_pad, healthy=healthy, fps=fps,
        )
        return

    if not healthy:
        source_branch_normalized(
            builder, platform, role, target_width=target_width, target_height=target_height,
            apply_scale=apply_scale, sink_pad=sink_pad, healthy=False, fps=fps,
        )
        return

    suffix = role.value.replace("-", "_")
    selector = f"sel_{suffix}"
    socket = ROLE_SOCKETS[role]
    builder.add(
        "shmsrc", f"name=source_{suffix}", f"socket-path={socket}", "is-live=true", "do-timestamp=true", "!",
        platform.shm_video_caps(role), "!", "h264parse", "!", *platform.decoder(), "!",
        "queue", "max-size-buffers=6", "leaky=downstream", "!", f"{selector}.sink_0",
        "videotestsrc", "is-live=true", "pattern=black", "!",
        f"video/x-raw,format=I420,width={target_width},height={target_height},framerate={fps}/1", "!",
        "textoverlay", 'text="SOURCE UNAVAILABLE"', "valignment=center", "halignment=center",
        'font-desc="Sans Bold 48"', "!", f"{selector}.sink_1",
        "input-selector", f"name={selector}", "!", *platform.convert(), "!",
        "queue", "max-size-buffers=6", "leaky=downstream", "!", "videorate", "drop-only=true", "!",
        f"video/x-raw,framerate={fps}/1", "!",
    )
    if apply_scale:
        builder.add(*platform.scale(), "!", f"video/x-raw,width={target_width},height={target_height}", "!", "queue", "!")
        if sink_pad:
            builder.add(sink_pad)


def _build_camera_passthrough(req: RecordRequest, layout: LayoutPreset, platform: PlatformProfile) -> PipelineSpec:
    output_path = _require_output_path(req)
    profile = get_profile(ProfileKind.PASSTHROUGH)
    tile = layout.tiles[0]
    socket = ROLE_SOCKETS[tile.role]
    builder = PipelineBuilder()
    builder.add(
        "shmsrc",
        f"socket-path={socket}",
        "is-live=true",
        "do-timestamp=true",
        "!",
        platform.shm_video_caps(tile.role),
        "!",
        "h264parse",
        "!",
        "queue",
        "!",
        "mux.",
    )
    audio_branch(builder, platform, profile, "mux.")
    builder.add(*platform.mux("mpegts", "mux"), "!", *platform.file_sink(output_path))

    return PipelineSpec(
        argv=builder.build(),
        required_roles=layout.required_roles,
        encode_slots=0,
        outputs=(output_path,),
    )


def _build_separate(req: RecordRequest, layout: LayoutPreset, platform: PlatformProfile) -> PipelineSpec:
    if not req.output_paths:
        raise UnsupportedPipeline("separate-files record requires outputPaths per stream key")
    if len(layout.outputs) != 2:
        raise UnsupportedPipeline("separate-files expects exactly two outputs")

    usb_output, cam_output = layout.outputs
    try:
        usb_path = req.output_paths[usb_output.stream_key]
        cam_path = req.output_paths[cam_output.stream_key]
    except KeyError as exc:
        raise UnsupportedPipeline(f"missing outputPath for stream key {exc}") from exc

    reencode_profile = get_profile(ProfileKind.RECORD_USB_REENCODE, _profile_overrides(req))
    passthrough_profile = get_profile(ProfileKind.PASSTHROUGH)
    builder = PipelineBuilder()

    usb_role = usb_output.role_ids[0]
    builder.add(
        "shmsrc",
        f"socket-path={ROLE_SOCKETS[usb_role]}",
        "is-live=true",
        "do-timestamp=true",
        "!",
        platform.shm_video_caps(usb_role),
        "!",
        "queue",
        "max-size-buffers=6",
        "leaky=downstream",
        "!",
        "videorate",
        "drop-only=true",
        "!",
        "video/x-raw,framerate=30/1",
        "!",
        *platform.encoder(reencode_profile),
        "!",
        "h264parse",
        "config-interval=1",
        "!",
        "queue",
        "!",
        "muxu.",
    )
    if usb_output.include_audio:
        audio_branch(builder, platform, reencode_profile, "muxu.")

    cam_role = cam_output.role_ids[0]
    builder.add(
        "shmsrc",
        f"socket-path={ROLE_SOCKETS[cam_role]}",
        "is-live=true",
        "do-timestamp=true",
        "!",
        platform.shm_video_caps(cam_role),
        "!",
        "h264parse",
        "!",
        "queue",
        "!",
        "muxc.",
    )
    if cam_output.include_audio:
        audio_branch(builder, platform, passthrough_profile, "muxc.")

    builder.add(*platform.mux("mpegts", "muxu"), "!", *platform.file_sink(usb_path))
    builder.add(*platform.mux("mpegts", "muxc"), "!", *platform.file_sink(cam_path))

    return PipelineSpec(
        argv=builder.build(),
        required_roles=layout.required_roles,
        encode_slots=1,
        outputs=(usb_path, cam_path),
    )

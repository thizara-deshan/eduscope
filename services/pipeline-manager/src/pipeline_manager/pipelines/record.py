from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from ..models import Channel, LayoutPresetId, SourceRole
from .builder import ROLE_SOCKETS, PipelineBuilder, PipelineSpec, UnsupportedPipeline
from .layouts import LayoutPreset, Tile, get_layout
from .platforms.base import Pad, PlatformProfile
from .profiles import EncodeProfile, ProfileKind, get_profile

AUDIO_ROLE = SourceRole.MIC_LECTURER
CAMERA_ROLES = (SourceRole.LECTURER_CAM, SourceRole.STUDENTS_CAM)


@dataclass(frozen=True)
class RecordRequest:
    preset: LayoutPresetId
    ratio_a: int | None = None
    ratio_b: int | None = None
    output_path: str | None = None
    output_paths: Mapping[str, str] | None = None


def build_record(req: RecordRequest, platform: PlatformProfile) -> PipelineSpec:
    layout = get_layout(req.preset, Channel.LOCAL, req.ratio_a, req.ratio_b)
    if layout.kind == "multi-file":
        return _build_separate(req, layout, platform)
    if layout.passthrough_eligible and _is_h264_single(layout):
        return _build_camera_passthrough(req, layout, platform)
    return _build_composite_or_raw(req, layout, platform)


def _is_h264_single(layout: LayoutPreset) -> bool:
    return len(layout.tiles) == 1 and layout.tiles[0].role in CAMERA_ROLES


def _require_output_path(req: RecordRequest) -> str:
    if not req.output_path:
        raise UnsupportedPipeline("record requires outputPath")
    return req.output_path


def _source_branch_normalized(
    builder: PipelineBuilder, platform: PlatformProfile, tile: Tile, sink_pad: str | None
) -> None:
    socket = ROLE_SOCKETS[tile.role]
    builder.add("shmsrc", f"socket-path={socket}", "is-live=true", "do-timestamp=true", "!")
    if tile.role in CAMERA_ROLES:
        builder.add(
            platform.shm_video_caps(tile.role),
            "!",
            "h264parse",
            "!",
            *platform.decoder(),
            "!",
            *platform.convert(),
            "!",
        )
    else:
        builder.add(platform.shm_video_caps(tile.role), "!")
    builder.add(
        "queue",
        "max-size-buffers=6",
        "leaky=downstream",
        "!",
        "videorate",
        "drop-only=true",
        "!",
        "video/x-raw,framerate=30/1",
        "!",
        *platform.scale(),
        "!",
        f"video/x-raw,width={tile.w},height={tile.h}",
        "!",
        "queue",
        "!",
    )
    if sink_pad:
        builder.add(sink_pad)


def _audio_branch(
    builder: PipelineBuilder, platform: PlatformProfile, profile: EncodeProfile, mux_pad: str
) -> None:
    socket = ROLE_SOCKETS[AUDIO_ROLE]
    builder.add(
        "shmsrc",
        f"socket-path={socket}",
        "is-live=true",
        "do-timestamp=true",
        "!",
        platform.audio_caps(),
        "!",
        "queue",
        "!",
        "audioconvert",
        "!",
        "audioresample",
        "!",
        *platform.audio_encoder(profile),
        "!",
        "queue",
        "!",
        mux_pad,
    )


def _build_composite_or_raw(req: RecordRequest, layout: LayoutPreset, platform: PlatformProfile) -> PipelineSpec:
    output_path = _require_output_path(req)
    profile = get_profile(ProfileKind.RECORD_COMPOSITE)
    builder = PipelineBuilder()

    if len(layout.tiles) == 1:
        tile = layout.tiles[0]
        _source_branch_normalized(builder, platform, tile, sink_pad=None)
        builder.add(*platform.encoder(profile), "!", "h264parse", "config-interval=1", "!", "queue", "!", "mux.")
    else:
        pads = []
        for index, tile in enumerate(layout.tiles):
            sink_pad = f"comp.sink_{index}"
            _source_branch_normalized(builder, platform, tile, sink_pad=sink_pad)
            pads.append(Pad(name=f"sink_{index}", xpos=tile.x, ypos=tile.y, width=tile.w, height=tile.h))
        builder.add(*platform.compositor("comp", pads), "!")
        builder.add(
            "video/x-raw,width=1920,height=1080,framerate=30/1",
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

    _audio_branch(builder, platform, profile, "mux.")
    builder.add(*platform.mux("mpegts", "mux"), "!", *platform.file_sink(output_path))

    return PipelineSpec(
        argv=builder.build(),
        required_roles=layout.required_roles,
        encode_slots=1,
        outputs=(output_path,),
    )


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
    _audio_branch(builder, platform, profile, "mux.")
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

    reencode_profile = get_profile(ProfileKind.RECORD_USB_REENCODE)
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
        _audio_branch(builder, platform, reencode_profile, "muxu.")

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
        _audio_branch(builder, platform, passthrough_profile, "muxc.")

    builder.add(*platform.mux("mpegts", "muxu"), "!", *platform.file_sink(usb_path))
    builder.add(*platform.mux("mpegts", "muxc"), "!", *platform.file_sink(cam_path))

    return PipelineSpec(
        argv=builder.build(),
        required_roles=layout.required_roles,
        encode_slots=1,
        outputs=(usb_path, cam_path),
    )

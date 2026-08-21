from __future__ import annotations

import re
from dataclasses import dataclass

from ..models import Channel, LayoutPresetId
from .builder import PipelineBuilder, PipelineSpec, audio_branch, source_branch_normalized
from .layouts import get_layout
from .platforms.base import Pad, PlatformProfile
from .profiles import ProfileKind, get_profile

RTMP_BASE = "rtmp://127.0.0.1:1935/live"
STREAM_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


class InvalidStreamKey(ValueError):
    pass


@dataclass(frozen=True)
class LiveRequest:
    preset: LayoutPresetId
    stream_key: str
    ratio_a: int | None = None
    ratio_b: int | None = None


def _validate_stream_key(stream_key: str) -> None:
    if not STREAM_KEY_PATTERN.match(stream_key):
        raise InvalidStreamKey(f"streamKey must match {STREAM_KEY_PATTERN.pattern}")


def build_live(req: LiveRequest, platform: PlatformProfile) -> PipelineSpec:
    _validate_stream_key(req.stream_key)
    layout = get_layout(req.preset, Channel.STREAMING, req.ratio_a, req.ratio_b)
    profile = get_profile(ProfileKind.LIVE_COMPOSITE)
    builder = PipelineBuilder()
    multi_tile = len(layout.tiles) > 1

    if not multi_tile:
        tile = layout.tiles[0]
        source_branch_normalized(
            builder, platform, tile.role,
            target_width=tile.w, target_height=tile.h, apply_scale=False, sink_pad=None,
            fps=profile.fps,
        )
        builder.add(
            *platform.encoder(profile), "!", "h264parse", "config-interval=1", "!",
            "queue", "max-size-buffers=200", "!", "mux.",
        )
    else:
        pads = []
        for index, tile in enumerate(layout.tiles):
            sink_pad = f"comp.sink_{index}"
            source_branch_normalized(
                builder, platform, tile.role,
                target_width=tile.w, target_height=tile.h, apply_scale=True, sink_pad=sink_pad,
                fps=profile.fps,
            )
            pads.append(Pad(name=f"sink_{index}", xpos=tile.x, ypos=tile.y, width=tile.w, height=tile.h))
        builder.add(*platform.compositor("comp", pads), "!")
        builder.add(
            f"video/x-raw,width=1920,height=1080,framerate={profile.fps}/1", "!", "queue", "!",
            *platform.encoder(profile), "!", "h264parse", "config-interval=1", "!",
            "queue", "max-size-buffers=200", "!", "mux.",
        )

    audio_branch(builder, platform, profile, "mux.", queue_props=("max-size-buffers=200",))

    target = f"{RTMP_BASE}/{req.stream_key}"
    builder.add(*platform.mux("flv", "mux"), "!", "queue", "max-size-buffers=400", "!")
    builder.add(*platform.rtmp_sink(f"{target} live=1"))

    return PipelineSpec(
        argv=builder.build(),
        required_roles=layout.required_roles,
        encode_slots=1,
        outputs=(target,),
    )

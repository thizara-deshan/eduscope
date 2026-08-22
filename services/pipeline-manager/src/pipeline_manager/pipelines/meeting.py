from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from ..models import Channel, LayoutPresetId, SourceRole
from .builder import (
    DisplayPlacement,
    PipelineBuilder,
    PipelineSpec,
    audio_source_tokens,
    source_branch_normalized,
)
from .layouts import get_layout
from .platforms.base import DisplayOut, Pad, PlatformProfile

_MEETING_TILE_QUEUE_PROPS = ("max-size-buffers=6", "leaky=downstream")


@dataclass(frozen=True)
class MeetingRequest:
    preset: LayoutPresetId
    hdmi2_alsa_device: str
    ratio_a: int | None = None
    ratio_b: int | None = None


def build_meeting(
    req: MeetingRequest,
    platform: PlatformProfile,
    *,
    is_role_healthy: Callable[[SourceRole], bool] = lambda role: True,
) -> PipelineSpec:
    """`is_role_healthy` (A-REV-003) mirrors `build_record`'s injected
    debounced-health lookup; every existing caller (default: everyone
    healthy) gets byte-identical argv to before."""
    layout = get_layout(req.preset, Channel.MEETING, req.ratio_a, req.ratio_b)
    builder = PipelineBuilder()
    multi_tile = len(layout.tiles) > 1

    if not multi_tile:
        tile = layout.tiles[0]
        source_branch_normalized(
            builder, platform, tile.role,
            target_width=tile.w, target_height=tile.h, apply_scale=False, sink_pad=None,
            healthy=is_role_healthy(tile.role),
        )
        builder.add(*platform.display_sink(DisplayOut.HDMI_2))
    else:
        pads = []
        for index, tile in enumerate(layout.tiles):
            sink_pad = f"comp.sink_{index}"
            source_branch_normalized(
                builder, platform, tile.role,
                target_width=tile.w, target_height=tile.h, apply_scale=True, sink_pad=sink_pad,
                sink_queue_props=_MEETING_TILE_QUEUE_PROPS,
                healthy=is_role_healthy(tile.role),
            )
            pads.append(Pad(name=f"sink_{index}", xpos=tile.x, ypos=tile.y, width=tile.w, height=tile.h))
        builder.add(*platform.compositor("comp", pads), "!")
        builder.add(
            "video/x-raw,width=1920,height=1080,framerate=30/1", "!", "queue", "!",
            *platform.display_sink(DisplayOut.HDMI_2),
        )

    # Mic audio embeds directly onto the HDMI #2 ALSA device — no mux, no encode
    # (A-15/PF-12): the dongle presents webcam + mic to the laptop as one device.
    audio_source_tokens(builder, platform, healthy=is_role_healthy(SourceRole.MIC_LECTURER))
    builder.add(
        "queue",
        "!",
        "audioconvert",
        "!",
        "audioresample",
        "!",
        "alsasink",
        f"device={req.hdmi2_alsa_device}",
        "sync=false",
    )

    placement = DisplayPlacement(output=DisplayOut.HDMI_2, x=1920, y=0, width=1920, height=1080, fullscreen=True)
    return PipelineSpec(
        argv=builder.build(),
        required_roles=layout.required_roles,
        encode_slots=0,
        outputs=(),
        placement=placement,
        degraded_start_ok=True,
    )

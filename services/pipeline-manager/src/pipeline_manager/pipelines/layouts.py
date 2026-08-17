from __future__ import annotations

import json
from dataclasses import dataclass, replace
from functools import lru_cache
from importlib import resources

from ..models import Channel, LayoutPresetId, SourceRole

CANVAS_WIDTH = 1920
CANVAS_HEIGHT = 1080

# The exact corrected v1 channel matrix (13 pairs, workstream-A gate correction).
ALLOWED_CHANNELS: dict[Channel, frozenset[str]] = {
    Channel.LOCAL: frozenset({"fifty-fifty", "side-by-side", "cam-1", "cam-2", "separate-files"}),
    Channel.MEETING: frozenset({"cams-fifty-fifty", "cam-1", "cam-2"}),
    Channel.STREAMING: frozenset({"fifty-fifty", "side-by-side", "cam-1", "cam-2", "pc-only"}),
}


class InvalidRatio(ValueError):
    pass


class PresetChannelMismatch(ValueError):
    pass


@dataclass(frozen=True)
class Tile:
    role: SourceRole
    x: int
    y: int
    w: int
    h: int
    z: int


@dataclass(frozen=True)
class OutputSpec:
    stream_key: str
    role_ids: tuple[SourceRole, ...]
    include_audio: bool


@dataclass(frozen=True)
class LayoutPreset:
    id: LayoutPresetId
    display_name: str
    description: str
    allowed_channels: frozenset[Channel]
    kind: str
    canvas_width: int
    canvas_height: int
    tiles: tuple[Tile, ...]
    parametric: bool
    outputs: tuple[OutputSpec, ...]
    passthrough_eligible: bool
    required_roles: tuple[SourceRole, ...]


@dataclass(frozen=True)
class RatioGeometry:
    x0: int
    y0: int
    w0: int
    h0: int
    x1: int
    y1: int
    w1: int
    h1: int


def ratio_geometry(ratio_a: int, ratio_b: int) -> RatioGeometry:
    """Port of scripts/bash/_layout.sh::ratio_layout — even-dimension, 16:9 tiles
    centered on the 1920x1080 canvas. Do not call the shell script at runtime.
    """
    if ratio_a <= 0 or ratio_b <= 0:
        raise InvalidRatio("ratioA and ratioB must both be positive")
    w0 = CANVAS_WIDTH * ratio_a // (ratio_a + ratio_b)
    w0 -= w0 % 2
    w1 = CANVAS_WIDTH - w0
    w1 -= w1 % 2
    h0 = w0 * 9 // 16
    h0 -= h0 % 2
    h1 = w1 * 9 // 16
    h1 -= h1 % 2
    y0 = (CANVAS_HEIGHT - h0) // 2
    y0 -= y0 % 2
    y1 = (CANVAS_HEIGHT - h1) // 2
    y1 -= y1 % 2
    return RatioGeometry(x0=0, y0=y0, w0=w0, h0=h0, x1=w0, y1=y1, w1=w1, h1=h1)


_CATALOG_PACKAGE = "pipeline_manager.resources"
_CATALOG_FILENAME = "layout-presets.v1.json"


@lru_cache(maxsize=1)
def _raw_catalog() -> tuple[dict, ...]:
    data = resources.files(_CATALOG_PACKAGE).joinpath(_CATALOG_FILENAME).read_text(encoding="utf-8")
    return tuple(json.loads(data))


def _to_tile(row: dict) -> Tile:
    return Tile(role=SourceRole(row["roleId"]), x=row["x"], y=row["y"], w=row["w"], h=row["h"], z=row["z"])


def _to_output(row: dict) -> OutputSpec:
    return OutputSpec(
        stream_key=row["streamKey"],
        role_ids=tuple(SourceRole(role) for role in row["roleIds"]),
        include_audio=row["includeAudio"],
    )


def _to_preset(row: dict) -> LayoutPreset:
    canvas = row["canvas"]
    return LayoutPreset(
        id=LayoutPresetId(row["id"]),
        display_name=row["displayName"],
        description=row["description"],
        allowed_channels=frozenset(Channel(c) for c in row["allowedChannels"]),
        kind=row["kind"],
        canvas_width=canvas["width"],
        canvas_height=canvas["height"],
        tiles=tuple(_to_tile(t) for t in row["tiles"]),
        parametric=row["parametric"],
        outputs=tuple(_to_output(o) for o in row["outputs"]),
        passthrough_eligible=row["passthroughEligible"],
        required_roles=tuple(SourceRole(r) for r in row["requiredRoles"]),
    )


@lru_cache(maxsize=1)
def _catalog_by_id() -> dict[LayoutPresetId, LayoutPreset]:
    return {preset.id: preset for preset in (_to_preset(row) for row in _raw_catalog())}


def get_layout(
    preset_id: LayoutPresetId, channel: Channel, ratio_a: int | None, ratio_b: int | None
) -> LayoutPreset:
    if preset_id.value not in ALLOWED_CHANNELS[channel]:
        raise PresetChannelMismatch(f"{preset_id.value} is not allowed on channel {channel.value}")

    preset = _catalog_by_id()[preset_id]
    if not preset.parametric or ratio_a is None or ratio_b is None:
        return preset

    geometry = ratio_geometry(ratio_a, ratio_b)
    first, second = preset.tiles[0], preset.tiles[1]
    tiles = (
        replace(first, x=geometry.x0, y=geometry.y0, w=geometry.w0, h=geometry.h0),
        replace(second, x=geometry.x1, y=geometry.y1, w=geometry.w1, h=geometry.h1),
    )
    return replace(preset, tiles=tiles)

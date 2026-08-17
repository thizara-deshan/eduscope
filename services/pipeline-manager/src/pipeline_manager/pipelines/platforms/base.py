from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable, Protocol, Sequence, runtime_checkable

from ...models import SourceRole


class DisplayOut(str, Enum):
    HDMI_1 = "hdmi-1"
    HDMI_2 = "hdmi-2"


@dataclass(frozen=True)
class Pad:
    name: str
    xpos: int
    ypos: int
    width: int
    height: int


class EncodeProfileLike(Protocol):
    """Structural shape of A-03's EncodeProfile, without importing it (avoids a cycle)."""

    id: str
    video_bitrate_bps: int
    rc_mode: str
    gop: int
    h264_profile: str
    audio_bitrate_bps: int
    container: str


PlacementFn = Callable[[], Sequence[str]]


@runtime_checkable
class PlatformProfile(Protocol):
    """The whole platform-specific surface (pipeline-manager.md §2.3).

    The builder never names an element directly; it asks the plug for a role.
    """

    id: str

    def shm_video_caps(self, role: SourceRole) -> str: ...
    def audio_caps(self) -> str: ...
    def decoder(self) -> list[str]: ...
    def convert(self) -> list[str]: ...
    def scale(self) -> list[str]: ...
    def compositor(self, name: str, pads: list[Pad]) -> list[str]: ...
    def encoder(self, profile: EncodeProfileLike) -> list[str]: ...
    def audio_encoder(self, profile: EncodeProfileLike) -> list[str]: ...
    def mux(self, kind: str, name: str) -> list[str]: ...
    def display_sink(self, output: DisplayOut) -> list[str]: ...
    def rtmp_sink(self, url: str) -> list[str]: ...
    def file_sink(self, path: str) -> list[str]: ...
    def display_place(self, output: DisplayOut) -> PlacementFn: ...
    def required_elements(self) -> list[str]: ...

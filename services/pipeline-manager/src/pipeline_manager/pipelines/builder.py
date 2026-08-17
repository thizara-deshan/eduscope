from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

from ..models import SourceRole
from .platforms.base import DisplayOut, EncodeProfileLike, PlatformProfile

GST_LAUNCH_PREFIX: tuple[str, ...] = ("gst-launch-1.0", "-e", "-m")
CANVAS_WIDTH = 1920
CANVAS_HEIGHT = 1080

# Publisher aliases stay internal (usb/rtsp/rtsp2/audio); fixed sockets (design §0.2).
ROLE_SOCKETS: dict[SourceRole, str] = {
    SourceRole.PRESENTATION: "/tmp/usb.sock",
    SourceRole.LECTURER_CAM: "/tmp/rtsp.sock",
    SourceRole.STUDENTS_CAM: "/tmp/rtsp2.sock",
    SourceRole.MIC_LECTURER: "/tmp/audio.sock",
}

CAMERA_ROLES = (SourceRole.LECTURER_CAM, SourceRole.STUDENTS_CAM)


class InvalidToken(ValueError):
    pass


class UnsupportedPipeline(ValueError):
    pass


def _validate_token(token: str) -> None:
    if not isinstance(token, str) or "\x00" in token or "\n" in token:
        raise InvalidToken(f"invalid pipeline token: {token!r}")


@dataclass
class PipelineBuilder:
    """Token-only source -> compose -> sink assembly (pipeline-manager.md §2).

    Never joins tokens into a shell string — argv is spawned with shell=False
    downstream (A-07). No gst-launch fragment is formed outside this module.
    """

    _tokens: list[str] = field(default_factory=lambda: list(GST_LAUNCH_PREFIX))

    def add(self, *tokens: str) -> "PipelineBuilder":
        for token in tokens:
            _validate_token(token)
            self._tokens.append(token)
        return self

    def branch(self, tokens: Sequence[str]) -> "PipelineBuilder":
        return self.add(*tokens)

    def build(self) -> tuple[str, ...]:
        return tuple(self._tokens)


@dataclass(frozen=True)
class PipelineSpec:
    argv: tuple[str, ...]
    required_roles: tuple[SourceRole, ...]
    encode_slots: int
    outputs: tuple[str, ...]
    placement: Any | None = None


@dataclass(frozen=True)
class DisplayPlacement:
    """Applied post-spawn (wmctrl) — placement is not part of pipeline text (§2.4)."""

    output: DisplayOut
    x: int
    y: int
    width: int
    height: int
    fullscreen: bool


def source_branch_normalized(
    builder: PipelineBuilder,
    platform: PlatformProfile,
    role: SourceRole,
    *,
    target_width: int,
    target_height: int,
    apply_scale: bool,
    sink_pad: str | None,
    sink_queue_props: Sequence[str] = (),
) -> None:
    """shmsrc -> (decode if camera) -> normalize -> (scale+queue if apply_scale).

    A full-canvas single tile (apply_scale=False) chains straight from the
    framerate caps into whatever the caller adds next (an encoder) — matching
    live_cam1.sh/live_usb.sh, which have no redundant scale or queue there.
    """
    socket = ROLE_SOCKETS[role]
    builder.add("shmsrc", f"socket-path={socket}", "is-live=true", "do-timestamp=true", "!")
    if role in CAMERA_ROLES:
        builder.add(
            platform.shm_video_caps(role),
            "!",
            "h264parse",
            "!",
            *platform.decoder(),
            "!",
            *platform.convert(),
            "!",
        )
    else:
        builder.add(platform.shm_video_caps(role), "!")
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
    )
    if apply_scale:
        builder.add(
            *platform.scale(),
            "!",
            f"video/x-raw,width={target_width},height={target_height}",
            "!",
            "queue",
            *sink_queue_props,
            "!",
        )
        if sink_pad:
            builder.add(sink_pad)


def audio_branch(
    builder: PipelineBuilder,
    platform: PlatformProfile,
    profile: EncodeProfileLike,
    mux_pad: str,
    *,
    queue_props: Sequence[str] = (),
) -> None:
    socket = ROLE_SOCKETS[SourceRole.MIC_LECTURER]
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
        *queue_props,
        "!",
        mux_pad,
    )

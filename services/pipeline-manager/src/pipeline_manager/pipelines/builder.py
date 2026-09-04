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

# Placeholder caps for a lost source (R-SRC-1): raw video/audio the normalize
# suffix and the platform's own convert()/encoder() can always consume,
# independent of which role/caps the real branch would have used.
_PLACEHOLDER_VIDEO_FORMAT = "I420"
_PLACEHOLDER_AUDIO_CAPS = "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved"


def _selector_name(role: SourceRole) -> str:
    return f"sel_{role.value.replace('-', '_')}"


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
    # True when every required role in `argv` has an in-pipeline fallback
    # branch (A-REV-003) — the consumer may start with a subset of required
    # roles offline instead of refusing outright. False (the default) keeps
    # every existing pipeline kind's original all-required-roles-online gate.
    degraded_start_ok: bool = False
    # Camera roles whose named shmsrc branches are managed inside the
    # session-lifetime record worker instead of fatal gst-launch handling.
    resilient_roles: tuple[SourceRole, ...] = ()


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
    healthy: bool = True,
    fps: int = 30,
) -> None:
    """shmsrc -> (decode if camera) -> normalize -> (scale+queue if apply_scale).

    A full-canvas single tile (apply_scale=False) chains straight from the
    framerate caps into whatever the caller adds next (an encoder) — matching
    live_cam1.sh/live_usb.sh, which have no redundant scale or queue there.

    `fps` (A-REV-014) is the profile's *effective* encode fps, threaded into
    the post-`videorate` normalization caps (and the placeholder's own
    framerate, so a lost source doesn't force an up/down-convert the real
    branch wouldn't have needed) — every existing caller that omits it gets
    the original hardcoded-30 behavior byte-for-byte (every base profile's
    `fps` is 30), so this is additive: no existing argv changes.

    `healthy=False` (R-SRC-1, A-REV-003) swaps the real `shmsrc` branch for a
    `videotestsrc` placeholder fronted by a named `input-selector` — the
    caller decides `healthy` once per build from debounced publisher health,
    so a role already known offline never spawns a doomed `shmsrc` bound to a
    socket nothing is writing to (which fails pipeline preroll outright,
    proven experimentally: `shmsrc` posts a fatal bus ERROR the moment its
    control socket is missing or closes, and `gst-launch-1.0` treats any bus
    ERROR as fatal to the whole process — there is no stock element that
    auto-switches a *running* pipeline on source timeout without an
    app-embedded controller, which is out of scope for this argv-only tier).
    A role that drops out mid-session still ends the child; recovery is the
    existing restart-with-backoff path (B3), which re-`build_record`s with
    the now-offline role routed through this same placeholder branch instead
    of refusing to start.
    """
    if healthy:
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
            )
        else:
            builder.add(platform.shm_video_caps(role), "!")
    else:
        sel = _selector_name(role)
        builder.add(
            "videotestsrc",
            "is-live=true",
            "pattern=black",
            "!",
            f"video/x-raw,format={_PLACEHOLDER_VIDEO_FORMAT},width={target_width},height={target_height},framerate={fps}/1",
            "!",
            f"{sel}.sink_0",
            "input-selector",
            f"name={sel}",
            "!",
            *platform.convert(),
            "!",
        )
    builder.add(
        "queue",
        "max-size-buffers=6",
        "leaky=downstream",
        "!",
        "videorate",
        "drop-only=true",
        "!",
        f"video/x-raw,framerate={fps}/1",
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


def audio_source_tokens(builder: PipelineBuilder, platform: PlatformProfile, *, healthy: bool = True) -> None:
    """The mic-lecturer source stage only — `shmsrc` when healthy, a silent
    `audiotestsrc` placeholder behind a named `input-selector` otherwise
    (R-SRC-1, A-REV-003; same rationale as `source_branch_normalized`).
    Shared by `audio_branch` (record/live, feeds a mux pad) and `meeting`'s
    direct-to-ALSA mic branch — both continue with their own
    `queue ! audioconvert ! audioresample ! ...` after this.
    """
    if healthy:
        socket = ROLE_SOCKETS[SourceRole.MIC_LECTURER]
        builder.add(
            "shmsrc", f"socket-path={socket}", "is-live=true", "do-timestamp=true", "!", platform.audio_caps(), "!"
        )
    else:
        sel = _selector_name(SourceRole.MIC_LECTURER)
        builder.add(
            "audiotestsrc",
            "is-live=true",
            "wave=silence",
            "!",
            _PLACEHOLDER_AUDIO_CAPS,
            "!",
            f"{sel}.sink_0",
            "input-selector",
            f"name={sel}",
            "!",
        )


def audio_branch(
    builder: PipelineBuilder,
    platform: PlatformProfile,
    profile: EncodeProfileLike,
    mux_pad: str,
    *,
    queue_props: Sequence[str] = (),
    healthy: bool = True,
) -> None:
    """`healthy=False` swaps the mic `shmsrc` for a silent `audiotestsrc`
    placeholder (same rationale as `source_branch_normalized`) so a lost mic
    never breaks record/live's shared mux the way a dead-socket `shmsrc`
    would (R-SRC-1)."""
    audio_source_tokens(builder, platform, healthy=healthy)
    builder.add(
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

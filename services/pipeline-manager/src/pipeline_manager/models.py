from __future__ import annotations

import os
import posixpath
from enum import Enum
from pathlib import Path, PurePosixPath

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SourceRole(str, Enum):
    PRESENTATION = "presentation"
    LECTURER_CAM = "lecturer-cam"
    STUDENTS_CAM = "students-cam"
    MIC_LECTURER = "mic-lecturer"
    MIC_ROOM = "mic-room"


# Only these four are bindable in v1; mic-room remains unbound (INV-SR-2).
BINDABLE_SOURCE_ROLES = frozenset(
    {
        SourceRole.PRESENTATION,
        SourceRole.LECTURER_CAM,
        SourceRole.STUDENTS_CAM,
        SourceRole.MIC_LECTURER,
    }
)


class PublisherId(str, Enum):
    USB = "usb"
    RTSP = "rtsp"
    RTSP2 = "rtsp2"
    AUDIO = "audio"


class Channel(str, Enum):
    LOCAL = "local"
    MEETING = "meeting"
    STREAMING = "streaming"


class LayoutPresetId(str, Enum):
    FIFTY_FIFTY = "fifty-fifty"
    CAMS_FIFTY_FIFTY = "cams-fifty-fifty"
    SIDE_BY_SIDE = "side-by-side"
    CAM_1 = "cam-1"
    CAM_2 = "cam-2"
    PC_ONLY = "pc-only"
    SEPARATE_FILES = "separate-files"


class PublisherState(str, Enum):
    ONLINE = "online"
    DEGRADED = "degraded"
    OFFLINE = "offline"
    UNKNOWN = "unknown"


class ConsumerState(str, Enum):
    STARTING = "starting"
    RUNNING = "running"
    DEGRADED = "degraded"
    STOPPING = "stopping"
    EXITED = "exited"
    FAILED = "failed"


class ConsumerKind(str, Enum):
    RECORD = "record"
    LIVE = "live"
    MEETING = "meeting"
    PROJECTOR = "projector"
    THUMBNAILS = "thumbnails"
    SNAPSHOT = "snapshot"


class CaptureCardState(str, Enum):
    PRESENT = "present"
    ABSENT = "absent"
    RECOVERING = "recovering"
    FAILED = "failed"


class LedMode(str, Enum):
    ON = "on"
    OFF = "off"
    BLINK = "blink"


class PublisherBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    publisher_id: PublisherId
    role_id: SourceRole

    @model_validator(mode="after")
    def role_must_be_bindable(self) -> "PublisherBinding":
        if self.role_id not in BINDABLE_SOURCE_ROLES:
            raise ValueError(f"{self.role_id.value} is not bindable in v1")
        return self


class Ratio(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ratio_a: int | None = Field(default=None, gt=0)
    ratio_b: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def both_or_neither(self) -> "Ratio":
        if (self.ratio_a is None) != (self.ratio_b is None):
            raise ValueError("ratioA and ratioB must both be present or both be absent")
        return self


class Problem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    title: str
    status: int
    meta: dict[str, str] | None = None


class CommandAccepted(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: str


class InternalEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int = Field(ge=1)
    kind: str
    occurred_at_ms: int = Field(ge=0)


class AudioControlRequest(BaseModel):
    """mic-lecturer only in v1 (LP-9) — the role is the route path, not a body field."""

    model_config = ConfigDict(extra="forbid")

    gain: int = Field(ge=0, le=100)
    muted: bool


class AudioControlResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_id: SourceRole
    applied_gain: int | None = None
    applied_muted: bool | None = None
    applied_state: Literal["applied", "failed"]
    last_error: str | None = None


class AudioLevelSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_id: SourceRole
    rms: float = Field(ge=0.0, le=1.0)


def resolve_output_path(path: Path, recordings_root: Path) -> Path:
    """Reject relative paths, the root itself, and paths outside recordings_root,
    including via a symlink (B-02: opaque, given paths only).

    Lexical normalization alone (`posixpath.normpath`) cannot see a symlink
    that hops out of the root partway through — e.g. `root/link -> /etc` with
    `outputPath=root/link/passwd` normalizes to a string that still looks
    like it's under root. `os.path.realpath` walks the real filesystem and
    follows any symlink that exists, so the escape shows up in the resolved
    path even though the caller-given path is returned unchanged on success.
    Nonexistent components (the common case — the file doesn't exist yet)
    are left as-is, matching `Path.resolve(strict=False)` semantics, so this
    still behaves the same on a Windows dev host as on the POSIX target board
    for paths that don't yet exist on disk.
    """
    posix_path = PurePosixPath(posixpath.normpath(path.as_posix()))
    if not posix_path.is_absolute():
        raise ValueError("outputPath must be an absolute path")
    posix_root = PurePosixPath(posixpath.normpath(recordings_root.as_posix()))

    real_root = PurePosixPath(os.path.realpath(posix_root))
    real_path = PurePosixPath(os.path.realpath(posix_path))
    if real_root not in real_path.parents:
        raise ValueError("outputPath must be beneath the configured recordings root")
    return Path(posix_path)

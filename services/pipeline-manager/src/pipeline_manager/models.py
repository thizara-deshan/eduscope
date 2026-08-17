from __future__ import annotations

import posixpath
from enum import Enum
from pathlib import Path, PurePosixPath

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


def resolve_output_path(path: Path, recordings_root: Path) -> Path:
    """Reject relative paths and paths outside recordings_root (B-02: opaque, given paths only).

    The manager only ever runs on POSIX (RK3588); paths are normalized with
    PurePosixPath regardless of the authoring host so this behaves the same on a
    Windows dev host as on the target board.
    """
    posix_path = PurePosixPath(posixpath.normpath(path.as_posix()))
    if not posix_path.is_absolute():
        raise ValueError("outputPath must be an absolute path")
    posix_root = PurePosixPath(posixpath.normpath(recordings_root.as_posix()))
    if posix_path != posix_root and posix_root not in posix_path.parents:
        raise ValueError("outputPath must be beneath the configured recordings root")
    return Path(posix_path)

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from ..models import SourceRole
from .builder import ROLE_SOCKETS, PipelineBuilder, PipelineSpec
from .platforms.base import PlatformProfile


class InvalidSnapshotInterval(ValueError):
    pass


class SnapshotNotReady(ValueError):
    pass


@dataclass(frozen=True)
class SnapshotRequest:
    interval_sec: int
    output_path: str


def temp_path_for(output_path: str) -> str:
    return f"{output_path}.tmp"


def build_snapshot(req: SnapshotRequest, platform: PlatformProfile) -> PipelineSpec:
    if req.interval_sec < 1:
        raise InvalidSnapshotInterval("intervalSec must be >= 1")

    tmp_path = temp_path_for(req.output_path)
    builder = PipelineBuilder()
    builder.add(
        "shmsrc",
        f"socket-path={ROLE_SOCKETS[SourceRole.PRESENTATION]}",
        "is-live=true",
        "do-timestamp=true",
        "!",
        platform.shm_video_caps(SourceRole.PRESENTATION),
        "!",
        "videorate",
        "!",
        f"video/x-raw,framerate=1/{req.interval_sec}",
        "!",
        "pngenc",
        "snapshot=false",
        "!",
        "filesink",
        f"location={tmp_path}",
    )

    return PipelineSpec(
        argv=builder.build(),
        required_roles=(SourceRole.PRESENTATION,),
        encode_slots=0,
        outputs=(req.output_path,),
    )


def publish_snapshot(tmp_path: Path, final_path: Path) -> None:
    """Confirm nonzero size, fsync, then atomically publish — no consumer ever
    observes a partial final PNG (a crash mid-write leaves only the .tmp sibling).
    """
    size = tmp_path.stat().st_size
    if size <= 0:
        raise SnapshotNotReady(f"{tmp_path} is empty")
    with tmp_path.open("rb+") as handle:
        os.fsync(handle.fileno())
    os.replace(tmp_path, final_path)

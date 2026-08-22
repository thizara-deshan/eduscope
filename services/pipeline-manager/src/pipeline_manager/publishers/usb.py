from __future__ import annotations

from ..models import PublisherId
from ..pipelines.builder import PipelineBuilder, PipelineSpec
from .base import PUBLISHER_RING_BYTES, PUBLISHER_ROLES, PUBLISHER_SOCKETS


def build_usb_publisher(device: str) -> PipelineSpec:
    """Captures `pc` (V4L2 HDMI dongle) exactly once; raw NV12 1080p60 on shm.
    Device-lifetime — no decode happens here (decode, if any, is per-consumer).

    Argv matches the proven bench oracle (`scripts/bash/pub_usb.sh`,
    A-REV-018): `io-mode=mmap` avoids an extra userspace copy per frame,
    `do-timestamp=true` gives downstream `videorate`/mux elements a real
    clock instead of drifting on driver timestamps, and the bounded
    `leaky=downstream` queue sheds the oldest frame under backpressure
    rather than stalling the live capture. `-m` (bus messages) is the one
    intentional addition beyond the oracle: `HealthConfirmer` needs it to
    observe PLAYING on stdout (the oracle script was a manual bench aid,
    never wired to a confirm-health path).
    """
    socket = PUBLISHER_SOCKETS[PublisherId.USB]
    ring = PUBLISHER_RING_BYTES[PublisherId.USB]
    builder = PipelineBuilder()
    builder.add(
        "v4l2src",
        f"device={device}",
        "io-mode=mmap",
        "do-timestamp=true",
        "!",
        "video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1",
        "!",
        "queue",
        "leaky=downstream",
        "max-size-buffers=4",
        "!",
        "shmsink",
        f"socket-path={socket}",
        f"shm-size={ring}",
        "wait-for-connection=false",
        "sync=false",
    )
    return PipelineSpec(
        argv=builder.build(),
        required_roles=(PUBLISHER_ROLES[PublisherId.USB],),
        encode_slots=0,
        outputs=(),
    )

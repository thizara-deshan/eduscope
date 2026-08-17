from __future__ import annotations

from ..models import PublisherId
from ..pipelines.builder import PipelineBuilder, PipelineSpec
from .base import PUBLISHER_RING_BYTES, PUBLISHER_ROLES, PUBLISHER_SOCKETS


def build_usb_publisher(device: str) -> PipelineSpec:
    """Captures `pc` (V4L2 HDMI dongle) exactly once; raw NV12 1080p60 on shm.
    Device-lifetime — no decode happens here (decode, if any, is per-consumer).
    """
    socket = PUBLISHER_SOCKETS[PublisherId.USB]
    ring = PUBLISHER_RING_BYTES[PublisherId.USB]
    builder = PipelineBuilder()
    builder.add(
        "v4l2src",
        f"device={device}",
        "!",
        "video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1",
        "!",
        "shmsink",
        f"socket-path={socket}",
        f"shm-size={ring}",
        "wait-for-connection=false",
    )
    return PipelineSpec(
        argv=builder.build(),
        required_roles=(PUBLISHER_ROLES[PublisherId.USB],),
        encode_slots=0,
        outputs=(),
    )

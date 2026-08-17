from __future__ import annotations

from ..models import PublisherId
from ..pipelines.builder import PipelineBuilder, PipelineSpec
from .base import PUBLISHER_RING_BYTES, PUBLISHER_ROLES, PUBLISHER_SOCKETS


def build_audio_publisher(device: str) -> PipelineSpec:
    """Captures `mic-lecture` (ALSA) exactly once; S16LE 48 kHz stereo on shm."""
    socket = PUBLISHER_SOCKETS[PublisherId.AUDIO]
    ring = PUBLISHER_RING_BYTES[PublisherId.AUDIO]
    builder = PipelineBuilder()
    builder.add(
        "alsasrc",
        f"device={device}",
        "!",
        "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved",
        "!",
        "shmsink",
        f"socket-path={socket}",
        f"shm-size={ring}",
        "wait-for-connection=false",
    )
    return PipelineSpec(
        argv=builder.build(),
        required_roles=(PUBLISHER_ROLES[PublisherId.AUDIO],),
        encode_slots=0,
        outputs=(),
    )

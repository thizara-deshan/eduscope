from __future__ import annotations

from ..models import PublisherId
from ..pipelines.builder import PipelineBuilder, PipelineSpec
from .base import PUBLISHER_RING_BYTES, PUBLISHER_ROLES, PUBLISHER_SOCKETS


def build_audio_publisher(device: str) -> PipelineSpec:
    """Captures `mic-lecture` (ALSA) exactly once; S16LE 48 kHz stereo on shm.

    Argv matches the proven bench oracle (`scripts/bash/pub_audio.sh`,
    A-REV-018): `do-timestamp=true` and the time-bounded queue (200ms, not a
    buffer count — audio buffers vary in duration) match the oracle's
    backpressure policy. `-m` is the same intentional health-confirm
    addition documented in `usb.py`.
    """
    socket = PUBLISHER_SOCKETS[PublisherId.AUDIO]
    ring = PUBLISHER_RING_BYTES[PublisherId.AUDIO]
    builder = PipelineBuilder()
    builder.add(
        "alsasrc",
        f"device={device}",
        "do-timestamp=true",
        "!",
        "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved",
        "!",
        "queue",
        "max-size-time=200000000",
        "!",
        "shmsink",
        f"socket-path={socket}",
        f"shm-size={ring}",
        "wait-for-connection=false",
        "sync=false",
    )
    return PipelineSpec(
        argv=builder.build(),
        required_roles=(PUBLISHER_ROLES[PublisherId.AUDIO],),
        encode_slots=0,
        outputs=(),
    )

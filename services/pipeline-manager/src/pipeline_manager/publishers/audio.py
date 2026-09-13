from __future__ import annotations

from ..models import PublisherId, SourceRole
from ..pipelines.builder import PipelineBuilder, PipelineSpec
from .base import PUBLISHER_RING_BYTES, PUBLISHER_SOCKETS


def build_audio_publisher(
    lecturer_device: str, room_device: str, *, room_volume: float = 1.0
) -> PipelineSpec:
    """Mix both USB microphones into the frozen S16LE 48 kHz stereo shm.

    The USB devices have independent clocks. ``provide-clock=false`` keeps
    either capture clock from becoming pipeline master, while the mixer's
    200 ms latency and branch queues absorb normal drift. The named, post-
    fader level elements provide per-role telemetry without changing the
    one-socket downstream contract (A-REV-018).
    """
    socket = PUBLISHER_SOCKETS[PublisherId.AUDIO]
    ring = PUBLISHER_RING_BYTES[PublisherId.AUDIO]
    builder = PipelineBuilder()
    caps = "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved"
    for device, suffix, volume in (
        (lecturer_device, "mic_lecturer", 1.0),
        (room_device, "mic_room", room_volume),
    ):
        builder.add(
            "alsasrc", f"device={device}", "do-timestamp=true", "provide-clock=false", "!",
            "audioconvert", "!", "audioresample", "!", caps, "!",
            "volume", f"name=vol_{suffix}", f"volume={volume}", "!",
            "level", f"name=lvl_{suffix}", "interval=100000000", "post-messages=true", "!",
            "queue", "max-size-time=200000000", "!", "mix.",
        )
    builder.add(
        "audiomixer", "name=mix", "latency=200000000", "!",
        "audioconvert", "!", "audioresample", "!", caps, "!",
        "queue", "max-size-time=200000000", "!",
        "shmsink",
        f"socket-path={socket}",
        f"shm-size={ring}",
        "wait-for-connection=false",
        "sync=false",
    )
    return PipelineSpec(
        argv=builder.build(),
        required_roles=(SourceRole.MIC_LECTURER, SourceRole.MIC_ROOM),
        encode_slots=0,
        outputs=(),
    )

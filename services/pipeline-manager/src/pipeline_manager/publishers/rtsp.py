from __future__ import annotations

from dataclasses import dataclass

from ..models import PublisherId
from ..pipelines.builder import PipelineBuilder, PipelineSpec
from .base import PUBLISHER_RING_BYTES, PUBLISHER_ROLES, PUBLISHER_SOCKETS

REDACTED = "<redacted>"


@dataclass(frozen=True)
class RtspCredentials:
    username: str
    password: str


def build_rtsp_publisher(
    publisher_id: PublisherId, address: str, credentials: RtspCredentials | None = None
) -> PipelineSpec:
    """Depayload + parse only — the camera is captured once, never decoded
    (decode happens only inside consumers that need pixels). Credentials
    arrive separately from the address and are inserted only as discrete
    GStreamer property tokens, never interpolated into the URL string.

    Argv matches the proven bench oracle (`scripts/bash/pub_rtsp.sh`,
    A-REV-018): `config-interval=-1` makes `h264parse` re-insert SPS/PPS
    before every IDR frame (a mid-stream shm consumer attach otherwise
    starts on a non-decodable frame), the caps carry no fixed
    width/height/framerate (negotiated from the actual RTP stream, not
    assumed — a consumer re-asserts its own caps on the shm side via
    `platform.shm_video_caps`), and the bounded `leaky=downstream` queue
    matches the oracle's shed-oldest-first backpressure policy. `-m` is the
    same intentional health-confirm addition documented in `usb.py`.
    """
    if publisher_id not in (PublisherId.RTSP, PublisherId.RTSP2):
        raise ValueError(f"{publisher_id.value} is not an RTSP publisher")

    socket = PUBLISHER_SOCKETS[publisher_id]
    ring = PUBLISHER_RING_BYTES[publisher_id]
    builder = PipelineBuilder()
    builder.add("rtspsrc", f"location={address}", "latency=100", "protocols=tcp")
    if credentials is not None:
        builder.add(f"user-id={credentials.username}", f"user-pw={credentials.password}")
    builder.add(
        "!",
        "rtph264depay",
        "!",
        "h264parse",
        "config-interval=-1",
        "!",
        "video/x-h264,stream-format=byte-stream,alignment=au",
        "!",
        "queue",
        "leaky=downstream",
        "max-size-buffers=200",
        "!",
        "shmsink",
        f"socket-path={socket}",
        f"shm-size={ring}",
        "wait-for-connection=false",
        "sync=false",
    )
    return PipelineSpec(
        argv=builder.build(),
        required_roles=(PUBLISHER_ROLES[publisher_id],),
        encode_slots=0,
        outputs=(),
    )


def redact_rtsp_argv(argv: tuple[str, ...]) -> tuple[str, ...]:
    """Status/errors must never surface credentials — used before any argv
    reaches logs, `/status`, or an emitted event."""
    redacted: list[str] = []
    for token in argv:
        if token.startswith("user-id=") or token.startswith("user-pw="):
            key = token.split("=", 1)[0]
            redacted.append(f"{key}={REDACTED}")
        else:
            redacted.append(token)
    return tuple(redacted)

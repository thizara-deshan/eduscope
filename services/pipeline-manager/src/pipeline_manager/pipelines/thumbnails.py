from __future__ import annotations

import json
import sys
from typing import Literal, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..models import BINDABLE_SOURCE_ROLES, SourceRole

# Frame budget (bench default, B-T7) — the encode profile lives in profiles.py;
# these are the worker's fixed capture limits, not knobs.
THUMBNAIL_WIDTH = 480
THUMBNAIL_HEIGHT = 270
THUMBNAIL_FPS = 15

# The provisional third ledger slot only (A-07); never a guaranteed record/live slot.
ENCODE_RESERVATION_KIND = "thumbnail"

THUMBNAIL_ALLOWED_ROLES = BINDABLE_SOURCE_ROLES  # excludes mic-room (INV-SR-2)


class ControlMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ThumbnailOffer(ControlMessage):
    type: Literal["offer"]
    negotiation_id: str = Field(min_length=1)
    role_id: SourceRole
    sdp: str = Field(min_length=1, max_length=131_072)

    @field_validator("role_id")
    @classmethod
    def role_must_be_previewable(cls, value: SourceRole) -> SourceRole:
        if value not in THUMBNAIL_ALLOWED_ROLES:
            raise ValueError(f"{value.value} is not previewable")
        return value


class ThumbnailIce(ControlMessage):
    type: Literal["ice"]
    negotiation_id: str = Field(min_length=1)
    candidate: str = Field(max_length=8_192)
    sdp_mid: str | None = Field(default=None, max_length=128)
    sdp_mline_index: int | None = Field(default=None, ge=0, le=64)


class ThumbnailClose(ControlMessage):
    type: Literal["close"]
    negotiation_id: str = Field(min_length=1)


class ThumbnailAnswer(ControlMessage):
    type: Literal["answer"]
    negotiation_id: str
    sdp: str = Field(min_length=1, max_length=131_072)


class ThumbnailIceOut(ControlMessage):
    type: Literal["ice"]
    negotiation_id: str
    candidate: str
    sdp_mid: str | None = None
    sdp_mline_index: int | None = None


class ThumbnailWorkerError(ControlMessage):
    type: Literal["error"]
    negotiation_id: str
    code: str
    message: str


class ThumbnailPlaying(ControlMessage):
    type: Literal["playing"]
    negotiation_id: str


InboundMessage = Union[ThumbnailOffer, ThumbnailIce, ThumbnailClose]

_INBOUND_TYPES: dict[str, type[InboundMessage]] = {
    "offer": ThumbnailOffer,
    "ice": ThumbnailIce,
    "close": ThumbnailClose,
}


class InvalidControlMessage(ValueError):
    pass


def parse_control_line(line: str) -> InboundMessage:
    """Every control line validates before it can reach the worker's GI graph."""
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as exc:
        raise InvalidControlMessage(f"invalid JSON: {exc}") from exc

    if not isinstance(raw, dict):
        raise InvalidControlMessage("control message must be a JSON object")

    model = _INBOUND_TYPES.get(raw.get("type"))
    if model is None:
        raise InvalidControlMessage(f"unknown control message type: {raw.get('type')!r}")

    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        raise InvalidControlMessage(str(exc)) from exc


def worker_argv(python_executable: str = sys.executable) -> tuple[str, ...]:
    """One worker subprocess per negotiation — the parent supervises it (A-07);
    it never hosts an in-process media pipeline (rule 1).
    """
    return (python_executable, "-m", "pipeline_manager.pipelines.thumbnails", "--worker")


def _run_gst_worker() -> None:  # pragma: no cover - requires PyGObject + Gst on the board
    """The crash-isolated worker entry point. No `gi` import anywhere above this
    line — unit tests import this module freely without GStreamer installed.
    """
    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import Gst  # noqa: F401

    raise NotImplementedError("board-only: negotiates SDP/ICE and runs the webrtcbin graph")


if __name__ == "__main__":  # pragma: no cover
    _run_gst_worker()

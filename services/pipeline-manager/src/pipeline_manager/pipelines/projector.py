from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

from ..models import SourceRole
from .builder import DisplayPlacement, PipelineBuilder, PipelineSpec, source_branch_normalized
from .platforms.base import DisplayOut, PlatformProfile


class ProjectorMode(str, Enum):
    PASSTHROUGH = "passthrough"
    QUESTION = "question"


class QuestionOverlay(BaseModel):
    """extra='forbid' makes leaderboard/answer/participant fields structurally
    impossible (A-22, Q-31) — this is a slide overlay, not a quiz result view."""

    model_config = ConfigDict(extra="forbid")

    question_text: str = Field(min_length=1, max_length=500)
    options: list[str] = Field(min_length=1, max_length=10)
    join_qr_png_path: str = Field(min_length=1)


class ProjectorControlMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: ProjectorMode
    payload: QuestionOverlay | None = None


def encode_control_message(mode: ProjectorMode, payload: QuestionOverlay | None = None) -> bytes:
    """Length-delimited JSON control frame written to the worker's stdin.

    Question data travels as a validated message, never interpolated into argv.
    """
    message = ProjectorControlMessage(mode=mode, payload=payload)
    body = message.model_dump_json().encode("utf-8")
    return f"{len(body)}\n".encode("ascii") + body


def build_projector(platform: PlatformProfile) -> PipelineSpec:
    """One long-running worker with an input-selector; mode switches
    (POST /consumers/projector {mode}) are control messages, never a restart —
    passthrough and question modes always share this same argv/child.
    """
    builder = PipelineBuilder()
    source_branch_normalized(
        builder, platform, SourceRole.PRESENTATION,
        target_width=1920, target_height=1080, apply_scale=False, sink_pad=None,
    )
    builder.add("input-selector", "name=sel", "!", *platform.display_sink(DisplayOut.HDMI_1))

    placement = DisplayPlacement(output=DisplayOut.HDMI_1, x=0, y=0, width=1920, height=1080, fullscreen=True)
    return PipelineSpec(
        argv=builder.build(),
        required_roles=(SourceRole.PRESENTATION,),
        encode_slots=0,
        outputs=(),
        placement=placement,
    )

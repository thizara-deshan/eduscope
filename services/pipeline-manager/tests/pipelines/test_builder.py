from __future__ import annotations

import pytest

from pipeline_manager.models import SourceRole
from pipeline_manager.pipelines.builder import (
    GST_LAUNCH_PREFIX,
    InvalidToken,
    PipelineBuilder,
    source_branch_normalized,
)
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile


def test_starts_with_gst_launch_prefix() -> None:
    builder = PipelineBuilder()
    assert builder.build()[:3] == GST_LAUNCH_PREFIX


def test_add_appends_tokens_in_order() -> None:
    builder = PipelineBuilder().add("shmsrc", "socket-path=/tmp/usb.sock")
    assert builder.build()[3:] == ("shmsrc", "socket-path=/tmp/usb.sock")


def test_branch_is_equivalent_to_add() -> None:
    builder = PipelineBuilder().branch(["queue", "!"])
    assert builder.build()[3:] == ("queue", "!")


def test_build_returns_tuple_not_a_shell_string() -> None:
    builder = PipelineBuilder().add("shmsrc", "!", "queue")
    result = builder.build()
    assert isinstance(result, tuple)
    assert all(isinstance(token, str) for token in result)


@pytest.mark.parametrize("bad_token", ["has\x00nul", "has\nnewline"])
def test_rejects_tokens_with_nul_or_newline(bad_token: str) -> None:
    with pytest.raises(InvalidToken):
        PipelineBuilder().add(bad_token)


def test_add_returns_self_for_chaining() -> None:
    builder = PipelineBuilder()
    assert builder.add("a") is builder


class TestEffectiveFps:
    """A-REV-014: the profile's effective fps must reach the actual
    `videorate` normalization caps, not just live on `EncodeProfile.fps`
    unused. Default (omitted) `fps` stays 30 — byte-identical to every
    existing golden fixture (the additive-change guarantee)."""

    def test_default_fps_is_thirty(self) -> None:
        builder = PipelineBuilder()
        source_branch_normalized(
            builder, RK3588Profile(), SourceRole.PRESENTATION,
            target_width=1920, target_height=1080, apply_scale=False, sink_pad=None,
        )
        assert "video/x-raw,framerate=30/1" in builder.build()

    def test_custom_fps_reaches_normalization_caps(self) -> None:
        builder = PipelineBuilder()
        source_branch_normalized(
            builder, RK3588Profile(), SourceRole.PRESENTATION,
            target_width=1920, target_height=1080, apply_scale=False, sink_pad=None,
            fps=25,
        )
        argv = builder.build()
        assert "video/x-raw,framerate=25/1" in argv
        assert "video/x-raw,framerate=30/1" not in argv

    def test_custom_fps_reaches_placeholder_branch(self) -> None:
        builder = PipelineBuilder()
        source_branch_normalized(
            builder, RK3588Profile(), SourceRole.LECTURER_CAM,
            target_width=960, target_height=540, apply_scale=True, sink_pad="comp.sink_0",
            healthy=False, fps=15,
        )
        argv = builder.build()
        assert f"video/x-raw,format=I420,width=960,height=540,framerate=15/1" in argv
        assert "video/x-raw,framerate=15/1" in argv

from __future__ import annotations

import pytest

from pipeline_manager.pipelines.builder import GST_LAUNCH_PREFIX, InvalidToken, PipelineBuilder


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

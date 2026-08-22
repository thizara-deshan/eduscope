from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

from pipeline_manager.audio.control import (
    ExecResult,
    InvalidDeviceName,
    InvalidGain,
    UnsupportedAudioRole,
    apply_audio_control,
    real_amixer_exec,
)
from pipeline_manager.models import SourceRole

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "events" / "audio-control.json"
CARD = "1"
CONTROL = "Mic"


class FakeExec:
    def __init__(self, results: list[ExecResult]) -> None:
        self._results = list(results)
        self.calls: list[list[str]] = []

    async def __call__(self, argv):
        self.calls.append(list(argv))
        return self._results.pop(0)


def _sget(percent: int, on: bool) -> str:
    state = "on" if on else "off"
    return f"Simple mixer control '{CONTROL}',0\n  Mono: Capture {percent} [{percent}%] [{state}]\n"


@pytest.mark.asyncio
async def test_only_mic_lecturer_is_accepted() -> None:
    exec_fn = FakeExec([])
    with pytest.raises(UnsupportedAudioRole):
        await apply_audio_control(
            SourceRole.MIC_ROOM, 50, False, card=CARD, control=CONTROL, exec_file=exec_fn
        )
    assert exec_fn.calls == []


@pytest.mark.parametrize("gain", [-1, 101])
@pytest.mark.asyncio
async def test_gain_out_of_range_rejected(gain: int) -> None:
    exec_fn = FakeExec([])
    with pytest.raises(InvalidGain):
        await apply_audio_control(
            SourceRole.MIC_LECTURER, gain, False, card=CARD, control=CONTROL, exec_file=exec_fn
        )


@pytest.mark.asyncio
async def test_gain_maps_through_configured_mixer_min_max() -> None:
    exec_fn = FakeExec([ExecResult(0), ExecResult(0, stdout=_sget(50, True))])
    await apply_audio_control(
        SourceRole.MIC_LECTURER, 50, False, card=CARD, control=CONTROL,
        mixer_min=0, mixer_max=80, exec_file=exec_fn,
    )
    # 50% of the way from 0..80 == 40
    assert "40%" in exec_fn.calls[0]


@pytest.mark.asyncio
async def test_argv_uses_amixer_card_sset_no_shell() -> None:
    exec_fn = FakeExec([ExecResult(0), ExecResult(0, stdout=_sget(75, True))])
    await apply_audio_control(
        SourceRole.MIC_LECTURER, 75, False, card=CARD, control=CONTROL, exec_file=exec_fn
    )
    argv = exec_fn.calls[0]
    assert argv[0] == "amixer"
    assert argv[1:4] == ["--card", CARD, "sset"]
    assert isinstance(argv, list)


@pytest.mark.asyncio
async def test_applied_state_comes_from_sget_not_request_echo() -> None:
    # Request asks for 90/unmuted, but the mixer actually reports 42/muted.
    exec_fn = FakeExec([ExecResult(0), ExecResult(0, stdout=_sget(42, False))])
    result = await apply_audio_control(
        SourceRole.MIC_LECTURER, 90, False, card=CARD, control=CONTROL, exec_file=exec_fn
    )
    assert result.applied_gain == 42
    assert result.applied_muted is True
    assert result.applied_state == "applied"


@pytest.mark.asyncio
async def test_sset_failure_returns_failed_state_with_last_error() -> None:
    exec_fn = FakeExec([ExecResult(1, stderr="no such control")])
    result = await apply_audio_control(
        SourceRole.MIC_LECTURER, 50, False, card=CARD, control=CONTROL, exec_file=exec_fn
    )
    assert result.applied_state == "failed"
    assert result.last_error is not None


@pytest.mark.asyncio
async def test_sget_failure_returns_failed_state() -> None:
    exec_fn = FakeExec([ExecResult(0), ExecResult(1)])
    result = await apply_audio_control(
        SourceRole.MIC_LECTURER, 50, False, card=CARD, control=CONTROL, exec_file=exec_fn
    )
    assert result.applied_state == "failed"


@pytest.mark.asyncio
async def test_unparsable_readback_returns_failed_state() -> None:
    exec_fn = FakeExec([ExecResult(0), ExecResult(0, stdout="garbage, no percent or switch here")])
    result = await apply_audio_control(
        SourceRole.MIC_LECTURER, 50, False, card=CARD, control=CONTROL, exec_file=exec_fn
    )
    assert result.applied_state == "failed"


@pytest.mark.asyncio
async def test_mute_and_gain_affect_the_same_control_path() -> None:
    exec_fn = FakeExec([ExecResult(0), ExecResult(0, stdout=_sget(0, False))])
    await apply_audio_control(
        SourceRole.MIC_LECTURER, 60, True, card=CARD, control=CONTROL, exec_file=exec_fn
    )
    set_argv = exec_fn.calls[0]
    assert any(token.endswith("%") for token in set_argv)  # gain
    assert "off" in set_argv  # mute, same sset call


@pytest.mark.parametrize("bad_name", ["", "a" * 65, "bad;name", "card$(whoami)"])
@pytest.mark.asyncio
async def test_invalid_card_or_control_name_rejected(bad_name: str) -> None:
    exec_fn = FakeExec([])
    with pytest.raises(InvalidDeviceName):
        await apply_audio_control(
            SourceRole.MIC_LECTURER, 50, False, card=bad_name, control=CONTROL, exec_file=exec_fn
        )
    assert exec_fn.calls == []


@pytest.mark.asyncio
async def test_log_receives_full_context_public_error_stays_generic() -> None:
    logged = []
    exec_fn = FakeExec([ExecResult(1, stderr="ALSA card 7 control Mic not found")])
    result = await apply_audio_control(
        SourceRole.MIC_LECTURER, 50, False, card="7", control="Mic", exec_file=exec_fn, log=logged.append
    )
    assert "7" not in (result.last_error or "")
    assert any(entry.get("card") == "7" for entry in logged)


def test_fixture_shapes_match_audio_control_wire_fields() -> None:
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for row in rows:
        assert set(row.keys()) == {"roleId", "appliedGain", "appliedMuted", "appliedState", "lastError"}
        assert row["appliedState"] in ("applied", "failed")


# ── real_amixer_exec (A-REV-012, POSIX-only real subprocess) ───────────────


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="verified on target")
@pytest.mark.skipif(shutil.which("echo") is None, reason="echo not on PATH on this host")
async def test_real_amixer_exec_captures_stdout_and_zero_returncode() -> None:
    """A harmless real child stands in for `amixer` — proves the adapter is
    argv-only (no shell) and correctly captures stdout/returncode."""
    result = await real_amixer_exec([shutil.which("echo"), "hello"])
    assert result.returncode == 0
    assert result.stdout.strip() == "hello"


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="verified on target")
@pytest.mark.skipif(shutil.which("false") is None, reason="false not on PATH on this host")
async def test_real_amixer_exec_captures_nonzero_returncode() -> None:
    result = await real_amixer_exec([shutil.which("false")])
    assert result.returncode != 0


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="verified on target")
async def test_real_amixer_exec_never_uses_a_shell(tmp_path: Path) -> None:
    """A shell metacharacter in an argv token must be passed through
    literally to the child as one argument, never interpreted by a shell —
    proves `shell=False` semantics (a real shell would split `;` into a
    second command and create the marker file)."""
    echo = shutil.which("echo")
    if echo is None:
        pytest.skip("echo not on PATH on this host")
    marker = tmp_path / "pwned"
    result = await real_amixer_exec([echo, f"hi; touch {marker}"])
    assert result.stdout.strip() == f"hi; touch {marker}"
    assert not marker.exists()

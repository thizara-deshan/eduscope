"""Wrapper tests for record-eos.sh.

A full 5-phase successful run needs a stateful fake pipeline-manager
(publisher restarts, consumer growth, EOS transitions, A/V offsets) that is
impractical to build without a real board; A-15's board procedure
(tests/bench/README.md) is the actual gate for that end-to-end proof. This
suite instead verifies the wrapper's own mechanics: prerequisite checks,
argument parsing, one real failure path (warm-attach confirm timeout), and
that the token is never printed.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from .conftest import TOKEN, _find_bash, run_script, write_sequence


def test_script_exists_and_is_valid_bash() -> None:
    script = Path(__file__).resolve().parents[2] / "scripts" / "bench" / "record-eos.sh"
    assert script.exists()
    result = subprocess.run([_find_bash(), "-n", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_missing_output_dir_flag_fails(state_dir: Path, tmp_path: Path) -> None:
    result = run_script("record-eos.sh", ["--base-url", "http://fake"], state_dir)
    assert result.returncode != 0
    assert "--output-dir is required" in result.stdout


def test_unknown_argument_fails(state_dir: Path, tmp_path: Path) -> None:
    result = run_script(
        "record-eos.sh",
        ["--base-url", "http://fake", "--output-dir", str(tmp_path), "--bogus"],
        state_dir,
    )
    assert result.returncode != 0
    assert "unknown argument" in result.stdout


def test_missing_required_binary_fails_fast(state_dir: Path, tmp_path: Path) -> None:
    result = run_script(
        "record-eos.sh",
        ["--base-url", "http://fake", "--output-dir", str(tmp_path)],
        state_dir,
        env_overrides={"JQ": "/nonexistent/jq"},
    )
    assert result.returncode != 0
    assert "FAIL A15-REC jq is required" in result.stdout


def test_token_never_appears_in_output(state_dir: Path, tmp_path: Path) -> None:
    result = run_script(
        "record-eos.sh", ["--base-url", "http://fake", "--output-dir", str(tmp_path)], state_dir
    )
    assert TOKEN not in result.stdout
    assert TOKEN not in result.stderr


def test_warm_attach_confirm_timeout_fails(state_dir: Path, tmp_path: Path) -> None:
    """No consumer ever reaches `running` in the fake sequence — warm-attach
    must fail cleanly rather than hang or silently pass."""
    write_sequence(
        state_dir,
        [{"publishers": {}, "consumers": [{"id": "record:1", "state": "starting", "pgid": 1}]}],
    )
    state_dir.joinpath("next_record_id").write_text("record:1", encoding="utf-8")
    result = run_script(
        "record-eos.sh",
        ["--base-url", "http://fake", "--output-dir", str(tmp_path)],
        state_dir,
        timeout=20,
    )
    assert result.returncode != 0
    assert "FAIL A15-REC warm-attach confirm" in result.stdout


def test_non_positive_duration_check_rejects_zero() -> None:
    """`probe_positive_duration`'s exact awk positivity test, exercised
    directly (a fake ffprobe genuinely reports 0 for a fixture with no
    real media, and this must be treated as non-positive)."""
    result = subprocess.run(
        [_find_bash(), "-c", "awk -v d=0 'BEGIN { exit !(d > 0) }'"],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0  # 0 is not a positive duration


def test_non_positive_duration_check_accepts_positive() -> None:
    result = subprocess.run(
        [_find_bash(), "-c", "awk -v d=3.5 'BEGIN { exit !(d > 0) }'"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0

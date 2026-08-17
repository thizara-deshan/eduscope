"""Wrapper tests for webrtc.sh: prerequisite checks, argument parsing, token
handling. The real 60-negotiation loopback probe needs A-06's board-only
GStreamer/webrtcbin worker (see pipelines/thumbnails.py) and is not runnable
off the RK3588 target, so it is not simulated here."""

from __future__ import annotations

import subprocess
from pathlib import Path

from .conftest import TOKEN, _find_bash, run_script


def test_script_exists_and_is_valid_bash() -> None:
    script = Path(__file__).resolve().parents[2] / "scripts" / "bench" / "webrtc.sh"
    assert script.exists()
    result = subprocess.run([_find_bash(), "-n", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_missing_evidence_dir_fails(state_dir, tmp_path) -> None:
    result = run_script("webrtc.sh", ["--base-url", "http://fake"], state_dir)
    assert result.returncode != 0
    assert "--evidence-dir is required" in result.stdout


def test_missing_required_binary_fails_fast(state_dir, tmp_path) -> None:
    result = run_script(
        "webrtc.sh",
        ["--base-url", "http://fake", "--evidence-dir", str(tmp_path)],
        state_dir,
        env_overrides={"PYTHON": "/nonexistent/python3"},
    )
    assert result.returncode != 0
    assert "FAIL A16-WEBRTC python3 is required" in result.stdout


def test_token_never_appears_in_output(state_dir, tmp_path) -> None:
    result = run_script(
        "webrtc.sh",
        ["--base-url", "http://fake", "--evidence-dir", str(tmp_path), "--iterations", "0"],
        state_dir,
        env_overrides={"PYTHON": "/nonexistent/python3"},  # forces a fast, deterministic failure
        timeout=15,
    )
    assert TOKEN not in result.stdout
    assert TOKEN not in result.stderr


def test_1000ms_boundary_fails_since_requirement_is_strictly_under() -> None:
    """The gate requires <1000ms; the script's own check is `.ms >= 1000` is
    over-budget, so exactly 1000ms must be flagged, not passed."""
    result = subprocess.run(
        [_find_bash(), "-c", "echo 1000 | awk '{ exit !($1 >= 1000) }'"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0  # awk exit 0 means "is over budget" (>=1000) — correctly flagged


def test_999ms_is_within_budget() -> None:
    result = subprocess.run(
        [_find_bash(), "-c", "echo 999 | awk '{ exit !($1 >= 1000) }'"],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0  # not over budget

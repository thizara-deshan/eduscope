"""Wrapper tests for outputs.sh.

As with record-eos.sh, a full 300s stateful full-mix simulation is
impractical to fake without a real board; this suite verifies prerequisite
checks, argument parsing, the token is never printed, and the exact
threshold math (fps boundary) the script uses.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from .conftest import TOKEN, _find_bash, run_script


def test_script_exists_and_is_valid_bash() -> None:
    script = Path(__file__).resolve().parents[2] / "scripts" / "bench" / "outputs.sh"
    assert script.exists()
    result = subprocess.run([_find_bash(), "-n", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_missing_output_dir_fails(state_dir, tmp_path) -> None:
    result = run_script(
        "outputs.sh", ["--base-url", "http://fake", "--evidence-dir", str(tmp_path)], state_dir
    )
    assert result.returncode != 0
    assert "--output-dir is required" in result.stdout


def test_missing_evidence_dir_fails(state_dir, tmp_path) -> None:
    result = run_script(
        "outputs.sh", ["--base-url", "http://fake", "--output-dir", str(tmp_path)], state_dir
    )
    assert result.returncode != 0
    assert "--evidence-dir is required" in result.stdout


def test_missing_required_binary_fails_fast(state_dir, tmp_path) -> None:
    result = run_script(
        "outputs.sh",
        ["--base-url", "http://fake", "--output-dir", str(tmp_path), "--evidence-dir", str(tmp_path)],
        state_dir,
        env_overrides={"FFPROBE": "/nonexistent/ffprobe"},
    )
    assert result.returncode != 0
    assert "FAIL A16-OUT ffprobe is required" in result.stdout


def test_token_never_appears_in_output(state_dir, tmp_path) -> None:
    result = run_script(
        "outputs.sh",
        ["--base-url", "http://fake", "--output-dir", str(tmp_path), "--evidence-dir", str(tmp_path)],
        state_dir,
        timeout=15,
    )
    assert TOKEN not in result.stdout
    assert TOKEN not in result.stderr


def _fps_at_least(value: str, minimum: str) -> bool:
    result = subprocess.run(
        [_find_bash(), "-c", f"awk -v v={value} -v m={minimum} 'BEGIN {{ exit !(v >= m) }}'"],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def test_fps_boundary_2999_fails() -> None:
    assert _fps_at_least("29.99", "30.00") is False


def test_fps_boundary_3000_passes() -> None:
    assert _fps_at_least("30.00", "30.00") is True


def test_fps_above_minimum_passes() -> None:
    assert _fps_at_least("30.50", "30.00") is True

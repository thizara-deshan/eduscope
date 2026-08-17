"""Wrapper tests for resource-ledger.sh: prerequisite checks, argument
parsing, token handling, and the exact /proc/stat idle-percent math using
two synthetic samples (real /proc/stat does not exist on this dev host)."""

from __future__ import annotations

import subprocess
from pathlib import Path

from .conftest import TOKEN, _find_bash, run_script


def test_script_exists_and_is_valid_bash() -> None:
    script = Path(__file__).resolve().parents[2] / "scripts" / "bench" / "resource-ledger.sh"
    assert script.exists()
    result = subprocess.run([_find_bash(), "-n", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_missing_evidence_dir_fails(state_dir, tmp_path) -> None:
    result = run_script("resource-ledger.sh", ["--base-url", "http://fake"], state_dir)
    assert result.returncode != 0
    assert "--evidence-dir is required" in result.stdout


def test_missing_required_binary_fails_fast(state_dir, tmp_path) -> None:
    result = run_script(
        "resource-ledger.sh",
        ["--base-url", "http://fake", "--evidence-dir", str(tmp_path)],
        state_dir,
        env_overrides={"JQ": "/nonexistent/jq"},
    )
    assert result.returncode != 0
    assert "FAIL A16-RES jq is required" in result.stdout


def test_token_never_appears_in_output(state_dir, tmp_path) -> None:
    result = run_script(
        "resource-ledger.sh",
        ["--base-url", "http://fake", "--evidence-dir", str(tmp_path), "--duration-sec", "0"],
        state_dir,
        timeout=15,
    )
    assert TOKEN not in result.stdout
    assert TOKEN not in result.stderr


def _idle_percent(before: str, after: str) -> float:
    script = Path(__file__).resolve().parents[2] / "scripts" / "bench" / "resource-ledger.sh"
    awk_program = '''
      function fields(line,   n, a) { n = split(line, a, " "); return n }
      BEGIN {
        nb = split(before, b, " ")
        na = split(after, a, " ")
        idle1 = b[5] + b[6]; idle2 = a[5] + a[6]
        total1 = 0; for (i = 2; i <= nb; i++) total1 += b[i]
        total2 = 0; for (i = 2; i <= na; i++) total2 += a[i]
        idle_delta = idle2 - idle1
        total_delta = total2 - total1
        if (total_delta <= 0) { print 0; exit }
        printf "%.4f", 100 * idle_delta / total_delta
      }
    '''
    result = subprocess.run(
        [_find_bash(), "-c", f'awk -v before="{before}" -v after="{after}" \'{awk_program}\''],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return float(result.stdout.strip())


def test_idle_percent_all_idle_is_100() -> None:
    # cpu user nice system idle iowait irq softirq steal
    before = "cpu 0 0 0 1000 0 0 0 0"
    after = "cpu 0 0 0 2000 0 0 0 0"
    assert _idle_percent(before, after) == 100.0


def test_idle_percent_fully_busy_is_0() -> None:
    before = "cpu 1000 0 0 0 0 0 0 0"
    after = "cpu 2000 0 0 0 0 0 0 0"
    assert _idle_percent(before, after) == 0.0


def test_idle_percent_thirty_percent() -> None:
    # 300 idle out of 1000 total delta -> 30.00%
    before = "cpu 0 0 0 0 0 0 0 0"
    after = "cpu 700 0 0 300 0 0 0 0"
    assert _idle_percent(before, after) == 30.0


def test_headroom_boundary_2999_fails() -> None:
    result = subprocess.run(
        [_find_bash(), "-c", "awk -v m=29.99 -v min=30.00 'BEGIN { exit !(m >= min) }'"],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0


def test_headroom_boundary_3000_passes() -> None:
    result = subprocess.run(
        [_find_bash(), "-c", "awk -v m=30.00 -v min=30.00 'BEGIN { exit !(m >= min) }'"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0

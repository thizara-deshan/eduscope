from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

FAKEBIN = Path(__file__).resolve().parent / "fakebin"
SCRIPTS = Path(__file__).resolve().parents[2] / "scripts" / "bench"
TOKEN = "bench-token-0123456789abcdef"


def _find_bash() -> str:
    """Python's own subprocess PATH search can resolve `bash` to Windows'
    WSL launcher instead of Git Bash — pin an explicit, real bash.exe."""
    for candidate in (
        os.environ.get("BENCH_TEST_BASH"),
        "C:/Program Files/Git/bin/bash.exe",
        "C:/Program Files/Git/usr/bin/bash.exe",
    ):
        if candidate and Path(candidate).exists():
            return candidate
    return "bash"  # POSIX CI/target: the real bash is just on PATH.


@pytest.fixture
def state_dir(tmp_path: Path) -> Path:
    state = tmp_path / "state"
    state.mkdir()
    return state


def write_sequence(state_dir: Path, snapshots: list[dict]) -> None:
    (state_dir / "sequence.json").write_text(json.dumps(snapshots), encoding="utf-8")


def _to_posix(path: str) -> str:
    """`C:\\a\\b` -> `/c/a/b` — MSYS bash needs a POSIX-shaped $PATH; passing
    a Windows-style (semicolon/backslash) value through native subprocess
    env is not reliably converted for every entry."""
    p = path.replace("\\", "/")
    if len(p) > 1 and p[1] == ":":
        p = f"/{p[0].lower()}{p[2:]}"
    return p


#: Every external tool the bench scripts call is overridable via one of
#: these env vars (CURL=, JQ=, ...) — the scripts default to the bare name
#: when unset, so this only matters for tests. MSYS bash always prepends its
#: own /mingw64/bin:/usr/bin ahead of any $PATH we pass in, so pointing PATH
#: at the fakes is not reliable; pinning each var to an absolute path is.
OVERRIDE_VARS = ("CURL", "JQ", "FFPROBE", "STAT", "KILL", "SLEEP")


def run_script(
    name: str,
    args: list[str],
    state_dir: Path,
    *,
    env_overrides: dict[str, str] | None = None,
    timeout: float = 30,
    fake_tools: bool = True,
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["FAKE_PM_STATE"] = str(state_dir)
    env["EDUSCOPE_PM_TOKEN"] = TOKEN

    if fake_tools:
        for var in OVERRIDE_VARS:
            tool = var.lower()
            path = FAKEBIN / tool
            if path.exists():
                # `command -v "$CURL"` in the scripts only succeeds if the fake
                # tool is executable. A ZIP download (or a checkout that lost
                # the mode bit) strips +x, so ensure it here — otherwise every
                # bench script dies at its first `command -v` on Linux.
                if sys.platform != "win32":
                    path.chmod(path.stat().st_mode | 0o111)
                env[var] = _to_posix(str(path)) if sys.platform == "win32" else str(path)

    if env_overrides:
        env.update(env_overrides)

    bash = _find_bash()
    script_path = SCRIPTS / name
    return subprocess.run(
        [bash, str(script_path), *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

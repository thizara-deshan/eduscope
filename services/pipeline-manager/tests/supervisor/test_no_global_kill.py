from __future__ import annotations

import re
from pathlib import Path

SRC_ROOT = Path(__file__).resolve().parents[2] / "src"

FORBIDDEN_PATTERNS = {
    "killall": re.compile(r"\bkillall\b"),
    "pkill": re.compile(r"\bpkill\b"),
    "shell=True": re.compile(r"shell\s*=\s*True"),
    "create_subprocess_shell": re.compile(r"create_subprocess_shell"),
    "sudo": re.compile(r"\bsudo\b"),
}


def _source_files() -> list[Path]:
    return sorted(SRC_ROOT.rglob("*.py"))


def test_no_forbidden_patterns_in_application_code() -> None:
    violations: list[str] = []
    for path in _source_files():
        text = path.read_text(encoding="utf-8")
        for name, pattern in FORBIDDEN_PATTERNS.items():
            if pattern.search(text):
                violations.append(f"{path.relative_to(SRC_ROOT)}: {name}")
    assert violations == [], f"forbidden patterns found in application code: {violations}"


def test_src_root_actually_has_python_files() -> None:
    """Guards against the scan silently passing because the glob matched nothing."""
    assert len(_source_files()) > 10

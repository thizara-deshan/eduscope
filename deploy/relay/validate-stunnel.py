#!/usr/bin/env python3
"""Validate an stunnel configuration without binding its configured ports."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ACCEPT = re.compile(r"(?m)^\s*accept\s*=.*$")
FOREGROUND = re.compile(r"(?m)^\s*foreground\s*=.*$")
PID = re.compile(r"(?m)^\s*pid\s*=.*$")


def validation_config(content: str) -> str:
    if not ACCEPT.search(content):
        raise ValueError("no stunnel services configured")
    content = ACCEPT.sub("accept = 127.0.0.1:0", content)
    content = FOREGROUND.sub("foreground = yes", content)
    content = PID.sub("pid =", content)
    return "syslog = no\ndelay = yes\n" + content


def validate(path: Path) -> None:
    rendered = validation_config(path.read_text())
    with tempfile.NamedTemporaryFile("w", prefix="eduscope-stunnel-", delete=False) as stream:
        stream.write(rendered)
        temporary = stream.name
    process = None
    try:
        process = subprocess.Popen(
            ("/usr/bin/stunnel4", temporary),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        time.sleep(0.5)
        status = process.poll()
        if status is not None:
            detail = process.stderr.read().strip()
            if "Configuration successful" not in detail:
                raise ValueError(detail or "stunnel validation failed")
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if process is not None and process.stderr is not None:
            process.stderr.close()
        os.unlink(temporary)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: eduscope-stunnel-validate CONFIG", file=sys.stderr)
        return 64
    try:
        validate(Path(sys.argv[1]))
    except (OSError, ValueError) as error:
        print(f"stunnel configuration invalid: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

from .conftest import TOKEN, _find_bash, run_script, write_sequence

ONLINE_SNAPSHOT = {
    "publishers": {
        "usb": {"pid": 100, "state": "online"},
        "rtsp": {"pid": 101, "state": "online"},
        "rtsp2": {"pid": 102, "state": "online"},
        "audio": {"pid": 103, "state": "online"},
    },
    "consumers": [],
}


def test_script_exists_and_is_valid_bash() -> None:
    script = Path(__file__).resolve().parents[2] / "scripts" / "bench" / "publishers.sh"
    assert script.exists()
    import subprocess

    result = subprocess.run([_find_bash(), "-n", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_missing_required_binary_fails_fast(state_dir: Path) -> None:
    write_sequence(state_dir, [ONLINE_SNAPSHOT])
    result = run_script(
        "publishers.sh", ["http://fake"], state_dir, env_overrides={"CURL": "/nonexistent/curl"}
    )
    assert result.returncode != 0
    assert "FAIL A15-PUB curl is required" in result.stdout


def test_token_never_appears_in_output(state_dir: Path) -> None:
    write_sequence(state_dir, [ONLINE_SNAPSHOT])
    result = run_script("publishers.sh", ["http://fake"], state_dir)
    assert TOKEN not in result.stdout
    assert TOKEN not in result.stderr


def test_warm_wait_timeout_fails(state_dir: Path) -> None:
    offline_forever = {
        "publishers": {
            "usb": {"pid": 100, "state": "offline"},
            "rtsp": {"pid": 101, "state": "offline"},
            "rtsp2": {"pid": 102, "state": "offline"},
            "audio": {"pid": 103, "state": "offline"},
        },
        "consumers": [],
    }
    write_sequence(state_dir, [offline_forever])
    result = run_script("publishers.sh", ["http://fake"], state_dir, timeout=25)
    assert result.returncode != 0
    assert "FAIL A15-PUB warm publishers" in result.stdout


def test_missing_socket_fails(state_dir: Path) -> None:
    """On this dev host there is no real AF_UNIX support to create genuine
    socket files (see test_helper_client.py's equivalent POSIX gate), so the
    warm publishers always reach the socket check and correctly fail there."""
    write_sequence(state_dir, [ONLINE_SNAPSHOT])
    result = run_script("publishers.sh", ["http://fake"], state_dir)
    assert result.returncode != 0
    assert "FAIL A15-PUB missing" in result.stdout


@pytest.mark.skipif(sys.platform == "win32", reason="AF_UNIX socket files are POSIX-only; verified on target")
def test_restart_isolation_success_fixture(state_dir: Path) -> None:
    import socket

    for name in ("usb.sock", "rtsp.sock", "rtsp2.sock", "audio.sock"):
        path = f"/tmp/{name}"
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.bind(path)

    restart_usb = json.loads(json.dumps(ONLINE_SNAPSHOT))
    restart_usb["publishers"]["usb"] = {"pid": 200, "state": "online"}
    restart_rtsp = json.loads(json.dumps(restart_usb))
    restart_rtsp["publishers"]["rtsp"] = {"pid": 201, "state": "online"}
    restart_rtsp2 = json.loads(json.dumps(restart_rtsp))
    restart_rtsp2["publishers"]["rtsp2"] = {"pid": 202, "state": "online"}
    restart_audio = json.loads(json.dumps(restart_rtsp2))
    restart_audio["publishers"]["audio"] = {"pid": 203, "state": "online"}

    write_sequence(state_dir, [ONLINE_SNAPSHOT, restart_usb, restart_rtsp, restart_rtsp2, restart_audio])

    result = run_script("publishers.sh", ["http://fake"], state_dir, timeout=60)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "PASS A15-PUB warm publishers, sockets, isolated restarts" in result.stdout

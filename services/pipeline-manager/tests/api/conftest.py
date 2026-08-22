from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import httpx
import pytest

from pipeline_manager.app import create_app
from pipeline_manager.config import Settings

FAKE_CHILD = Path(__file__).resolve().parents[1] / "supervisor" / "fake_child.py"
VALID_TOKEN = "0123456789abcdef0123456789abcdef"


def make_fake_popen():
    """Redirects every spawn to the real fake_child.py, regardless of the
    (gst-launch-1.0-shaped) argv the builders produced — no real GStreamer is
    installed on this dev host. When the argv carries a real filesystem
    `location=` (record/snapshot), fake_child grows *that* exact path so
    record's file-growth confirmation observes real writes; otherwise (RTMP
    URLs, display sinks) it just emits PLAYING.
    """

    def _file_location(argv) -> str | None:
        for token in argv:
            if token.startswith("location="):
                value = token.split("=", 1)[1].split(" ")[0]  # drop a trailing " live=1" etc.
                if "://" not in value:
                    return value
        return None

    def fake_popen(argv, **kwargs):
        location = _file_location(argv)
        mode = f"grow:{location}" if location else "playing"
        return subprocess.Popen([sys.executable, str(FAKE_CHILD), mode], **kwargs)

    return fake_popen


@pytest.fixture
def app_and_popen(tmp_path):
    settings = Settings(shared_bearer_token=VALID_TOKEN, recordings_root=tmp_path)
    popen = make_fake_popen()
    app = create_app(settings, popen=popen)
    return app, popen


@pytest.fixture
def app(app_and_popen):
    app = app_and_popen[0]
    yield app
    for process in app.state.supervisor.processes.values():
        if process.popen.poll() is None:
            process.popen.terminate()
    for process in app.state.supervisor.processes.values():
        try:
            process.popen.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.popen.kill()
            process.popen.wait(timeout=5)


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture
def auth_headers():
    return {"Authorization": f"Bearer {VALID_TOKEN}"}


@pytest.fixture
def online_publishers(app):
    for controller in app.state.publishers.values():
        controller.observe_running()
    return app.state.publishers

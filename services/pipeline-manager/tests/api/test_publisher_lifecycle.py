"""Integ-A (Arch, fake child — pm-remediation.md B2): the real publisher
coordinator, driven entirely over HTTP, against a REAL `subprocess.Popen` of
`tests/supervisor/fake_child.py` (never real GStreamer). This is what proves
real PGIDs, real `killpg`, and truthful `/status`/events — the things a pure
fake-supervisor unit test (`tests/publishers/test_coordinator.py`) cannot.

Run just this file:
    cd services/pipeline-manager && source .venv/bin/activate
    pytest -q tests/api/test_publisher_lifecycle.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from functools import partial

import pytest

from pipeline_manager.publishers.coordinator import start_publisher as real_start_publisher
from pipeline_manager.publishers.coordinator import stop_publisher as real_stop_publisher

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="real PGID/killpg over a spawned child is POSIX-only; verified on target"
)

BINDINGS = {
    "usb": {"address": "/dev/video0"},
    "rtsp": {"address": "rtsp://cam1:554/stream"},
    "rtsp2": {"address": "rtsp://cam2:554/stream"},
    "audio": {"address": "hw:1,0"},
}


def _wire_real_publisher_coordinator(app) -> None:
    """Mirrors `create_production_app`'s wiring exactly, except the `app`
    fixture already carries a fake `popen` (real `subprocess.Popen` of
    `fake_child.py`) — this is the "choose which adapter you inject" swap
    from pm-remediation.md §1: real coordinator + fake child = Integ-A.
    """
    app.state.start_publisher = partial(
        real_start_publisher, supervisor=app.state.supervisor, confirmer=app.state.confirmer, events=app.state.events
    )
    app.state.stop_publisher = partial(
        real_stop_publisher, supervisor=app.state.supervisor, events=app.state.events
    )


async def _poll_until(predicate, *, timeout: float = 3.0, interval: float = 0.02):
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        result = await predicate()
        if result:
            return result
        if asyncio.get_running_loop().time() >= deadline:
            raise AssertionError("condition not met before timeout")
        await asyncio.sleep(interval)


@pytest.mark.asyncio
async def test_bind_start_all_four_publishers_over_http_yields_distinct_real_pids(
    app, client, auth_headers
) -> None:
    _wire_real_publisher_coordinator(app)

    for publisher_id, body in BINDINGS.items():
        response = await client.put(f"/publishers/{publisher_id}/binding", headers=auth_headers, json=body)
        assert response.status_code == 202

    for publisher_id in BINDINGS:
        response = await client.post(f"/publishers/{publisher_id}/start", headers=auth_headers)
        assert response.status_code == 202
        assert response.json()["state"] == "starting"  # 202-accepted, never the final state (§3.1)

    async def _all_online():
        status = (await client.get("/status", headers=auth_headers)).json()
        publishers = status["publishers"]
        if all(publishers[pid]["state"] == "online" for pid in BINDINGS):
            return publishers
        return None

    publishers = await _poll_until(_all_online)

    pids = {publisher_id: entry["pid"] for publisher_id, entry in publishers.items()}
    assert all(isinstance(pid, int) for pid in pids.values()), pids
    assert len(set(pids.values())) == 4, "each publisher got its own real OS pid"

    # real, independent process groups (start_new_session=True) — not a
    # shell fan-out, not shared with each other.
    for publisher_id, pid in pids.items():
        assert os.getpgid(pid) == pid, f"{publisher_id} child is not its own process-group leader"

    processes_before_stop = dict(app.state.supervisor.processes)

    for publisher_id in BINDINGS:
        response = await client.post(f"/publishers/{publisher_id}/stop", headers=auth_headers)
        assert response.status_code == 202

    async def _all_offline():
        status = (await client.get("/status", headers=auth_headers)).json()
        publishers = status["publishers"]
        if all(publishers[pid]["state"] == "offline" and publishers[pid]["pid"] is None for pid in BINDINGS):
            return True
        return False

    await _poll_until(_all_offline)

    for publisher_id in BINDINGS:
        identity = f"publisher:{publisher_id}"
        assert identity not in app.state.supervisor.processes  # cleaned out of supervisor ownership
        process = processes_before_stop[identity]
        assert process.popen.poll() is not None, f"{publisher_id}'s real child was actually killed, not just forgotten"


@pytest.mark.asyncio
async def test_killing_one_publisher_leaves_its_siblings_running(app, client, auth_headers) -> None:
    """Restart/stop of one publisher must never disturb another — the whole
    point of shm decoupling (design §1.1) — proven here with real children."""
    _wire_real_publisher_coordinator(app)

    for publisher_id, body in BINDINGS.items():
        await client.put(f"/publishers/{publisher_id}/binding", headers=auth_headers, json=body)
    for publisher_id in BINDINGS:
        await client.post(f"/publishers/{publisher_id}/start", headers=auth_headers)

    async def _all_online():
        status = (await client.get("/status", headers=auth_headers)).json()
        publishers = status["publishers"]
        return publishers if all(publishers[pid]["state"] == "online" for pid in BINDINGS) else None

    before = await _poll_until(_all_online)
    sibling_pids = {pid: entry["pid"] for pid, entry in before.items() if pid != "rtsp"}

    response = await client.post("/publishers/rtsp/stop", headers=auth_headers)
    assert response.status_code == 202

    async def _rtsp_offline():
        status = (await client.get("/status", headers=auth_headers)).json()
        return status["publishers"]["rtsp"]["state"] == "offline"

    await _poll_until(_rtsp_offline)

    status = (await client.get("/status", headers=auth_headers)).json()
    for publisher_id, pid in sibling_pids.items():
        assert status["publishers"][publisher_id]["state"] == "online"
        assert status["publishers"][publisher_id]["pid"] == pid  # untouched

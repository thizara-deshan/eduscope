"""Proves `live-cycle.py --serve-fixtures`'s stdio protocol end-to-end as a
real subprocess (its filename is not a valid Python module name to import
directly, and a real subprocess is the same boundary the TypeScript
integration test drives)."""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path

import httpx
import pytest

SCRIPT = Path(__file__).resolve().parent / "live-cycle.py"
BEARER = "fixture-stack-test-internal-bearer-01"


class FixtureProcess:
    def __init__(self, process: asyncio.subprocess.Process, runtime_root: Path, recordings_root: Path) -> None:
        self.process = process
        self.runtime_root = runtime_root
        self.recordings_root = recordings_root
        self.ready: dict[str, str] | None = None

    async def read_ready(self) -> dict[str, str]:
        assert self.process.stdout is not None
        async with asyncio.timeout(10.0):
            line = await self.process.stdout.readline()
        self.ready = json.loads(line)
        assert self.ready["type"] == "ready"
        return self.ready

    async def send(self, command: str) -> dict[str, object]:
        assert self.process.stdin is not None
        assert self.process.stdout is not None
        self.process.stdin.write((json.dumps({"command": command}) + "\n").encode())
        await self.process.stdin.drain()
        async with asyncio.timeout(10.0):
            line = await self.process.stdout.readline()
        return json.loads(line)

    async def send_raw(self, raw: str) -> dict[str, object]:
        assert self.process.stdin is not None
        assert self.process.stdout is not None
        self.process.stdin.write((raw + "\n").encode())
        await self.process.stdin.drain()
        async with asyncio.timeout(10.0):
            line = await self.process.stdout.readline()
        return json.loads(line)

    async def close_stdin(self) -> None:
        assert self.process.stdin is not None
        self.process.stdin.close()

    async def wait(self, timeout: float = 10.0) -> int:
        async with asyncio.timeout(timeout):
            return await self.process.wait()


@pytest.fixture
async def fixture_process():
    runtime_root = Path(tempfile.mkdtemp(prefix="fixture-runtime-test-"))
    recordings_root = Path(tempfile.mkdtemp(prefix="fixture-recordings-test-"))
    process = await asyncio.create_subprocess_exec(
        # Spawn the same interpreter running the tests so the fixture stack has
        # this venv's dependencies, whether pytest was launched via an activated
        # venv or directly through `.venv/bin/python -m pytest`.
        sys.executable,
        str(SCRIPT),
        "--serve-fixtures",
        "--bearer",
        BEARER,
        "--runtime-root",
        str(runtime_root),
        "--recordings-root",
        str(recordings_root),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    wrapper = FixtureProcess(process, runtime_root, recordings_root)
    try:
        yield wrapper
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


async def _auth_headers() -> dict:
    return {"authorization": f"Bearer {BEARER}"}


async def test_startup_prints_one_ready_line_with_four_urls(fixture_process: FixtureProcess) -> None:
    ready = await fixture_process.read_ready()
    assert set(ready) == {"type", "stt", "slide", "question", "llama"}
    for key in ("stt", "slide", "question", "llama"):
        assert ready[key].startswith("http://127.0.0.1:")

    async with httpx.AsyncClient() as client:
        for key in ("stt", "slide", "question", "llama"):
            response = await client.get(f"{ready[key]}/healthz" if key != "llama" else f"{ready[key]}/health")
            assert response.status_code == 200

    await fixture_process.send("stop")
    assert await fixture_process.wait() == 0


async def test_pcm_command_is_acked(fixture_process: FixtureProcess) -> None:
    await fixture_process.read_ready()
    ack = await fixture_process.send("pcm")
    assert ack == {"type": "ack", "command": "pcm"}
    await fixture_process.send("stop")
    assert await fixture_process.wait() == 0


async def test_slide_command_is_acked(fixture_process: FixtureProcess) -> None:
    await fixture_process.read_ready()
    ack = await fixture_process.send("slide")
    assert ack == {"type": "ack", "command": "slide"}
    await fixture_process.send("stop")
    assert await fixture_process.wait() == 0


async def test_llm_offline_then_online_toggles_reachability(fixture_process: FixtureProcess) -> None:
    ready = await fixture_process.read_ready()
    ack = await fixture_process.send("llm-offline")
    assert ack == {"type": "ack", "command": "llm-offline"}

    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.TransportError):
            await client.get(f"{ready['llama']}/health", timeout=2.0)

    ack = await fixture_process.send("llm-online")
    assert ack == {"type": "ack", "command": "llm-online"}

    async with httpx.AsyncClient() as client:
        response = await client.get(f"{ready['llama']}/health", timeout=2.0)
        assert response.status_code == 200

    await fixture_process.send("stop")
    assert await fixture_process.wait() == 0


async def test_restart_stt_forgets_in_memory_session_on_the_same_port(fixture_process: FixtureProcess) -> None:
    ready = await fixture_process.read_ready()
    async with httpx.AsyncClient() as client:
        headers = await _auth_headers()
        start = await client.post(
            f"{ready['stt']}/sessions",
            json={"sessionId": "01J00000000000000000000000", "anchorOffsetMs": 0},
            headers=headers,
        )
        assert start.status_code == 202

        status_before = await client.get(f"{ready['stt']}/status", headers=headers)
        assert status_before.json()["sessionId"] == "01J00000000000000000000000"

    ack = await fixture_process.send("restart-stt")
    assert ack == {"type": "ack", "command": "restart-stt"}

    async with httpx.AsyncClient() as client:
        status_after = await client.get(f"{ready['stt']}/status", headers=headers)
        assert status_after.status_code == 200
        assert status_after.json()["sessionId"] is None
        assert status_after.json()["state"] == "idle"

    await fixture_process.send("stop")
    assert await fixture_process.wait() == 0


async def test_restart_slide_forgets_in_memory_session_on_the_same_port(fixture_process: FixtureProcess) -> None:
    ready = await fixture_process.read_ready()
    session_id = "01J00000000000000000000001"
    source_path = str(fixture_process.runtime_root / "slides" / session_id / "current.png")
    image_dir = str(fixture_process.recordings_root / "sessions" / session_id / "slides")
    headers = await _auth_headers()

    async with httpx.AsyncClient() as client:
        start = await client.post(
            f"{ready['slide']}/sessions",
            json={"sessionId": session_id, "imageDir": image_dir, "sourcePath": source_path, "anchorOffsetMs": 0},
            headers=headers,
        )
        assert start.status_code == 202

        status_before = await client.get(f"{ready['slide']}/status", headers=headers)
        assert status_before.json()["sessionId"] == session_id

    ack = await fixture_process.send("restart-slide")
    assert ack == {"type": "ack", "command": "restart-slide"}

    async with httpx.AsyncClient() as client:
        status_after = await client.get(f"{ready['slide']}/status", headers=headers)
        assert status_after.status_code == 200
        assert status_after.json()["sessionId"] is None
        assert status_after.json()["state"] == "idle"

    await fixture_process.send("stop")
    assert await fixture_process.wait() == 0


async def test_malformed_command_returns_error_and_keeps_the_process_alive(fixture_process: FixtureProcess) -> None:
    await fixture_process.read_ready()

    invalid_json = await fixture_process.send_raw("not json")
    assert invalid_json == {"type": "error", "message": "invalid command"}

    unknown_command = await fixture_process.send_raw(json.dumps({"command": "not-a-real-command"}))
    assert unknown_command == {"type": "error", "message": "invalid command"}

    extra_field = await fixture_process.send_raw(json.dumps({"command": "pcm", "extra": "nope"}))
    assert extra_field == {"type": "error", "message": "invalid command"}

    # the process is still alive and answers a valid command normally
    ack = await fixture_process.send("pcm")
    assert ack == {"type": "ack", "command": "pcm"}

    await fixture_process.send("stop")
    assert await fixture_process.wait() == 0


async def test_eof_without_stop_exits_cleanly(fixture_process: FixtureProcess) -> None:
    await fixture_process.read_ready()
    await fixture_process.send("pcm")
    await fixture_process.close_stdin()
    assert await fixture_process.wait() == 0


async def test_stop_command_closes_every_bound_port(fixture_process: FixtureProcess) -> None:
    ready = await fixture_process.read_ready()
    await fixture_process.send("stop")
    assert await fixture_process.wait() == 0

    async with httpx.AsyncClient() as client:
        for key in ("stt", "slide", "question", "llama"):
            with pytest.raises(httpx.TransportError):
                await client.get(f"{ready[key]}/", timeout=2.0)

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from pipeline_manager.hardware.helper_client import HelperClient


@pytest.mark.asyncio
async def test_helper_double_accepts_only_the_bench_allowlist(tmp_path: Path) -> None:
    script = Path(__file__).parents[2] / "scripts" / "bench" / "helper-double.py"
    socket = tmp_path / "helper.sock"
    proc = await asyncio.create_subprocess_exec("python3", str(script), "--socket", str(socket))
    try:
        for _ in range(50):
            if socket.exists():
                break
            await asyncio.sleep(0.02)
        client = HelperClient(socket)
        assert (await client.set_led("blink")).ok is True

        reader, writer = await asyncio.open_unix_connection(str(socket))
        writer.write((json.dumps({"id": "bad", "verb": "system.poweroff", "args": {}}) + "\n").encode())
        await writer.drain()
        response = json.loads(await reader.readline())
        writer.close()
        await writer.wait_closed()
        assert response == {"id": "bad", "ok": False, "error": "verb_not_allowed"}
    finally:
        proc.terminate()
        await proc.wait()

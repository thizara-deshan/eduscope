"""A fake root-helper Unix-socket server for A-13's one POSIX integration
test. Records the raw request line it received and replies with a queued
canned response (or a generic ok if none was queued).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path


class FakeHelperServer:
    def __init__(self, socket_path: Path) -> None:
        self.socket_path = socket_path
        self.received_lines: list[str] = []
        self.responses: list[dict] = []
        self._server: asyncio.AbstractServer | None = None

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        line = await reader.readline()
        self.received_lines.append(line.decode("utf-8").rstrip("\n"))
        response = self.responses.pop(0) if self.responses else {"id": "unknown", "ok": True}
        writer.write((json.dumps(response) + "\n").encode("utf-8"))
        await writer.drain()
        writer.close()

    async def start(self) -> None:
        self._server = await asyncio.start_unix_server(self._handle, path=str(self.socket_path))

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
        if self.socket_path.exists():
            self.socket_path.unlink(missing_ok=True)

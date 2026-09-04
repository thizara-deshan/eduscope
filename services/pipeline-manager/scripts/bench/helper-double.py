#!/usr/bin/env python3
"""Unprivileged fixed-allowlist helper double for RK3588 bench gates."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

ALLOWED = {"led.set", "usbhub.cycle"}


async def serve(path: Path) -> None:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            raw = await asyncio.wait_for(reader.readline(), timeout=2)
            request = json.loads(raw)
            verb = request.get("verb")
            response = {
                "id": request.get("id", "unknown"),
                "ok": verb in ALLOWED,
            }
            if verb not in ALLOWED:
                response["error"] = "verb_not_allowed"
            writer.write((json.dumps(response, separators=(",", ":")) + "\n").encode())
            await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()
            await writer.wait_closed()

    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    server = await asyncio.start_unix_server(handle, path=str(path))
    try:
        async with server:
            await server.serve_forever()
    finally:
        path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", type=Path, required=True)
    args = parser.parse_args()
    try:
        asyncio.run(serve(args.socket))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

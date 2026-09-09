from __future__ import annotations

import json
import os
import pwd
import socket
import sys
import time
from pathlib import Path
from typing import Any, Callable, TextIO

from .peer import PeerCredentials, peer_credentials
from .verbs import VerbRegistry

MAX_REQUEST_BYTES = 64 * 1024
READ_TIMEOUT_SECONDS = 5.0


def _response(detail: str) -> dict[str, Any]:
    return {"ok": False, "detail": detail}


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value: raise ValueError("duplicate JSON field")
        value[key] = item
    return value


def handle_connection(conn: socket.socket, registry: VerbRegistry, allowed_uids: set[int], audit_stream: TextIO,
                      *, peer_getter: Callable[[socket.socket], PeerCredentials] = peer_credentials) -> None:
    started = time.monotonic(); peer = PeerCredentials(-1, -1, -1); request_id = None; verb = None
    result = _response("request rejected")
    try:
        conn.settimeout(READ_TIMEOUT_SECONDS); peer = peer_getter(conn)
        if peer.uid not in allowed_uids: raise PermissionError("UID is not allowed")
        data = bytearray()
        while len(data) <= MAX_REQUEST_BYTES:
            chunk = conn.recv(min(4096, MAX_REQUEST_BYTES + 1 - len(data)))
            if not chunk: break
            data.extend(chunk)
            if b"\n" in chunk: break
        if len(data) > MAX_REQUEST_BYTES or data.count(b"\n") != 1 or not data.endswith(b"\n"):
            raise ValueError("request must be exactly one bounded line")
        request = json.loads(data[:-1].decode("utf-8"), object_pairs_hook=_unique_object)
        if not isinstance(request, dict) or set(request) != {"verb", "args", "requestId"}:
            raise ValueError("invalid canonical request")
        if isinstance(request, dict): request_id, verb = request.get("requestId"), request.get("verb")
        result = registry.dispatch(request, peer)
    except (UnicodeError, json.JSONDecodeError, OSError, ValueError, PermissionError):
        result = _response("request rejected")
    conn.sendall((json.dumps(result, separators=(",", ":")) + "\n").encode())
    audit = {"requestId": request_id, "uid": peer.uid, "verb": verb,
             "result": "ok" if result["ok"] else "error", "durationMs": round((time.monotonic() - started) * 1000, 3)}
    audit_stream.write(json.dumps(audit, separators=(",", ":")) + "\n"); audit_stream.flush()


def _listener_from_systemd() -> socket.socket:
    if os.environ.get("LISTEN_PID") != str(os.getpid()) or os.environ.get("LISTEN_FDS") != "1":
        raise RuntimeError("exactly one systemd listener fd is required")
    return socket.socket(fileno=3)


def _allowed_uids() -> set[int]:
    return {pwd.getpwnam(name).pw_uid for name in ("eduscope-core", "eduscope-pipeline")}


def main() -> None:
    config = json.loads(Path("/etc/eduscope/helper.json").read_text())
    listener = _listener_from_systemd(); registry = VerbRegistry(config)
    while True:
        conn, _ = listener.accept()
        with conn: handle_connection(conn, registry, _allowed_uids(), sys.stdout)

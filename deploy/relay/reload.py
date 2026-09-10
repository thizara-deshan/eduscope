#!/usr/bin/env python3
"""Validate and atomically promote the fixed Core API relay candidate."""

from __future__ import annotations

import hashlib
import json
import os
import pwd
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit


CANDIDATE = Path("/run/eduscope/relay/candidate.json")
NGINX_PUSH = Path("/run/eduscope/relay/nginx-push.conf")
STUNNEL_CONFIG = Path("/run/eduscope/relay/stunnel.conf")
STUNNEL_TEMPLATE = Path("/etc/eduscope/stunnel/eduscope.conf.template")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SAFE_KEY = re.compile(r"^[A-Za-z0-9._~+-]{1,512}$")
SAFE_HOST = re.compile(r"^[A-Za-z0-9.-]+$")
SAFE_PATH = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$")


def _run(argv: tuple[str, ...]) -> None:
    subprocess.run(argv, shell=False, check=True, capture_output=True, text=True, timeout=30)


def _read_candidate(path: Path, expected_uid: int) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as error:
        raise ValueError("candidate unavailable") from error
    try:
        stat = os.fstat(fd)
        if stat.st_uid != expected_uid or stat.st_mode & 0o777 != 0o600 or not os.path.isfile(path):
            raise ValueError("candidate owner or mode invalid")
        chunks = []
        while chunk := os.read(fd, 65536):
            chunks.append(chunk)
            if sum(map(len, chunks)) > 1024 * 1024:
                raise ValueError("candidate too large")
        return b"".join(chunks)
    finally:
        os.close(fd)


def _validated_targets(raw: bytes) -> list[dict[str, object]]:
    try:
        candidate = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("candidate JSON invalid") from error
    if not isinstance(candidate, dict) or set(candidate) != {"version", "targets"} or candidate["version"] != 1 or not isinstance(candidate["targets"], list):
        raise ValueError("candidate shape invalid")
    if len(candidate["targets"]) > 32:
        raise ValueError("too many targets")
    seen: set[str] = set()
    for target in candidate["targets"]:
        if not isinstance(target, dict) or set(target) != {"id", "platform", "ingestUrl", "streamKey", "requiresTlsBridge"}:
            raise ValueError("target shape invalid")
        target_id, url, key, tls = target["id"], target["ingestUrl"], target["streamKey"], target["requiresTlsBridge"]
        if not isinstance(target_id, str) or not SAFE_ID.fullmatch(target_id) or target_id in seen:
            raise ValueError("target id invalid")
        seen.add(target_id)
        if target["platform"] not in {"youtube", "facebook", "custom-rtmp"} or not isinstance(url, str) or not isinstance(key, str) or not SAFE_KEY.fullmatch(key) or not isinstance(tls, bool):
            raise ValueError("target fields invalid")
        parsed = urlsplit(url)
        if parsed.scheme not in {"rtmp", "rtmps"} or not parsed.hostname or not SAFE_HOST.fullmatch(parsed.hostname) or not SAFE_PATH.fullmatch(parsed.path) or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("target URL invalid")
        try:
            if parsed.port is not None and not 1 <= parsed.port <= 65535:
                raise ValueError("target port invalid")
        except ValueError as error:
            raise ValueError("target port invalid") from error
        if tls != (parsed.scheme == "rtmps" or target["platform"] in {"youtube", "facebook"}):
            raise ValueError("target TLS route invalid")
    return candidate["targets"]


def _render(targets: list[dict[str, object]], template: str) -> tuple[str, str]:
    pushes: list[str] = []
    sections: list[str] = []
    tls_index = 0
    for target in targets:
        parsed = urlsplit(str(target["ingestUrl"]))
        path = parsed.path.rstrip("/")
        key = str(target["streamKey"])
        if target["requiresTlsBridge"]:
            local_port = 19400 + tls_index
            tls_index += 1
            pushes.append(f"push rtmp://127.0.0.1:{local_port}{path}/{key};")
            remote_port = parsed.port or 443
            sections.append(
                f"[target-{target['id']}]\naccept = 127.0.0.1:{local_port}\n"
                f"connect = {parsed.hostname}:{remote_port}\ncheckHost = {parsed.hostname}\n"
            )
        else:
            authority = parsed.hostname + (f":{parsed.port}" if parsed.port else "")
            pushes.append(f"push rtmp://{authority}{path}/{key};")
    stunnel = template.replace("@SERVICE_SECTIONS@", "\n".join(sections))
    if "@" + "SERVICE_SECTIONS@" in stunnel:
        raise ValueError("stunnel template token remains")
    return "\n".join(pushes) + ("\n" if pushes else ""), stunnel


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def promote(digest: str, *, candidate_path: Path = CANDIDATE, nginx_path: Path = NGINX_PUSH,
            stunnel_path: Path = STUNNEL_CONFIG, stunnel_template_path: Path = STUNNEL_TEMPLATE,
            expected_uid: int | None = None, runner: Callable[[tuple[str, ...]], None] = _run) -> None:
    if not HEX64.fullmatch(digest):
        raise ValueError("digest invalid")
    uid = pwd.getpwnam("eduscope-core").pw_uid if expected_uid is None else expected_uid
    raw = _read_candidate(candidate_path, uid)
    if not hashlib.sha256(raw).hexdigest() == digest:
        raise ValueError("digest mismatch")
    targets = _validated_targets(raw)
    nginx_content, stunnel_content = _render(targets, stunnel_template_path.read_text())

    # Validate complete temporary stunnel content before changing either active file.
    with tempfile.NamedTemporaryFile("w", dir=stunnel_path.parent, delete=False) as temp:
        temp.write(stunnel_content)
        validation_path = temp.name
    try:
        runner(("stunnel4", "-test", validation_path))
    finally:
        os.unlink(validation_path)

    old_nginx = nginx_path.read_bytes() if nginx_path.exists() else None
    old_stunnel = stunnel_path.read_bytes() if stunnel_path.exists() else None
    try:
        _atomic_write(nginx_path, nginx_content)
        _atomic_write(stunnel_path, stunnel_content)
        runner(("nginx", "-t"))
        runner(("systemctl", "reload", "stunnel4.service"))
        runner(("systemctl", "reload", "nginx.service"))
    except Exception:
        if old_nginx is None:
            nginx_path.unlink(missing_ok=True)
        else:
            _atomic_write(nginx_path, old_nginx.decode())
        if old_stunnel is None:
            stunnel_path.unlink(missing_ok=True)
        else:
            _atomic_write(stunnel_path, old_stunnel.decode())
        try:
            runner(("systemctl", "reload", "stunnel4.service"))
            runner(("systemctl", "reload", "nginx.service"))
        except Exception:
            pass
        raise


def main() -> int:
    if len(sys.argv) != 2:
        print("error: invalid request")
        return 64
    try:
        promote(sys.argv[1])
    except Exception:
        print("error: relay reload failed")
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

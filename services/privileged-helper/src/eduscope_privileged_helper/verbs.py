from __future__ import annotations

import ipaddress
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from .peer import PeerCredentials

ALL_VERBS = (
    "net.apply", "volume.mount", "volume.unmount", "volume.format",
    "usbhub.cycle", "led.set", "system.poweroff", "firmware.check",
    "firmware.apply", "firmware.rollback", "relay.reload", "smart.read",
)
VERB_TIMEOUT = {
    "net.apply": 15, "volume.mount": 15, "volume.unmount": 15,
    "volume.format": 600, "usbhub.cycle": 30, "led.set": 5,
    "system.poweroff": 15, "firmware.check": 120, "firmware.apply": 3600,
    "firmware.rollback": 3600, "relay.reload": 30, "smart.read": 30,
}
RATE_LIMITS = {
    "led.set": (120, 60), "relay.reload": (30, 60), "net.apply": (10, 60),
    "smart.read": (12, 60), "volume.mount": (10, 60), "volume.unmount": (10, 60),
    "volume.format": (1, 600), "usbhub.cycle": (2, 3600),
    "system.poweroff": (1, 60), "firmware.check": (6, 3600),
    "firmware.apply": (1, 3600), "firmware.rollback": (1, 3600),
}
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_SAFE_IFACE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")
_SAFE_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$")
_SAFE_DEVNODE = re.compile(r"^/dev/[A-Za-z0-9][A-Za-z0-9._/-]{0,122}$")
_SAFE_LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$")
_DIGEST = re.compile(r"^[a-f0-9]{64}$")

Runner = Callable[[tuple[str, ...], int], tuple[int, str, str]]


def subprocess_runner(argv: tuple[str, ...], timeout: int) -> tuple[int, str, str]:
    completed = subprocess.run(argv, shell=False, check=False, capture_output=True, text=True, timeout=timeout)
    return completed.returncode, completed.stdout, completed.stderr


def _exact(args: Any, required: set[str], optional: set[str] = frozenset()) -> dict[str, Any]:
    if not isinstance(args, dict) or set(args) - required - optional or not required <= set(args):
        raise ValueError("invalid arguments")
    return args


def _safe_uuid(value: Any) -> str:
    if not isinstance(value, str) or not _SAFE_ID.fullmatch(value) or ".." in value:
        raise ValueError("invalid UUID")
    return value


def _safe_devnode(value: Any) -> str:
    if not isinstance(value, str) or not _SAFE_DEVNODE.fullmatch(value) or ".." in value:
        raise ValueError("invalid devnode")
    return value


class VerbRegistry:
    def __init__(self, config: dict[str, Any], *, runner: Runner = subprocess_runner,
                 clock: Callable[[], float] = time.time,
                 rate_limit_path: Path = Path("/run/eduscope/helper/rate-limits.json")) -> None:
        self.config, self.runner, self.clock, self.rate_limit_path = config, runner, clock, rate_limit_path

    def dispatch(self, request: Any, peer: PeerCredentials) -> dict[str, Any]:
        try:
            if not isinstance(request, dict) or set(request) != {"verb", "args", "requestId"}:
                raise ValueError("invalid request shape")
            verb, request_id = request["verb"], request["requestId"]
            if verb not in ALL_VERBS or not isinstance(request_id, str) or not 1 <= len(request_id) <= 128 or any(ord(c) < 32 for c in request_id):
                raise ValueError("invalid request")
            operation = self._operation(verb, request["args"])
            if not self._take_rate_limit(verb):
                return {"ok": False, "detail": "rate limit exceeded"}
            if operation is None:
                return {"ok": True, "detail": "configured hardware is absent; no action required"}
            if callable(operation):
                operation = operation()
                if isinstance(operation, str):
                    return {"ok": True, "detail": operation}
            code, stdout, _stderr = self.runner(operation, VERB_TIMEOUT[verb])
            if code != 0:
                return {"ok": False, "detail": "operation failed"}
            detail = self._safe_detail(stdout.strip())
            return {"ok": True, "detail": detail[:4096] if detail else "ok"}
        except (OSError, ValueError, TypeError, subprocess.TimeoutExpired, TimeoutError):
            return {"ok": False, "detail": "request rejected or operation failed"}

    def _operation(self, verb: str, args: Any):
        if verb == "led.set":
            args = _exact(args, {"mode"})
            if args["mode"] not in {"on", "off", "blink"}: raise ValueError("invalid LED mode")
            led = self.config.get("led", {})
            if led.get("present") is not True: return None
            node = led.get("sysfsName")
            active = str(led.get("activeValue"))
            if not isinstance(node, str) or "/" in node or not _SAFE_ID.fullmatch(node): raise ValueError("unknown LED")
            values = {"on": active, "off": "0" if active != "0" else "1", "blink": "timer"}
            def write_led():
                target = Path("/sys/class/leds") / node
                if args["mode"] == "blink":
                    (target / "trigger").write_text(values["blink"])
                else: (target / "brightness").write_text(values[args["mode"]])
                return "LED updated"
            return write_led
        if verb == "usbhub.cycle":
            args = _exact(args, {"location", "port"}); hub = self.config.get("captureHub", {})
            if args != hub or not isinstance(args["location"], str) or not isinstance(args["port"], int): raise ValueError("unknown hub")
            return ("uhubctl", "-l", args["location"], "-p", str(args["port"]), "-a", "cycle")
        if verb == "system.poweroff":
            _exact(args, set()); return ("systemctl", "poweroff")
        if verb.startswith("firmware."):
            args = _exact(args, set(), {"version"}); command = verb.split(".", 1)[1]
            argv = ["/usr/libexec/eduscope-updater", command, "--json"]
            if "version" in args:
                version = args["version"]
                if not isinstance(version, str) or not _SAFE_VERSION.fullmatch(version): raise ValueError("invalid version")
                argv += ["--version", version]
            return tuple(argv)
        if verb == "relay.reload":
            args = _exact(args, {"configDigest"}); digest = args["configDigest"]
            if not isinstance(digest, str) or not _DIGEST.fullmatch(digest): raise ValueError("invalid digest")
            return ("/usr/libexec/eduscope-relay-reload", digest)
        if verb in {"volume.mount", "volume.unmount"}:
            args = _exact(args, {"uuid"}); uuid = _safe_uuid(args["uuid"])
            expected = self.config.get("recordingsUuid")
            if not isinstance(expected, str) or uuid != expected: raise ValueError("unknown UUID")
            mountpoint = f"/media/eduscope/{uuid}"
            if verb == "volume.unmount": return ("systemd-umount", mountpoint)
            source = str(Path("/dev/disk/by-uuid") / uuid)
            resolved = str(Path(source).resolve(strict=True))
            if not resolved.startswith("/dev/"): raise ValueError("unsafe UUID target")
            return ("systemd-mount", "--no-block", "--collect", resolved, mountpoint)
        if verb in {"volume.format", "smart.read"}:
            required = {"devNode"} if verb == "smart.read" else {"devNode", "fs", "label"}
            args = _exact(args, required); devnode = _safe_devnode(args["devNode"])
            if devnode not in self.config.get("allowedDevnodes", []): raise ValueError("unknown devnode")
            resolved = str(Path(devnode).resolve(strict=True))
            if not resolved.startswith("/dev/") or self._mounted_or_system(resolved): raise ValueError("unsafe devnode")
            if verb == "smart.read": return ("smartctl", "-j", resolved)
            label = args["label"]
            if args["fs"] != "ext4" or not isinstance(label, str) or not _SAFE_LABEL.fullmatch(label): raise ValueError("invalid format arguments")
            return ("mkfs.ext4", "-F", "-L", label, resolved)
        if verb == "net.apply":
            args = _exact(args, {"interfaceName", "config"}); iface = args["interfaceName"]
            if iface != self.config.get("wiredInterface") or not _SAFE_IFACE.fullmatch(iface): raise ValueError("unknown interface")
            content = self._network_content(iface, args["config"])
            network_dir = Path(self.config.get("networkDirectory", "/etc/systemd/network"))
            target = network_dir / f"80-eduscope-{iface}.network"
            def write_network():
                network_dir.mkdir(parents=True, exist_ok=True)
                fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=network_dir, text=True)
                try:
                    with os.fdopen(fd, "w") as stream: stream.write(content); stream.flush(); os.fsync(stream.fileno())
                    os.chmod(temp_name, 0o644); os.replace(temp_name, target)
                    directory_fd = os.open(network_dir, os.O_DIRECTORY); os.fsync(directory_fd); os.close(directory_fd)
                finally:
                    try: os.unlink(temp_name)
                    except FileNotFoundError: pass
                for argv in (("networkctl", "reload"), ("networkctl", "reconfigure", iface)):
                    code, _, _ = self.runner(argv, VERB_TIMEOUT[verb])
                    if code: raise OSError("network operation failed")
                return "network configuration applied"
            return write_network
        raise ValueError("unknown verb")

    @staticmethod
    def _network_content(iface: str, config: Any) -> str:
        required = {"kind", "vlanId", "addressMode", "ipv4Address", "prefixLength", "gateway", "dnsServers"}
        config = _exact(config, required)
        if config["kind"] not in {"lan", "vlan"} or config["addressMode"] not in {"dhcp", "static"}: raise ValueError("invalid network mode")
        if config["kind"] == "lan" and config["vlanId"] is not None: raise ValueError("unexpected VLAN")
        if config["kind"] == "vlan" and (type(config["vlanId"]) is not int or not 1 <= config["vlanId"] <= 4094): raise ValueError("invalid VLAN")
        dns = config["dnsServers"]
        if not isinstance(dns, list) or any(not isinstance(x, str) for x in dns): raise ValueError("invalid DNS")
        for address in dns: ipaddress.IPv4Address(address)
        lines = ["[Match]", f"Name={iface}", "", "[Network]"]
        if config["addressMode"] == "dhcp":
            if any(config[k] is not None for k in ("ipv4Address", "prefixLength", "gateway")): raise ValueError("invalid DHCP config")
            lines.append("DHCP=ipv4")
        else:
            address = ipaddress.IPv4Address(config["ipv4Address"])
            prefix = config["prefixLength"]
            if type(prefix) is not int or not 0 <= prefix <= 32: raise ValueError("invalid prefix")
            gateway = ipaddress.IPv4Address(config["gateway"])
            lines += [f"Address={address}/{prefix}", f"Gateway={gateway}"]
        lines += [f"DNS={address}" for address in dns]
        return "\n".join(lines) + "\n"

    @staticmethod
    def _safe_detail(raw: str) -> str:
        if not raw: return "ok"
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            lowered = raw.lower()
            if any(word in lowered for word in ("password", "bearer", "streamkey", "stream_key", "credential")):
                return "operation completed"
            return raw[:4096]
        sensitive = ("password", "bearer", "streamkey", "stream_key", "credential")
        def redact(item):
            if isinstance(item, dict): return {key: "[REDACTED]" if any(word in key.lower() for word in sensitive) else redact(val) for key, val in item.items()}
            if isinstance(item, list): return [redact(entry) for entry in item]
            return item
        return json.dumps(redact(value), separators=(",", ":"))[:4096]

    @staticmethod
    def _mounted_or_system(devnode: str) -> bool:
        for line in Path("/proc/self/mountinfo").read_text().splitlines():
            fields = line.split()
            if "-" in fields and devnode in fields[fields.index("-") + 2:]: return True
        try:
            root = os.stat("/").st_dev
            return os.stat(devnode).st_rdev == root
        except OSError: return True

    def _take_rate_limit(self, verb: str) -> bool:
        limit, window = RATE_LIMITS[verb]; now = self.clock()
        try: state = json.loads(self.rate_limit_path.read_text())
        except (FileNotFoundError, json.JSONDecodeError, OSError): state = {}
        entries = [float(value) for value in state.get(verb, []) if now - float(value) < window]
        if len(entries) >= limit: return False
        entries.append(now); state[verb] = entries
        self.rate_limit_path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".rate-limits.", dir=self.rate_limit_path.parent, text=True)
        try:
            with os.fdopen(fd, "w") as stream: json.dump(state, stream, separators=(",", ":")); stream.flush(); os.fsync(stream.fileno())
            os.chmod(name, 0o600); os.replace(name, self.rate_limit_path)
        finally:
            try: os.unlink(name)
            except FileNotFoundError: pass
        return True

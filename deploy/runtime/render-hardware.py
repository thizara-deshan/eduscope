#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = {
    "etc/udev/rules.d/99-eduscope-capture.rules": ROOT / "deploy/udev/99-eduscope-capture.rules",
    "etc/udev/rules.d/99-eduscope-storage.rules": ROOT / "deploy/udev/99-eduscope-storage.rules",
    "etc/udev/rules.d/99-eduscope-touch.rules": ROOT / "deploy/udev/99-eduscope-touch.rules",
    "etc/alsa/conf.d/90-eduscope.conf": ROOT / "deploy/alsa/90-eduscope.conf",
    "run/eduscope/env/audio.env": ROOT / "deploy/alsa/eduscope-audio.env",
}
TOKEN = re.compile(r"@[A-Z0-9_]+@")
SAFE = re.compile(r"^[A-Za-z0-9_.:+ /-]+$")
CARD = re.compile(r"^(?=.*[A-Za-z])[A-Za-z0-9_-]+$")
SENTINEL = re.compile(r"TBC|TBD|TODO|CHANGEME|example\.com", re.I)

def required(value, name):
    if value is None or value == "" or isinstance(value, str) and SENTINEL.search(value):
        raise ValueError(f"{name} is unresolved")
    return value

def safe(value, name):
    value = str(required(value, name))
    if not SAFE.fullmatch(value):
        raise ValueError(f"{name} contains unsafe characters")
    return value

def pcm_device(value, name, card_id):
    match = re.fullmatch(r"hw:CARD=([A-Za-z0-9_-]+),DEV=([0-9]+)", str(required(value, name)))
    if not match:
        raise ValueError(f"{name} must use named-card ALSA syntax")
    if match.group(1) != card_id:
        raise ValueError(f"{name} card must match its stable card ID")
    return match.group(2)

def render_values(manifest, profile):
    capture, touch, audio = manifest["capture"], manifest["touch"], manifest["audio"]
    if capture.get("serial"):
        capture_match = f'ATTRS{{serial}}=="{safe(capture["serial"], "capture.serial")}"'
    elif capture.get("usbPortPath"):
        capture_match = f'KERNELS=="{safe(capture["usbPortPath"], "capture.usbPortPath")}*"'
    else:
        raise ValueError("capture serial or usbPortPath is required")
    touch_match = f'ATTRS{{serial}}=="{safe(touch["serial"], "touch.serial")}"' if touch.get("serial") else f'ATTRS{{name}}=="{safe(touch.get("name"), "touch.name")}"'
    mic = safe(audio.get("micCardId"), "audio.micCardId")
    hdmi = safe(audio.get("hdmi2CardId"), "audio.hdmi2CardId")
    if not CARD.fullmatch(mic) or not CARD.fullmatch(hdmi):
        raise ValueError("ALSA card IDs must be nonnumeric named card IDs")
    if (audio.get("format"), audio.get("rateHz"), audio.get("channels")) != ("S16LE", 48000, 2):
        raise ValueError("audio must be S16LE/48000/2")
    display_open = any(d.get(f) is None for d in manifest["displays"] for f in ("edidSha256", "observedConnector", "mode", "width", "height", "refreshHz")) or any(manifest["hdmiPassthrough"].get(f) is None for f in ("inputConnector", "outputConnector", "observedPath", "latencyMs"))
    storage_open = any(manifest["storage"].get(f) is None for f in ("recordingsUuid", "minBytes"))
    if profile == "production" and display_open:
        raise ValueError("display/passthrough acceptance open")
    if profile == "production" and storage_open:
        raise ValueError("recordings volume acceptance open")
    if display_open:
        print("display/passthrough acceptance open", file=sys.stderr)
    if storage_open:
        print("recordings volume acceptance open", file=sys.stderr)
    return {"@CAPTURE_V4L_INDEX@": str(capture["v4lIndex"]), "@CAPTURE_VID@": safe(capture["vid"], "capture.vid"), "@CAPTURE_PID@": safe(capture["pid"], "capture.pid"), "@CAPTURE_STABLE_MATCH@": capture_match, "@TOUCH_VID@": safe(touch["vid"], "touch.vid"), "@TOUCH_PID@": safe(touch["pid"], "touch.pid"), "@TOUCH_STABLE_MATCH@": touch_match, "@MIC_CARD_ID@": mic, "@MIC_PCM_DEVICE@": pcm_device(audio.get("micPcmDevice"), "audio.micPcmDevice", mic), "@MIC_CONTROL@": safe(audio.get("micControl"), "audio.micControl"), "@HDMI2_CARD_ID@": hdmi, "@HDMI2_PCM_DEVICE@": pcm_device(audio.get("hdmi2PcmDevice"), "audio.hdmi2PcmDevice", hdmi)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--profile", choices=("production", "demo-staging"), default="production")
    parser.add_argument("--runtime-only", action="store_true")
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text())
        schema = json.loads((ROOT / "deploy/provisioning/device-manifest.schema.json").read_text())
        jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(manifest)
        values = render_values(manifest, args.profile)
        for destination, source in TEMPLATES.items():
            if args.runtime_only and destination != "run/eduscope/env/audio.env":
                continue
            content = source.read_text()
            for token, value in values.items():
                content = content.replace(token, value)
            if TOKEN.search(content):
                raise ValueError(f"unresolved token in {source.name}")
            target = args.output_root / ("env/audio.env" if args.runtime_only else destination)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.is_symlink():
                raise ValueError(f"refusing symlink output: {target}")
            temporary = target.with_name(f".{target.name}.{os.getpid()}")
            temporary.write_text(content)
            os.chmod(temporary, 0o640 if target.name == "audio.env" else 0o644)
            os.replace(temporary, target)
    except (OSError, ValueError, KeyError, json.JSONDecodeError, jsonschema.ValidationError) as error:
        print(f"render-hardware: {error}", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

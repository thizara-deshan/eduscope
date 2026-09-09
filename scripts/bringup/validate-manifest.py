#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path

import jsonschema


SENTINEL = re.compile(r"TBC|TBD|TODO|CHANGEME|example\.com", re.IGNORECASE)


def walk_strings(value, path=()):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk_strings(child, path + (key,))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_strings(child, path + (index,))
    elif isinstance(value, str):
        yield path, value


def display_path(path):
    return ".".join(str(part) for part in path) or "$"


def cross_field_errors(manifest, deployable):
    displays = manifest.get("displays", [])
    roles = [display.get("role") for display in displays if isinstance(display, dict)]
    if len(roles) != len(set(roles)) or set(roles) != {"projector", "meeting", "panel"}:
        yield "displays: roles must be exactly projector, meeting, and panel"
    edids = [display.get("edidSha256") for display in displays if isinstance(display, dict) and display.get("edidSha256") is not None]
    if len(edids) != len(set(edids)):
        yield "displays: edidSha256 values must be unique"
    connectors = [display.get("observedConnector") for display in displays if isinstance(display, dict) and display.get("observedConnector") is not None]
    if len(connectors) != len(set(connectors)):
        yield "displays: observedConnector values must be unique"
    audio = manifest.get("audio", {})
    if audio.get("hdmi2CardId") is not None and audio.get("micCardId") == audio.get("hdmi2CardId"):
        yield "audio: micCardId and hdmi2CardId must be unique"
    capture = manifest.get("capture", {})
    touch = manifest.get("touch", {})
    capture_identity = tuple(capture.get(key) for key in ("vid", "pid", "serial"))
    touch_identity = tuple(touch.get(key) for key in ("vid", "pid", "serial"))
    if capture_identity == touch_identity:
        yield "touch: USB identity duplicates capture"
    if deployable:
        for path, value in walk_strings(manifest):
            if not value:
                yield f"{display_path(path)}: empty strings are not deployable"
            elif SENTINEL.search(value):
                yield f"{display_path(path)}: unresolved sentinel or example domain"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--deployable", action="store_true")
    args = parser.parse_args()
    schema_path = Path(__file__).resolve().parents[2] / "deploy/provisioning/device-manifest.schema.json"
    try:
        manifest = json.loads(args.manifest.read_text())
        schema = json.loads(schema_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(f"$: {error}", file=sys.stderr)
        return 1
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
    errors = [f"{display_path(error.absolute_path)}: {error.message}" for error in validator.iter_errors(manifest)]
    errors.extend(cross_field_errors(manifest, args.deployable))
    if errors:
        for error in sorted(set(errors)):
            print(error, file=sys.stderr)
        return 1
    print("PASS device manifest")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).parents[2]
SCRIPT = ROOT / "deploy/kiosk/xrandr-layout.sh"
FIXTURE = ROOT / "deploy/tests/fixtures/xrandr-three-displays.txt"


class XrandrLayoutTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.calls = self.root / "calls"
        bindir = self.root / "bin"
        bindir.mkdir()
        for name in ("xrandr", "xinput"):
            path = bindir / name
            path.write_text('#!/usr/bin/env bash\nprintf "%s" "$1" >>"$CALLS"\nshift\nprintf " <%s>" "$@" >>"$CALLS"\nprintf "\\n" >>"$CALLS"\n')
            path.chmod(0o755)
        self.env = os.environ | {"PATH": f"{bindir}:{os.environ['PATH']}", "CALLS": str(self.calls)}

    def tearDown(self):
        self.temp.cleanup()

    def manifest(self):
        hashes = [hashlib.sha256(name.encode()).hexdigest() for name in ("projector", "meeting", "panel")]
        data = {"displays": [
            {"role": "projector", "edidSha256": hashes[0], "mode": "1920x1080", "width": 1920},
            {"role": "meeting", "edidSha256": hashes[1], "mode": "1920x1080", "width": 1920},
            {"role": "panel", "edidSha256": hashes[2], "mode": "1280x800", "width": 1280},
        ], "touch": {"name": "HID 27c0:0818"}}
        path = self.root / "manifest.json"
        path.write_text(json.dumps(data))
        return path

    def run_layout(self, fixture=FIXTURE, *extra):
        return subprocess.run([str(SCRIPT), "--manifest", str(self.manifest()), "--xrandr-fixture", str(fixture), *extra], text=True, capture_output=True, env=self.env)

    def test_reordered_connectors_use_stable_edids_and_exact_positions(self):
        result = self.run_layout()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual([
            "--output <DP-2> <--mode> <1920x1080> <--pos> <0x0> <--output> <HDMI-2> <--mode> <1920x1080> <--pos> <1920x0> <--output> <HDMI-1> <--mode> <1280x800> <--pos> <3840x0> <--primary> <--output> <DP-1> <--off>",
            "map-to-output <HID 27c0:0818> <HDMI-1>",
        ], self.calls.read_text().splitlines())

    def test_missing_or_duplicate_topology_is_safe(self):
        bad = self.root / "bad.txt"
        bad.write_text("HDMI-1 connected 1280x800+0+0\n")
        result = self.run_layout(bad)
        self.assertEqual(78, result.returncode)
        self.assertFalse(self.calls.exists())
        self.assertIn("observed", result.stderr)

        duplicate = self.root / "duplicate.txt"
        duplicate.write_text(FIXTURE.read_text() + "DP-3 connected 1280x800+0+0\n\tEDID:\n\t\t70616e656c\n")
        result = self.run_layout(duplicate)
        self.assertEqual(78, result.returncode)
        self.assertFalse(self.calls.exists())

    def test_demo_requires_hdmi_1_and_reports_open_acceptance(self):
        fixture = self.root / "demo.txt"
        fixture.write_text("HDMI-1 connected primary 1280x800+0+0\n")
        result = self.run_layout(fixture, "--profile", "demo-staging")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("multi-display acceptance open", result.stdout)
        self.assertEqual([
            "--output <HDMI-1> <--mode> <1280x800> <--pos> <0x0> <--primary>",
            "map-to-output <HID 27c0:0818> <HDMI-1>",
        ], self.calls.read_text().splitlines())


if __name__ == "__main__":
    unittest.main()

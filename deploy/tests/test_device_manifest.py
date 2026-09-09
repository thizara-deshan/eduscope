import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import jsonschema


ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "deploy/provisioning/device-manifest.schema.json"
EXAMPLE_PATH = ROOT / "deploy/provisioning/device-manifest.example.json"
VALIDATOR_PATH = ROOT / "scripts/bringup/validate-manifest.py"


class DeviceManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = json.loads(SCHEMA_PATH.read_text())
        cls.example = json.loads(EXAMPLE_PATH.read_text())
        jsonschema.Draft202012Validator.check_schema(cls.schema)

    def validate_schema(self, manifest):
        jsonschema.Draft202012Validator(self.schema).validate(manifest)

    def run_validator(self, manifest, deployable=False):
        with tempfile.NamedTemporaryFile("w", suffix=".json") as handle:
            json.dump(manifest, handle)
            handle.flush()
            command = [sys.executable, str(VALIDATOR_PATH), handle.name]
            if deployable:
                command.append("--deployable")
            return subprocess.run(command, text=True, capture_output=True, check=False)

    def test_example_is_schema_version_one_and_valid(self):
        self.validate_schema(self.example)
        self.assertEqual(1, self.example["schemaVersion"])
        self.assertEqual(
            {
                "schemaVersion", "image", "board", "capture", "audio", "displays",
                "touch", "hdmiPassthrough", "storage", "network", "led",
                "integrations", "chromium",
            },
            set(self.example),
        )

    def test_fixed_audio_panel_and_display_roles(self):
        self.assertEqual({"projector", "meeting", "panel"}, {d["role"] for d in self.example["displays"]})
        self.assertEqual(("S16LE", 48000, 2), tuple(self.example["audio"][key] for key in ("format", "rateHz", "channels")))
        panel = next(display for display in self.example["displays"] if display["role"] == "panel")
        self.assertEqual((1280, 800), (panel["width"], panel["height"]))
        self.assertEqual("ext4", self.example["storage"]["filesystem"])
        self.assertFalse(self.example["chromium"]["forceHardwareAcceleration"])

        invalid_panel = copy.deepcopy(self.example)
        panel = next(display for display in invalid_panel["displays"] if display["role"] == "panel")
        panel.update(width=1920, height=1080)
        with self.assertRaises(jsonschema.ValidationError):
            self.validate_schema(invalid_panel)

    def test_schema_rejects_bad_strict_formats_and_numeric_alsa_ids(self):
        mutations = [
            ("image", "sha256", "abc"),
            ("capture", "vid", "xyz1"),
            ("capture", "pid", "123"),
            ("storage", "recordingsUuid", "not-a-uuid"),
            ("audio", "micCardId", "1"),
            ("audio", "hdmi2CardId", "2"),
            ("capture", "videoByPath", "/dev/video0"),
        ]
        for section, key, value in mutations:
            with self.subTest(section=section, key=key):
                manifest = copy.deepcopy(self.example)
                manifest[section][key] = value
                with self.assertRaises(jsonschema.ValidationError):
                    self.validate_schema(manifest)

    def test_validator_rejects_duplicate_identities(self):
        mutations = []
        duplicate_edid = copy.deepcopy(self.example)
        duplicate_edid["displays"][1]["edidSha256"] = duplicate_edid["displays"][0]["edidSha256"]
        mutations.append(duplicate_edid)
        duplicate_role = copy.deepcopy(self.example)
        duplicate_role["displays"][1]["role"] = duplicate_role["displays"][0]["role"]
        mutations.append(duplicate_role)
        duplicate_usb = copy.deepcopy(self.example)
        duplicate_usb["touch"].update({key: duplicate_usb["capture"][key] for key in ("vid", "pid", "serial")})
        mutations.append(duplicate_usb)
        duplicate_alsa = copy.deepcopy(self.example)
        duplicate_alsa["audio"]["hdmi2CardId"] = duplicate_alsa["audio"]["micCardId"]
        mutations.append(duplicate_alsa)
        for manifest in mutations:
            with self.subTest(manifest=manifest):
                self.assertNotEqual(0, self.run_validator(manifest).returncode)

    def test_deployable_rejects_sentinels_empty_and_example_domains(self):
        for value in ("", "TBC", "TBD", "TODO", "CHANGEME", "host.example.com"):
            manifest = copy.deepcopy(self.example)
            manifest["integrations"]["hallCode"] = value
            with self.subTest(value=value):
                self.assertNotEqual(0, self.run_validator(manifest, deployable=True).returncode)

    def test_deployable_allows_deferred_image_provenance_only(self):
        manifest = copy.deepcopy(self.example)
        manifest["image"].update(name=None, sourceUrl=None, sha256=None)
        result = self.run_validator(manifest, deployable=True)
        self.assertEqual(0, result.returncode, result.stderr)

    def test_deployable_allows_hardware_explicitly_deferred_to_f04(self):
        manifest = copy.deepcopy(self.example)
        for display in manifest["displays"]:
            for key in ("edidSha256", "observedConnector", "mode", "width", "height", "refreshHz"):
                display[key] = None
        for key in manifest["hdmiPassthrough"]:
            manifest["hdmiPassthrough"][key] = None
        manifest["audio"].update(hdmi2CardId=None, hdmi2PcmDevice=None)
        manifest["storage"].update(recordingsUuid=None, minBytes=None)
        result = self.run_validator(manifest, deployable=True)
        self.assertEqual(0, result.returncode, result.stderr)

    def test_validator_prints_pass(self):
        result = self.run_validator(self.example)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("PASS device manifest\n", result.stdout)


if __name__ == "__main__":
    unittest.main()

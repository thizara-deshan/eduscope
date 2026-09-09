import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).parents[2]
RENDERER = ROOT / "deploy/runtime/render-hardware.py"
EXAMPLE = ROOT / "deploy/provisioning/device-manifest.example.json"

class UdevRulesTest(unittest.TestCase):
    def render(self, manifest, profile="production", runtime_only=False):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = pathlib.Path(temp.name)
        source = root / "manifest.json"
        source.write_text(json.dumps(manifest))
        command = ["python3", str(RENDERER), "--profile", profile, "--manifest", str(source), "--output-root", str(root / "out")]
        if runtime_only:
            command.append("--runtime-only")
        return subprocess.run(command, capture_output=True, text=True), root / "out"

    def test_exact_capture_storage_and_touch_rules(self):
        result, root = self.render(json.loads(EXAMPLE.read_text()))
        self.assertEqual(result.returncode, 0, result.stderr)
        capture = (root / "etc/udev/rules.d/99-eduscope-capture.rules").read_text()
        for value in ('ATTR{index}=="0"', 'ATTRS{idVendor}=="534d"', 'ATTRS{idProduct}=="2109"', 'ATTRS{serial}=="example-capture-0001"'):
            self.assertIn(value, capture)
        self.assertEqual(capture.count('SYMLINK+="eduscope/pc-capture"'), 1)
        self.assertNotIn('MODE="0666"', capture)
        storage = (root / "etc/udev/rules.d/99-eduscope-storage.rules").read_text()
        self.assertIn('ENV{EDUSCOPE_STORAGE_CANDIDATE}="1"', storage)
        self.assertNotIn("RUN+=", storage)
        touch = (root / "etc/udev/rules.d/99-eduscope-touch.rules").read_text()
        self.assertIn('ATTRS{name}=="ILITEK Multi-Touch-V3000"', touch)
        self.assertIn('OWNER="eduscope-kiosk", MODE="0600"', touch)

    def test_port_fallback_and_runtime_only(self):
        manifest = json.loads(EXAMPLE.read_text())
        manifest["capture"]["serial"] = None
        result, root = self.render(manifest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('KERNELS=="platform-xhci-hcd.5.auto-usb-0:1.2*"', (root / "etc/udev/rules.d/99-eduscope-capture.rules").read_text())
        result, root = self.render(manifest, runtime_only=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((root / "etc").exists())
        self.assertTrue((root / "env/audio.env").is_file())

if __name__ == "__main__":
    unittest.main()

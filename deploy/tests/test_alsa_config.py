import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).parents[2]
RENDERER = ROOT / "deploy/runtime/render-hardware.py"
EXAMPLE = ROOT / "deploy/provisioning/device-manifest.example.json"

class AlsaConfigTest(unittest.TestCase):
    def render(self, manifest, profile="production"):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = pathlib.Path(temp.name)
        source = root / "manifest.json"
        source.write_text(json.dumps(manifest))
        result = subprocess.run(["python3", str(RENDERER), "--profile", profile, "--manifest", str(source), "--output-root", str(root / "out")], capture_output=True, text=True)
        return result, root / "out"

    def test_named_cards_format_hints_and_environment(self):
        result, root = self.render(json.loads(EXAMPLE.read_text()))
        self.assertEqual(result.returncode, 0, result.stderr)
        config = (root / "etc/alsa/conf.d/90-eduscope.conf").read_text()
        self.assertIn('hw:CARD=USBMic,DEV=0', config)
        self.assertIn('hw:CARD=rockchiphdmi1,DEV=0', config)
        self.assertEqual(config.count("hint { show on;"), 2)
        self.assertEqual(config.count("slave.format S16_LE"), 2)
        self.assertEqual(config.count("slave.rate 48000"), 2)
        self.assertEqual(config.count("slave.channels 2"), 2)
        env = (root / "run/eduscope/env/audio.env").read_text()
        self.assertIn("EDUSCOPE_AUDIO_FORMAT=S16LE\nEDUSCOPE_AUDIO_RATE_HZ=48000\nEDUSCOPE_AUDIO_CHANNELS=2\n", env)

    def test_rejections_and_demo_deferrals(self):
        for field, value in (("micCardId", "2"), ("hdmi2CardId", "1"), ("micControl", "TBD")):
            manifest = json.loads(EXAMPLE.read_text())
            manifest["audio"][field] = value
            result, _ = self.render(manifest)
            self.assertNotEqual(result.returncode, 0)
        manifest = json.loads(EXAMPLE.read_text())
        manifest["audio"]["micPcmDevice"] = "hw:CARD=OtherMic,DEV=0"
        result, _ = self.render(manifest)
        self.assertNotEqual(result.returncode, 0)
        manifest = json.loads(EXAMPLE.read_text())
        manifest["displays"][0]["edidSha256"] = None
        manifest["hdmiPassthrough"]["observedPath"] = None
        manifest["storage"]["recordingsUuid"] = None
        result, _ = self.render(manifest)
        self.assertNotEqual(result.returncode, 0)
        result, _ = self.render(manifest, "demo-staging")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("display/passthrough acceptance open", result.stderr)
        self.assertIn("recordings volume acceptance open", result.stderr)
        manifest["audio"]["hdmi2CardId"] = None
        result, _ = self.render(manifest, "demo-staging")
        self.assertNotEqual(result.returncode, 0)

if __name__ == "__main__":
    unittest.main()

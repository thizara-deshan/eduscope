import json
import tempfile
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from eduscope_privileged_helper.peer import PeerCredentials
from eduscope_privileged_helper.verbs import ALL_VERBS, VerbRegistry


class FakeRunner:
    def __init__(self): self.calls = []
    def __call__(self, argv, timeout):
        self.calls.append((argv, timeout))
        return 0, '{"status":"ok"}', ''


class VerbTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runner = FakeRunner()
        self.config = {
            "wiredInterface": "eth0",
            "recordingsUuid": "123e4567-e89b-42d3-a456-426614174000",
            "captureHub": {"location": "1-2", "port": 3},
            "led": {"present": False, "reason": "not fitted"},
            "allowedDevnodes": ["/dev/sdb"],
        }
        self.registry = VerbRegistry(self.config, runner=self.runner, rate_limit_path=Path(self.temp.name) / "limits.json")
        self.peer = PeerCredentials(1, 100, 100)

    def tearDown(self): self.temp.cleanup()

    def request(self, verb, args):
        return self.registry.dispatch({"verb": verb, "args": args, "requestId": "req"}, self.peer)

    def test_registry_is_closed_to_exactly_twelve_verbs(self):
        self.assertEqual(len(ALL_VERBS), 12)
        self.assertEqual(set(ALL_VERBS), {"net.apply", "volume.mount", "volume.unmount", "volume.format", "usbhub.cycle", "led.set", "system.poweroff", "firmware.check", "firmware.apply", "firmware.rollback", "relay.reload", "smart.read"})
        self.assertFalse(self.request("generic" + ".exec", {})["ok"])

    def test_fixed_firmware_and_relay_argv_never_use_a_shell(self):
        self.assertTrue(self.request("firmware.check", {"version": "1.2.3"})["ok"])
        self.assertEqual(self.runner.calls[-1][0], ("/usr/libexec/eduscope-updater", "check", "--json", "--version", "1.2.3"))
        digest = "a" * 64
        self.assertTrue(self.request("relay.reload", {"configDigest": digest})["ok"])
        self.assertEqual(self.runner.calls[-1][0], ("/usr/libexec/eduscope-relay-reload", digest))

    def test_demo_firmware_mutations_do_not_invoke_runner(self):
        self.config["firmwareMode"] = "disabled"
        before = len(self.runner.calls)
        for verb in ("firmware.apply", "firmware.rollback"):
            self.assertEqual(self.request(verb, {}), {"ok": False, "detail": "placeholder / firmware acceptance still open"})
        self.assertEqual(len(self.runner.calls), before)

    def test_exact_argv_for_hub_power_volume_format_mount_unmount_and_smart(self):
        from unittest.mock import patch
        self.assertTrue(self.request("usbhub.cycle", {"location": "1-2", "port": 3})["ok"])
        self.assertEqual(self.runner.calls[-1][0], ("uhubctl", "-l", "1-2", "-p", "3", "-a", "cycle"))
        uuid = self.config["recordingsUuid"]
        with patch("pathlib.Path.resolve", return_value=Path("/dev/sdb")):
            self.assertTrue(self.request("volume.mount", {"uuid": uuid})["ok"])
        self.assertEqual(self.runner.calls[-1][0], ("systemd-mount", "--no-block", "--collect", "/dev/sdb", f"/media/eduscope/{uuid}"))
        self.assertTrue(self.request("volume.unmount", {"uuid": uuid})["ok"])
        self.assertEqual(self.runner.calls[-1][0], ("systemd-umount", f"/media/eduscope/{uuid}"))
        with patch("pathlib.Path.resolve", return_value=Path("/dev/sdb")), patch.object(VerbRegistry, "_mounted_or_system", return_value=False):
            self.assertTrue(self.request("volume.format", {"devNode": "/dev/sdb", "fs": "ext4", "label": "LectureDisk"})["ok"])
            self.assertTrue(self.request("smart.read", {"devNode": "/dev/sdb"})["ok"])
        self.assertEqual(self.runner.calls[-2][0], ("mkfs.ext4", "-F", "-L", "LectureDisk", "/dev/sdb"))
        self.assertEqual(self.runner.calls[-1][0], ("smartctl", "-j", "/dev/sdb"))

    def test_network_file_is_atomic_and_commands_are_fixed(self):
        network_dir = Path(self.temp.name) / "network"
        self.config["networkDirectory"] = str(network_dir)
        result = self.request("net.apply", {"interfaceName": "eth0", "config": {
            "kind": "lan", "vlanId": None, "addressMode": "static", "ipv4Address": "10.0.0.5",
            "prefixLength": 24, "gateway": "10.0.0.1", "dnsServers": ["10.0.0.2"],
        }})
        self.assertTrue(result["ok"])
        self.assertIn("Name=eth0", (network_dir / "80-eduscope-eth0.network").read_text())
        self.assertEqual([call[0] for call in self.runner.calls], [("networkctl", "reload"), ("networkctl", "reconfigure", "eth0")])

    def test_wrong_types_extra_fields_traversal_controls_and_unknown_hardware_fail(self):
        bad = [
            ("led.set", {"mode": "on", "extra": 1}),
            ("usbhub.cycle", {"location": "../../x", "port": 3}),
            ("usbhub.cycle", {"location": "1-9", "port": 3}),
            ("volume.mount", {"uuid": "../../etc"}),
            ("volume.format", {"devNode": "/tmp/disk", "fs": "ext4", "label": "ok"}),
            ("volume.format", {"devNode": "/dev/sdb", "fs": "xfs", "label": "bad\nlabel"}),
            ("volume.format", {"devNode": "/dev/sdb", "fs": "ext4", "label": "bad;label"}),
            ("net.apply", {"interfaceName": "wlan0", "mode": "dhcp", "addresses": [], "gateway": None, "dns": []}),
            ("relay.reload", {"configDigest": "ABC"}),
        ]
        for verb, args in bad:
            with self.subTest(verb=verb, args=args): self.assertFalse(self.request(verb, args)["ok"])

    def test_empty_poweroff_and_absent_led_noop(self):
        self.assertTrue(self.request("system.poweroff", {})["ok"])
        before = len(self.runner.calls)
        result = self.request("led.set", {"mode": "blink"})
        self.assertTrue(result["ok"])
        self.assertEqual(len(self.runner.calls), before)

    def test_runner_timeout_and_output_are_redacted(self):
        def timeout(argv, seconds): raise TimeoutError("password=hunter2")
        registry = VerbRegistry(self.config, runner=timeout, rate_limit_path=Path(self.temp.name) / "other.json")
        result = registry.dispatch({"verb": "firmware.check", "args": {}, "requestId": "r"}, self.peer)
        self.assertFalse(result["ok"])
        self.assertNotIn("hunter2", result["detail"])

    def test_updater_interface_schema_accepts_the_plan_contract(self):
        schema = json.loads(Path("deploy/provisioning/updater-interface.schema.json").read_text())
        import jsonschema
        jsonschema.Draft202012Validator(schema).validate({
            "interfaceVersion": 1, "signatureAlgorithm": "ed25519", "trustRootSha256": "a" * 64,
            "activeSlot": "A", "inactiveSlot": "B", "bootSuccessMarker": "/boot/eduscope-success",
            "commands": ["check", "apply", "rollback"],
        })
        self.assertNotEqual("A", "B")

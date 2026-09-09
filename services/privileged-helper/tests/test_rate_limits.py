import tempfile
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from eduscope_privileged_helper.peer import PeerCredentials
from eduscope_privileged_helper.verbs import VerbRegistry


class RateLimitTests(unittest.TestCase):
    def test_rolling_limit_is_per_verb_and_persisted(self):
        with tempfile.TemporaryDirectory() as directory:
            now = [1000.0]
            registry = VerbRegistry(
                {"wiredInterface": "eth0", "recordingsUuid": None, "captureHub": {"location": "1-2", "port": 3}, "led": {"present": False, "reason": "none"}, "allowedDevnodes": []},
                runner=lambda argv, timeout: (0, "ok", ""), clock=lambda: now[0],
                rate_limit_path=Path(directory) / "limits.json",
            )
            peer = PeerCredentials(1, 100, 100)
            req = {"verb": "system.poweroff", "args": {}, "requestId": "r"}
            self.assertTrue(registry.dispatch(req, peer)["ok"])
            self.assertFalse(registry.dispatch(req, peer)["ok"])
            self.assertTrue((Path(directory) / "limits.json").is_file())
            now[0] += 61
            self.assertTrue(registry.dispatch(req, peer)["ok"])

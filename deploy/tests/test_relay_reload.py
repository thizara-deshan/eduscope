import hashlib
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location("relay_reload", ROOT / "deploy/relay/reload.py")


class RelayReloadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.module)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        self.candidate = root / "candidate.json"
        self.nginx = root / "nginx-push.conf"
        self.stunnel = root / "stunnel.conf"
        self.template = ROOT / "deploy/stunnel/eduscope.conf.template"

    def tearDown(self):
        self.temp.cleanup()

    def write_candidate(self, targets):
        raw = json.dumps({"version": 1, "targets": targets}, separators=(",", ":")).encode()
        self.candidate.write_bytes(raw)
        os.chmod(self.candidate, 0o600)
        return hashlib.sha256(raw).hexdigest()

    def promote(self, digest, runner=None):
        return self.module.promote(
            digest,
            candidate_path=self.candidate,
            nginx_path=self.nginx,
            stunnel_path=self.stunnel,
            stunnel_template_path=self.template,
            expected_uid=os.getuid(),
            runner=runner or (lambda _argv: None),
        )

    def test_deterministic_direct_and_tls_routes_and_atomic_promotion(self):
        digest = self.write_candidate([
            {"id": "plain", "platform": "custom-rtmp", "ingestUrl": "rtmp://relay.invalid/live", "streamKey": "plain-key", "requiresTlsBridge": False},
            {"id": "secure", "platform": "youtube", "ingestUrl": "rtmps://secure.invalid:443/live", "streamKey": "secure-key", "requiresTlsBridge": True},
        ])
        self.promote(digest)
        self.assertEqual(self.nginx.stat().st_mode & 0o777, 0o600)
        self.assertIn("push rtmp://relay.invalid/live/plain-key;", self.nginx.read_text())
        self.assertIn("push rtmp://127.0.0.1:19400/live/secure-key;", self.nginx.read_text())
        tunnel = self.stunnel.read_text()
        self.assertIn("[target-secure]", tunnel)
        self.assertIn("accept = 127.0.0.1:19400", tunnel)
        self.assertIn("connect = secure.invalid:443", tunnel)
        self.assertNotIn("@SERVICE_SECTIONS@", tunnel)

    def test_rejects_symlink_digest_mismatch_and_invalid_secret_url(self):
        digest = self.write_candidate([])
        real = self.candidate.with_name("real.json")
        self.candidate.rename(real)
        self.candidate.symlink_to(real)
        with self.assertRaisesRegex(ValueError, "candidate"):
            self.promote(digest)
        self.candidate.unlink()
        self.candidate = real
        with self.assertRaisesRegex(ValueError, "digest"):
            self.promote("0" * 64)
        bad = self.write_candidate([{"id": "bad", "platform": "custom-rtmp", "ingestUrl": "rtmp://user:pass@relay.invalid/live?q=x", "streamKey": "key", "requiresTlsBridge": False}])
        with self.assertRaisesRegex(ValueError, "target"):
            self.promote(bad)

    def test_validation_or_reload_failure_preserves_prior_active_files(self):
        self.nginx.write_text("old nginx\n")
        self.stunnel.write_text("old stunnel\n")
        digest = self.write_candidate([])

        def fail_reload(argv):
            if argv == ("systemctl", "reload", "nginx.service"):
                raise RuntimeError("reload failed")

        with self.assertRaisesRegex(RuntimeError, "reload failed"):
            self.promote(digest, fail_reload)
        self.assertEqual(self.nginx.read_text(), "old nginx\n")
        self.assertEqual(self.stunnel.read_text(), "old stunnel\n")

    def test_helper_uses_only_fixed_reloader(self):
        body = (ROOT / "services/privileged-helper/src/eduscope_privileged_helper/verbs.py").read_text()
        self.assertIn('(\"/usr/libexec/eduscope-relay-reload\", digest)', body)


if __name__ == "__main__":
    unittest.main()

import json
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).parents[2]
RENDERER = ROOT / "deploy/runtime/render.py"
MANIFEST = ROOT / "deploy/provisioning/device-manifest.example.json"


class RuntimeRenderTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.secret_values = {"internalBearer": "i" * 32, "jwtSecret": "j" * 32, "secretboxKey": "s" * 32, "quizDeviceCredential": None}
        self.provisioning_values = {"version": 1, "deviceId": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "instituteProfileId": "campus-default", "hallDisplayName": "Lecture Hall F1301", "featureFlags": {"recordingEnabled": True, "aiQuizEnabled": False, "streamingEnabled": False}, "provisionedAt": "2026-09-10T00:00:00Z", "provisionedBy": "F-03", "rtsp": {"lecturer-cam": "rtsp://10.20.30.41/stream1", "students-cam": "rtsp://10.20.30.42/stream1"}, "bootstrapAdmin": {"username": "device-admin", "displayName": "Device Administrator"}}

    def tearDown(self):
        self.temp.cleanup()

    def module(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("runtime_render", RENDERER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def rendered(self):
        return self.module().render(json.loads(MANIFEST.read_text()), self.provisioning_values, self.secret_values, "production")

    def test_renders_exact_public_config_and_secret_safe_service_envs(self):
        files = self.rendered()
        public = json.loads(files["config.json"][0])
        self.assertEqual(public, {"apiBaseUrl": "/api/v1", "quizBaseUrl": "https://quiz.campus.invalid", "environment": "production", "adapters": {"default": "real", "overrides": {}}, "deploymentProfile": "production", "notices": []})
        serialized = json.dumps(public)
        self.assertNotIn("i" * 32, serialized)
        self.assertIn("CORE_API_RECORDINGS_ROOT=/media/eduscope", files["env/core.env"][0])
        self.assertIn("CORE_API_DEVICE_BOOTSTRAP_PATH=/run/eduscope/device-bootstrap.json", files["env/core.env"][0])
        self.assertIn("EDUSCOPE_PM_RECORDINGS_ROOT=/media/eduscope", files["env/pipeline.env"][0])
        self.assertIn("EDUSCOPE_SLIDE_RECORDINGS_ROOT=/media/eduscope", files["env/slide.env"][0])
        provisioned = json.loads(files["provisioning.json"][0])
        self.assertEqual(provisioned["hallCode"], "F1301")
        self.assertNotIn("rtsp", provisioned)

    def test_check_validates_without_writing(self):
        files = self.rendered()
        self.assertTrue(files)
        self.assertFalse((self.root / "out").exists())

    def test_allows_private_http_llm_only_for_demo_staging(self):
        module = self.module()
        manifest = json.loads(MANIFEST.read_text())
        manifest["integrations"]["llmEndpoint"] = "http://192.168.8.103:5000"
        files = module.render(manifest, self.provisioning_values, self.secret_values, "demo-staging")
        self.assertEqual(json.loads(files["provisioning.json"][0])["llmEndpoint"], "http://192.168.8.103:5000")
        with self.assertRaisesRegex(ValueError, "production requires HTTPS"):
            module.render(manifest, self.provisioning_values, self.secret_values, "production")

        manifest["integrations"]["llmEndpoint"] = "http://8.8.8.8:5000"
        with self.assertRaisesRegex(ValueError, "private IP"):
            module.render(manifest, self.provisioning_values, self.secret_values, "demo-staging")

    def test_public_config_is_written_to_a_separate_public_root(self):
        module = self.module()
        runtime = self.root / "runtime"
        public = self.root / "public"
        files = self.rendered()
        public_file = {
            "config.json": (
                files["config.json"][0],
                0o644,
                (os.getuid(), os.getgid()),
            )
        }
        module._write_outputs(public_file, runtime, public)
        self.assertEqual(
            json.loads((public / "config.json").read_text()),
            json.loads(files["config.json"][0]),
        )
        self.assertEqual((public / "config.json").stat().st_mode & 0o777, 0o644)
        self.assertFalse((public / "device-bootstrap.json").exists())

    def test_rejects_short_secrets_symlinks_and_broad_modes(self):
        module = self.module()
        unsafe = self.root / "unsafe.json"
        unsafe.write_text(json.dumps({"internalBearer": "short", "jwtSecret": "j" * 32, "secretboxKey": "s" * 32, "quizDeviceCredential": None}))
        os.chmod(unsafe, 0o666)
        with self.assertRaises(ValueError):
            module._load(unsafe, ROOT / "deploy/provisioning/secrets.schema.json", required_uid=os.getuid())
        unsafe.unlink()
        unsafe.symlink_to(MANIFEST)
        with self.assertRaises(ValueError):
            module._load(unsafe, ROOT / "deploy/provisioning/secrets.schema.json", required_uid=os.getuid())

    def test_refuses_symlink_output_and_replaces_files_atomically(self):
        output = self.root / "out"
        output.mkdir()
        (output / "env").mkdir()
        victim = self.root / "victim"
        victim.write_text("unchanged")
        (output / "config.json").symlink_to(victim)
        module = self.module()
        with self.assertRaises(ValueError):
            module._atomic_write(output, "config.json", "changed", 0o644, os.getuid(), os.getgid())
        self.assertEqual(victim.read_text(), "unchanged")


if __name__ == "__main__":
    unittest.main()

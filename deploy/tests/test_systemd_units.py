import configparser
import pathlib
import stat
import unittest


ROOT = pathlib.Path(__file__).parents[2]
UNIT_DIR = ROOT / "deploy/systemd"


class SystemdUnitsTest(unittest.TestCase):
    services = {
        "eduscope-helper.service",
        "eduscope-runtime-config.service",
        "eduscope-pipeline-manager.service",
        "eduscope-core-api.service",
        "eduscope-stt.service",
        "eduscope-slide.service",
        "eduscope-question.service",
        "eduscope-kiosk.service",
        "eduscope-stunnel.service",
    }

    def read(self, name):
        return (UNIT_DIR / name).read_text()

    def test_inventory_exists(self):
        expected = self.services | {
            "media-eduscope.mount.template",
            "eduscope-helper.socket",
            "wait-http.py",
            "nginx.service.d/eduscope.conf",
        }
        self.assertEqual(expected, {str(path.relative_to(UNIT_DIR)) for path in UNIT_DIR.rglob("*") if path.is_file()})

    def test_privilege_restart_and_no_shell(self):
        for name in self.services:
            body = self.read(name)
            if name in {"eduscope-helper.service", "eduscope-runtime-config.service"}:
                self.assertIn("User=root", body)
            else:
                self.assertNotIn("User=root", body)
                self.assertIn("Restart=on-failure", body)
            self.assertNotRegex(body, r"(?im)(sudo|/bin/(ba)?sh|shell\s*=)")
        socket = self.read("eduscope-helper.socket")
        for value in ("SocketUser=root", "SocketGroup=eduscope", "SocketMode=0660"):
            self.assertIn(value, socket)

    def test_dependency_boundaries(self):
        mount = self.read("media-eduscope.mount.template")
        self.assertIn("Before=eduscope-runtime-config.service eduscope-pipeline-manager.service eduscope-core-api.service", mount)
        runtime = self.read("eduscope-runtime-config.service")
        self.assertIn("Requires=media-eduscope.mount", runtime)
        self.assertIn("render.py --manifest /etc/eduscope/device-manifest.json --provisioning /etc/eduscope/provisioning.json --secrets /etc/eduscope/secrets.json", runtime)
        self.assertIn("render-hardware.py --manifest /etc/eduscope/device-manifest.json --runtime-only --output-root /run/eduscope --profile ${EDUSCOPE_DEPLOYMENT_PROFILE}", runtime)
        core = self.read("eduscope-core-api.service")
        self.assertIn("Requires=media-eduscope.mount eduscope-runtime-config.service eduscope-helper.socket", core)
        self.assertIn("Wants=network-online.target eduscope-pipeline-manager.service", core)
        self.assertNotIn("Requires=eduscope-pipeline-manager.service", core)
        kiosk = self.read("eduscope-kiosk.service")
        self.assertIn("wait-http.py http://127.0.0.1:5000/healthz 60", kiosk)
        stunnel = self.read("eduscope-stunnel.service")
        self.assertIn("ExecStartPre=/usr/libexec/eduscope-stunnel-validate /run/eduscope/relay/stunnel.conf", stunnel)
        self.assertIn("ExecStart=/usr/bin/stunnel4 /run/eduscope/relay/stunnel.conf", stunnel)
        self.assertIn("User=eduscope-core", stunnel)
        for name in ("eduscope-stt.service", "eduscope-slide.service"):
            body = self.read(name)
            self.assertIn("Wants=eduscope-pipeline-manager.service", body)
            self.assertNotIn("Requires=eduscope-pipeline-manager.service", body)

    def test_isolation_and_resources(self):
        for name in ("eduscope-pipeline-manager.service", "eduscope-stt.service"):
            self.assertIn("PrivateTmp=false", self.read(name))
        for name in ("eduscope-core-api.service", "eduscope-stt.service", "eduscope-slide.service", "eduscope-question.service", "eduscope-kiosk.service"):
            body = self.read(name)
            self.assertIn("ProtectSystem=strict", body)
            self.assertIn("NoNewPrivileges=true", body)
            self.assertIn("ProtectHome=", body)
            self.assertIn("ReadWritePaths=", body)
        stt = self.read("eduscope-stt.service")
        self.assertIn("CPUAffinity=4 5 6 7", stt)
        self.assertIn("MemoryMax=5G", stt)
        self.assertIn("Nice=5", stt)
        slide = self.read("eduscope-slide.service")
        self.assertIn("CPUAffinity=0 1 2 3", slide)
        self.assertIn("MemoryMax=1G", slide)
        self.assertIn("MemoryMax=1G", self.read("eduscope-question.service"))

    def test_environment_files_are_scoped(self):
        expected = {
            "eduscope-pipeline-manager.service": {"pipeline.env", "audio.env"},
            "eduscope-core-api.service": {"core.env"},
            "eduscope-stt.service": {"stt.env", "audio.env"},
            "eduscope-slide.service": {"slide.env"},
            "eduscope-question.service": {"question.env"},
            "eduscope-kiosk.service": set(),
        }
        for name, envs in expected.items():
            found = {line.rsplit("/", 1)[-1] for line in self.read(name).splitlines() if line.startswith("EnvironmentFile=")}
            self.assertEqual(envs, found)

    def test_only_declared_tokens_remain(self):
        tokens = set()
        for path in UNIT_DIR.rglob("*"):
            if path.is_file():
                import re
                tokens.update(re.findall(r"@[A-Z0-9_]+@", path.read_text()))
        self.assertEqual({"@RECORDINGS_UUID@", "@TOUCH_DEVNODE@", "@KIOSK_UID@"}, tokens)

    def test_verifier_has_static_and_live_surfaces(self):
        verifier = (ROOT / "deploy/tests/verify-systemd.sh").read_text()
        self.assertIn("systemd-analyze verify --root=", verifier)
        self.assertIn("PASS systemd unit graph", verifier)
        self.assertIn("if [[ ${1:-} == --live", verifier)
        self.assertIn("/run/eduscope/config.json", verifier)
        self.assertIn("deploymentProfile", verifier)
        self.assertIn("demo-staging", verifier)
        self.assertIn("PASS systemd live restart matrix", verifier)

    def test_repo_owned_direct_exec_programs_are_executable(self):
        prefix = "/opt/eduscope/current/"
        checked = []
        for name in self.services:
            for line in self.read(name).splitlines():
                if not line.startswith(("ExecStart=", "ExecStartPre=")):
                    continue
                program = line.split("=", 1)[1].split()[0]
                if not program.startswith(prefix):
                    continue
                path = ROOT / program.removeprefix(prefix)
                if path.exists():
                    checked.append(path)
                    self.assertTrue(path.stat().st_mode & stat.S_IXUSR, f"direct executable is not mode 100755: {path}")
        self.assertTrue(checked)


if __name__ == "__main__":
    unittest.main()

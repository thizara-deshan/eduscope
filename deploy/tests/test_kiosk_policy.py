import configparser
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).parents[2]
KIOSK = ROOT / "deploy/kiosk"


class KioskPolicyTest(unittest.TestCase):
    def test_gdm_owns_x11_autologin_session(self):
        parser = configparser.ConfigParser()
        parser.read(KIOSK / "gdm-custom.conf")
        self.assertEqual("false", parser["daemon"]["WaylandEnable"])
        self.assertEqual("true", parser["daemon"]["AutomaticLoginEnable"])
        self.assertEqual("eduscope-kiosk", parser["daemon"]["AutomaticLogin"])
        self.assertEqual("eduscope.desktop", parser["daemon"]["DefaultSession"])
        self.assertEqual("true", parser["security"]["DisallowTCP"])

    def test_session_and_dconf_are_locked_down(self):
        desktop = (KIOSK / "eduscope.desktop").read_text()
        self.assertIn("Exec=/opt/eduscope/current/deploy/kiosk/session.sh", desktop)
        self.assertEqual(["user-db:user", "system-db:local"], (KIOSK / "dconf/profile/user").read_text().splitlines())
        settings = (KIOSK / "dconf/db/local.d/00-eduscope").read_text()
        locks = (KIOSK / "dconf/db/local.d/locks/eduscope").read_text()
        for value in ("idle-delay=uint32 0", "lock-enabled=false", "lock-delay=uint32 0"):
            self.assertIn(value, settings)
        for key in ("/org/gnome/desktop/session/idle-delay", "/org/gnome/desktop/screensaver/lock-enabled", "/org/gnome/desktop/screensaver/lock-delay"):
            self.assertIn(key, locks)

    def test_managed_policy_is_exact(self):
        policy = json.loads((KIOSK / "policies/managed/eduscope.json").read_text())
        self.assertEqual({
            "PasswordManagerEnabled": False, "BrowserSignin": 0, "RestoreOnStartup": 4,
            "RestoreOnStartupURLs": ["http://127.0.0.1/"], "ExtensionInstallBlocklist": ["*"],
            "PrintingEnabled": False, "DownloadRestrictions": 3, "DeveloperToolsAvailability": 2,
            "DefaultPopupsSetting": 2, "HomepageLocation": "http://127.0.0.1/",
            "URLAllowlist": ["http://127.0.0.1/*"], "URLBlocklist": ["*"],
        }, policy)

    def test_flags_are_exact_and_safe(self):
        flags = (KIOSK / "chromium-flags.conf").read_text().splitlines()
        self.assertEqual([
            "--kiosk", "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble",
            "--disable-component-update", "--overscroll-history-navigation=0", "--touch-events=enabled",
            "http://127.0.0.1/",
        ], flags)
        for unsafe in ("--no-sandbox", "--disable-web-security", "--ignore-certificate-errors", "--disable-gpu"):
            self.assertNotIn(unsafe, " ".join(flags))

    def test_launcher_and_unit_restart(self):
        launcher = (KIOSK / "launcher.sh").read_text()
        self.assertIn("attempt<120", launcher)
        self.assertIn("EDUSCOPE_DEPLOYMENT_PROFILE:-production", launcher)
        self.assertIn('/usr/bin/xhost +SI:localuser:eduscope-pipeline', launcher)
        self.assertIn('exec "$chromium" "${flags[@]}"', launcher)
        unit = (ROOT / "deploy/systemd/eduscope-kiosk.service").read_text()
        for value in ("User=eduscope-kiosk", "After=display-manager.service", "Restart=on-failure", "DeviceAllow=@TOUCH_DEVNODE@ r"):
            self.assertIn(value, unit)


if __name__ == "__main__":
    unittest.main()

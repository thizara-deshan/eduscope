import pathlib
import unittest


ROOT = pathlib.Path(__file__).parents[2]


class AccountAndPathDefinitionsTest(unittest.TestCase):
    def test_sysusers_definition_is_exact(self):
        expected = """g eduscope -
g eduscope-media -
u eduscope-core - \"Eduscope core API\" /var/lib/eduscope /usr/sbin/nologin
u eduscope-pipeline - \"Eduscope pipeline manager\" /var/lib/eduscope/pipeline-manager /usr/sbin/nologin
u eduscope-ai - \"Eduscope AI services\" /var/lib/eduscope/ai /usr/sbin/nologin
u eduscope-kiosk - \"Eduscope kiosk\" /var/lib/eduscope/kiosk /bin/bash
m eduscope-core eduscope
m eduscope-pipeline eduscope
m eduscope-core eduscope-media
m eduscope-pipeline eduscope-media
m eduscope-ai eduscope-media
m eduscope-pipeline video
m eduscope-pipeline audio
m eduscope-pipeline render
m eduscope-ai audio
m eduscope-kiosk video
m eduscope-kiosk render
"""
        self.assertEqual((ROOT / "deploy/sysusers/eduscope.conf").read_text(), expected)

    def test_tmpfiles_definition_is_exact(self):
        expected = """d /run/eduscope 0750 root eduscope -
d /run/eduscope/env 0750 root eduscope -
d /run/eduscope/helper 0700 root root -
d /run/eduscope/pipeline-manager 0750 eduscope-pipeline eduscope -
d /run/eduscope/relay 0710 eduscope-core eduscope -
d /var/lib/eduscope 0750 eduscope-core eduscope-media -
d /var/lib/eduscope/secrets 0700 eduscope-core eduscope-core -
d /var/lib/eduscope/pipeline-manager 0750 eduscope-pipeline eduscope-media -
d /var/lib/eduscope/ai 0750 eduscope-ai eduscope-media -
d /var/lib/eduscope/kiosk 0700 eduscope-kiosk eduscope-kiosk -
d /media/eduscope 2770 root eduscope-media -
"""
        self.assertEqual((ROOT / "deploy/tmpfiles/eduscope.conf").read_text(), expected)


if __name__ == "__main__":
    unittest.main()

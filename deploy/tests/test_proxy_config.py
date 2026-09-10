import pathlib
import unittest


ROOT = pathlib.Path(__file__).parents[2]


class ProxyConfigTest(unittest.TestCase):
    def test_single_origin_and_rtmp_are_loopback_only(self):
        http = (ROOT / "deploy/nginx/eduscope.conf").read_text()
        rtmp = (ROOT / "deploy/nginx/rtmp.conf.template").read_text()
        self.assertIn("listen 127.0.0.1:80 default_server;", http)
        self.assertIn("alias /run/eduscope-public/config.json;", http)
        self.assertIn("proxy_pass http://127.0.0.1:5000", http)
        self.assertIn("proxy_buffering off;", http)
        self.assertIn("proxy_force_ranges on;", http)
        self.assertIn("listen 127.0.0.1:1935;", rtmp)
        self.assertIn("record off;", rtmp)
        self.assertIn("deny play all;", rtmp)

    def test_stunnel_template_has_secure_fixed_preamble(self):
        body = (ROOT / "deploy/stunnel/eduscope.conf.template").read_text()
        for directive in ("client = yes", "verifyChain = yes", "CAfile = /etc/ssl/certs/ca-certificates.crt", "@SERVICE_SECTIONS@"):
            self.assertIn(directive, body)


if __name__ == "__main__":
    unittest.main()

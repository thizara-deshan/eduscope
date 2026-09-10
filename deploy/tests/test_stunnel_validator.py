import importlib.util
import pathlib
import tempfile
import unittest


ROOT = pathlib.Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location(
    "validate_stunnel", ROOT / "deploy/relay/validate-stunnel.py"
)


class StunnelValidatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.module)

    def test_rejects_configuration_without_a_service(self):
        with self.assertRaisesRegex(ValueError, "no stunnel services"):
            self.module.validation_config("foreground = yes\nclient = yes\n")

    def test_real_stunnel_accepts_isolated_validation_configuration(self):
        config = """\
foreground = yes
pid =
client = yes
[target-test]
accept = 127.0.0.1:19400
connect = relay.invalid:443
"""
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "stunnel.conf"
            path.write_text(config)
            self.module.validate(path)


if __name__ == "__main__":
    unittest.main()

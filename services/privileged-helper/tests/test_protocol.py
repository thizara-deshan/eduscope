import io
import json
import socket
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from eduscope_privileged_helper.peer import PeerCredentials
from eduscope_privileged_helper.server import MAX_REQUEST_BYTES, handle_connection


class FakeConnection:
    def __init__(self, data):
        self.input = io.BytesIO(data)
        self.output = bytearray()
        self.timeout = None

    def settimeout(self, value): self.timeout = value
    def recv(self, size): return self.input.read(size)
    def sendall(self, data): self.output.extend(data)


class Registry:
    def dispatch(self, request, peer):
        return {"ok": True, "detail": f"{request['requestId']}:{peer.uid}"}


class ProtocolTests(unittest.TestCase):
    def call(self, payload, *, uid=100):
        conn = FakeConnection(payload)
        audit = io.StringIO()
        handle_connection(conn, Registry(), {100}, audit, peer_getter=lambda _: PeerCredentials(1, uid, 2))
        return json.loads(conn.output), json.loads(audit.getvalue())

    def test_one_canonical_json_line(self):
        response, audit = self.call(b'{"verb":"led.set","args":{"mode":"on"},"requestId":"r1"}\n')
        self.assertEqual(response, {"ok": True, "detail": "r1:100"})
        self.assertEqual(audit["requestId"], "r1")
        self.assertNotIn("args", audit)

    def test_old_id_extra_line_invalid_utf8_and_oversize_are_rejected(self):
        cases = [
            b'{"verb":"led.set","args":{},"id":"old"}\n',
            b'{"verb":"led.set","verb":"system.poweroff","args":{},"requestId":"r"}\n',
            b'{"verb":"led.set","args":{},"requestId":"r"}\n{}\n',
            b'\xff\n',
            b'x' * (MAX_REQUEST_BYTES + 1),
        ]
        for payload in cases:
            with self.subTest(payload=payload[:20]):
                response, _ = self.call(payload)
                self.assertFalse(response["ok"])

    def test_uid_is_taken_from_kernel_and_allowlisted_before_dispatch(self):
        response, audit = self.call(b'{"verb":"led.set","args":{},"requestId":"secret"}\n', uid=999)
        self.assertFalse(response["ok"])
        self.assertEqual(audit["uid"], 999)

    def test_audit_and_error_redact_secrets(self):
        response, audit = self.call(b'{"verb":"net.apply","args":{"password":"top-secret","bearer":"token"},"requestId":"r"}\n')
        rendered = json.dumps([response, audit])
        self.assertNotIn("top-secret", rendered)
        self.assertNotIn("token", rendered)

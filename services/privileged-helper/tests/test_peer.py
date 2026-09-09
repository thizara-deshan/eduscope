import socket
import struct
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from eduscope_privileged_helper.peer import PeerCredentials, peer_credentials


class PeerTests(unittest.TestCase):
    def test_kernel_peer_credentials_are_unpacked_as_three_native_ints(self):
        conn = Mock()
        conn.getsockopt.return_value = struct.Struct("3i").pack(12, 34, 56)
        self.assertEqual(peer_credentials(conn), PeerCredentials(pid=12, uid=34, gid=56))
        conn.getsockopt.assert_called_once_with(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.Struct("3i").size)

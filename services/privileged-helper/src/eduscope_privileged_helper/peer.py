import socket
import struct
from dataclasses import dataclass

_UCRED = struct.Struct("3i")


@dataclass(frozen=True)
class PeerCredentials:
    pid: int
    uid: int
    gid: int


def peer_credentials(conn: socket.socket) -> PeerCredentials:
    raw = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, _UCRED.size)
    return PeerCredentials(*_UCRED.unpack(raw))

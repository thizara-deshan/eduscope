from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

from ..models import SourceRole

GST_LAUNCH_PREFIX: tuple[str, ...] = ("gst-launch-1.0", "-e", "-m")

# Publisher aliases stay internal (usb/rtsp/rtsp2/audio); fixed sockets (design §0.2).
ROLE_SOCKETS: dict[SourceRole, str] = {
    SourceRole.PRESENTATION: "/tmp/usb.sock",
    SourceRole.LECTURER_CAM: "/tmp/rtsp.sock",
    SourceRole.STUDENTS_CAM: "/tmp/rtsp2.sock",
    SourceRole.MIC_LECTURER: "/tmp/audio.sock",
}


class InvalidToken(ValueError):
    pass


class UnsupportedPipeline(ValueError):
    pass


def _validate_token(token: str) -> None:
    if not isinstance(token, str) or "\x00" in token or "\n" in token:
        raise InvalidToken(f"invalid pipeline token: {token!r}")


@dataclass
class PipelineBuilder:
    """Token-only source -> compose -> sink assembly (pipeline-manager.md §2).

    Never joins tokens into a shell string — argv is spawned with shell=False
    downstream (A-07). No gst-launch fragment is formed outside this module.
    """

    _tokens: list[str] = field(default_factory=lambda: list(GST_LAUNCH_PREFIX))

    def add(self, *tokens: str) -> "PipelineBuilder":
        for token in tokens:
            _validate_token(token)
            self._tokens.append(token)
        return self

    def branch(self, tokens: Sequence[str]) -> "PipelineBuilder":
        return self.add(*tokens)

    def build(self) -> tuple[str, ...]:
        return tuple(self._tokens)


@dataclass(frozen=True)
class PipelineSpec:
    argv: tuple[str, ...]
    required_roles: tuple[SourceRole, ...]
    encode_slots: int
    outputs: tuple[str, ...]
    placement: Any | None = None

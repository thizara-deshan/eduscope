from __future__ import annotations

from dataclasses import dataclass

from ..models import ConsumerState


@dataclass(frozen=True)
class ConsumerEvent:
    consumer_id: str
    kind: str
    state: ConsumerState
    reason: str | None = None
    truncated: bool | None = None
    error_code: str | None = None
    pgid: int | None = None


class PublisherNotRunning(RuntimeError):
    pass


class CaptureCardRecovering(RuntimeError):
    pass


class ConsumerNotRunning(RuntimeError):
    pass

from __future__ import annotations

import time
from dataclasses import dataclass, field, replace
from typing import Callable, Literal
import asyncio

from ..models import PublisherId, PublisherState, SourceRole


@dataclass(frozen=True)
class PublisherBinding:
    """The source a publisher captures. Address (and, for RTSP, credentials)
    arrive from core-api (`cmd.admin.set_binding`, HL-09) via
    `PUT /publishers/{id}/binding`; they are edited in exactly one place and
    never hardcoded on the box. The password is never echoed back in
    status/errors/logs — call `redacted()` before anything leaves the service.
    """

    address: str
    username: str | None = None
    password: str | None = None
    device_path: str | None = None

    @property
    def has_secret(self) -> bool:
        return self.password is not None

    def redacted(self) -> "PublisherBinding":
        if self.password is None:
            return self
        return replace(self, password="<redacted>")

# Internal publisher ids map to canonical v1 roles exactly once (design §1.1).
PUBLISHER_ROLES: dict[PublisherId, SourceRole] = {
    PublisherId.USB: SourceRole.PRESENTATION,
    PublisherId.RTSP: SourceRole.LECTURER_CAM,
    PublisherId.RTSP2: SourceRole.STUDENTS_CAM,
    PublisherId.AUDIO: SourceRole.MIC_LECTURER,
}

ROLE_PUBLISHERS: dict[SourceRole, PublisherId] = {role: publisher for publisher, role in PUBLISHER_ROLES.items()}

# Proven shm ring sizes (bytes) — pipeline-audit §4.2.
PUBLISHER_RING_BYTES: dict[PublisherId, int] = {
    PublisherId.USB: 64_000_000,
    PublisherId.RTSP: 20_000_000,
    PublisherId.RTSP2: 20_000_000,
    PublisherId.AUDIO: 4_000_000,
}

PUBLISHER_SOCKETS: dict[PublisherId, str] = {
    PublisherId.USB: "/tmp/usb.sock",
    PublisherId.RTSP: "/tmp/rtsp.sock",
    PublisherId.RTSP2: "/tmp/rtsp2.sock",
    PublisherId.AUDIO: "/tmp/audio.sock",
}

# Restart policy (design §1.3, T-CONSUMER-RESTART): 1s/3s/8s, max 3 attempts/120s.
BACKOFF_SECONDS: tuple[float, ...] = (1.0, 3.0, 8.0)
MAX_RESTART_ATTEMPTS = 3
RESTART_WINDOW_SECONDS = 120.0

# Health staleness (design §1.1/§3.3): telemetry older than T-HEALTH-STALE is
# reported `unknown`, never the last-healthy value (B-12, INV-DH-2).
T_HEALTH_STALE_SECONDS = 6.0


@dataclass
class RestartBudget:
    """1s/3s/8s backoff, max 3 attempts per rolling 120s window."""

    clock: Callable[[], float] = field(default=time.monotonic)
    attempts: list[float] = field(default_factory=list)

    def _prune(self) -> None:
        cutoff = self.clock() - RESTART_WINDOW_SECONDS
        self.attempts = [t for t in self.attempts if t >= cutoff]

    @property
    def exhausted(self) -> bool:
        self._prune()
        return len(self.attempts) >= MAX_RESTART_ATTEMPTS

    def next_backoff(self) -> float | None:
        self._prune()
        if len(self.attempts) >= MAX_RESTART_ATTEMPTS:
            return None
        return BACKOFF_SECONDS[len(self.attempts)]

    def record_attempt(self) -> None:
        self._prune()
        self.attempts.append(self.clock())

    def reset(self) -> None:
        self.attempts.clear()


@dataclass
class PublisherHealth:
    state: PublisherState = PublisherState.OFFLINE
    fps: float | None = None
    rms: float | None = None
    last_telemetry_at: float | None = None
    last_error: str | None = None


def project_health(health: PublisherHealth, now: float) -> PublisherState:
    """Never report the last-healthy value once telemetry goes stale."""
    if health.last_telemetry_at is None:
        return PublisherState.OFFLINE
    if now - health.last_telemetry_at > T_HEALTH_STALE_SECONDS:
        return PublisherState.UNKNOWN
    return health.state


PublisherEventKind = Literal["running", "degraded", "exited", "failed", "stopped"]


@dataclass(frozen=True)
class PublisherEvent:
    publisher_id: PublisherId
    role_id: SourceRole
    kind: PublisherEventKind
    state: PublisherState
    backoff_seconds: float | None = None
    fps: float | None = None
    rms: float | None = None
    last_error: str | None = None


class PublisherController:
    """Owns one fixed PublisherId, its current binding, process identity
    `publisher:<id>`, restart budget, and health reducer. A publisher death
    never signals consumers — that is the entire point of shm decoupling.
    """

    def __init__(self, publisher_id: PublisherId, *, clock: Callable[[], float] = time.monotonic) -> None:
        self.publisher_id = publisher_id
        self.role = PUBLISHER_ROLES[publisher_id]
        self.identity = f"publisher:{publisher_id.value}"
        self.clock = clock
        self.restart_budget = RestartBudget(clock=clock)
        self.health = PublisherHealth()
        self.binding: PublisherBinding | str | None = None
        self.pid: int | None = None
        self.exit_task: asyncio.Task | None = None
        self.requested_stop = False

    def bind(self, binding: "PublisherBinding | str") -> None:
        """A binding change or manual retry resets the restart budget. Accepts
        a structured `PublisherBinding` (from `PUT /publishers/{id}/binding`)
        or a bare address string (legacy/manual retry)."""
        self.binding = binding
        self.restart_budget.reset()

    @property
    def has_binding(self) -> bool:
        return self.binding is not None

    def manual_retry(self) -> None:
        self.restart_budget.reset()

    def observe_running(self) -> PublisherEvent:
        self.health.state = PublisherState.ONLINE
        self.health.last_telemetry_at = self.clock()
        self.restart_budget.reset()
        return PublisherEvent(
            publisher_id=self.publisher_id, role_id=self.role, kind="running", state=PublisherState.ONLINE
        )

    def mark_online(self, pid: int) -> PublisherEvent:
        """Called by the `start_publisher` coordinator once `HealthConfirmer`
        has actually seen PLAYING — never before (accepted-before-health,
        §3.1: the 202 response precedes this by definition)."""
        self.pid = pid
        return self.observe_running()

    def mark_offline(self) -> PublisherEvent:
        """A requested stop, distinct from `on_unexpected_exit` (which is the
        unexpected-death/restart path, B3)."""
        self.pid = None
        self.health.state = PublisherState.OFFLINE
        return PublisherEvent(
            publisher_id=self.publisher_id, role_id=self.role, kind="stopped", state=PublisherState.OFFLINE
        )

    def observe_telemetry(self, *, fps: float | None = None, rms: float | None = None) -> None:
        self.health.fps = fps
        self.health.rms = rms
        self.health.last_telemetry_at = self.clock()

    def current_state(self) -> PublisherState:
        return project_health(self.health, self.clock())

    def on_unexpected_exit(self, error: str | None = None) -> PublisherEvent:
        self.pid = None
        self.health.last_error = error
        if self.restart_budget.exhausted:
            self.health.state = PublisherState.OFFLINE
            return PublisherEvent(
                publisher_id=self.publisher_id,
                role_id=self.role,
                kind="failed",
                state=PublisherState.OFFLINE,
                last_error=error,
            )
        backoff = self.restart_budget.next_backoff()
        self.restart_budget.record_attempt()
        self.health.state = PublisherState.DEGRADED
        return PublisherEvent(
            publisher_id=self.publisher_id,
            role_id=self.role,
            kind="exited",
            state=PublisherState.DEGRADED,
            backoff_seconds=backoff,
            last_error=error,
        )

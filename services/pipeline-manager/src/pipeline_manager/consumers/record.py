from __future__ import annotations

from typing import Callable

from ..models import ConsumerState, SourceRole
from ..pipelines.platforms.base import PlatformProfile
from ..pipelines.record import RecordRequest, build_record
from ..publishers.base import RestartBudget
from ..supervisor.health import HealthConfirmer
from ..supervisor.ledger import EncodeLedger
from ..supervisor.process import ManagedProcess, ProcessSupervisor
from ..supervisor.stop import PAUSE_DEADLINE_SECONDS, STOP_DEADLINE_SECONDS, SignalFn, send_group_signal, stop_process
from .base import (
    CaptureCardRecovering,
    ConsumerEvent,
    ConsumerNotRunning,
    PublisherNotRunning,
    _ChildOwner,
    event_payload,
)

START_CONFIRM_TIMEOUT_SECONDS = 5.0


class RecordConsumer(_ChildOwner):
    """Session-lifetime record consumer (RECORDING machine 1a's side effect).

    Owns runtime state only — `starting|running|degraded|stopping|exited|failed`.
    Never writes `LectureSession`/recording domain state; core-api is the
    single writer (SM-R-1). This class only reports what actually happened.
    """

    def __init__(
        self,
        consumer_id: str,
        *,
        supervisor: ProcessSupervisor,
        ledger: EncodeLedger,
        confirmer: HealthConfirmer,
        platform: PlatformProfile,
        is_publisher_running: Callable[[SourceRole], bool],
        is_capture_card_recovering: Callable[[], bool] = lambda: False,
        send_signal: SignalFn = send_group_signal,
        restart_budget: RestartBudget | None = None,
        events=None,
    ) -> None:
        self.consumer_id = consumer_id
        self._supervisor = supervisor
        self._ledger = ledger
        self._confirmer = confirmer
        self._platform = platform
        self._is_publisher_running = is_publisher_running
        self._is_capture_card_recovering = is_capture_card_recovering
        self._send_signal = send_signal
        self._events = events
        self._restart_budget = restart_budget or RestartBudget()

        self.state = ConsumerState.EXITED  # not yet started
        self.output_path: str | None = None
        self.pgid: int | None = None
        self.truncated = False
        self.restarts = 0
        self.process: ManagedProcess | None = None
        # Set True only by startup's orphan reconstruction (A-REV-007) — a
        # record this instance spawned itself is never adopted.
        self.adopted = False
        self._init_ownership()

    async def start(self, request: RecordRequest) -> ConsumerEvent:
        spec = build_record(request, self._platform, is_role_healthy=self._is_publisher_running)

        if spec.degraded_start_ok:
            # A-REV-003: every required role already has an in-pipeline
            # fallback branch — refuse only if *none* of them are usable,
            # not merely because one dropped out (R-SRC-1).
            if not any(self._is_publisher_running(role) for role in spec.required_roles):
                raise PublisherNotRunning(spec.required_roles[0])
        else:
            for role in spec.required_roles:
                if not self._is_publisher_running(role):
                    raise PublisherNotRunning(role)
        if SourceRole.PRESENTATION in spec.required_roles and self._is_capture_card_recovering():
            raise CaptureCardRecovering("capture card is recovering")

        async with self._lock:
            self.state = ConsumerState.STARTING
            reservation = self._ledger.acquire(self.consumer_id, spec.encode_slots, "guaranteed")
            process: ManagedProcess | None = None
            try:
                process = await self._supervisor.start(spec, self.consumer_id)
                reservation.commit()
                await self._confirmer.confirm(
                    process,
                    is_record=True,
                    output_path=spec.outputs[0],
                    timeout=START_CONFIRM_TIMEOUT_SECONDS,
                )
            except Exception:
                self._ledger.release(self.consumer_id)
                if process is not None:
                    await self._cleanup_failed_start(process)
                self.state = ConsumerState.FAILED
                raise

            self.process = process
            self.output_path = spec.outputs[0]
            self.pgid = process.pgid
            self.truncated = False
            self.state = ConsumerState.RUNNING
            self._restart_budget.reset()
            self._start_exit_watcher(process)
            return ConsumerEvent(
                consumer_id=self.consumer_id, kind="running", state=ConsumerState.RUNNING, pgid=self.pgid
            )

    async def pause(self) -> ConsumerEvent:
        return await self._eos_stop(PAUSE_DEADLINE_SECONDS)

    async def stop(self) -> ConsumerEvent:
        return await self._eos_stop(STOP_DEADLINE_SECONDS)

    async def _eos_stop(self, deadline_seconds: float) -> ConsumerEvent:
        async with self._lock:
            if self.process is None:
                if self._terminal_event is not None:
                    return self._terminal_event  # idempotent: already stopped/exited
                raise ConsumerNotRunning(f"{self.consumer_id} is not running")

            process = self.process
            if self._exit_task is not None:
                self._exit_task.cancel()
            self.state = ConsumerState.STOPPING

            result = await stop_process(process, deadline_seconds, send_signal=self._send_signal)

            self._ledger.release(self.consumer_id)
            self._supervisor.forget(self.consumer_id)
            self.process = None

            if result.clean_eos:
                self.state = ConsumerState.EXITED
                self.truncated = False
                event = ConsumerEvent(
                    consumer_id=self.consumer_id, kind="eos", state=ConsumerState.EXITED, truncated=False
                )
            else:
                self.state = ConsumerState.FAILED
                self.truncated = True
                event = ConsumerEvent(
                    consumer_id=self.consumer_id,
                    kind="eos_timeout",
                    state=ConsumerState.FAILED,
                    truncated=True,
                    error_code="eos_timeout",
                )
            self._terminal_event = event
            if self._events is not None:
                await self._events.publish(f"evt.pm.consumer.{event.kind}", event_payload(event))
            return event

    def on_unexpected_exit(self) -> ConsumerEvent:
        """A dead source never ends a lecture (R-SRC-1): mark the current
        output truncated and request a restart with a NEW segment path — this
        method never invents that path itself (core-api supplies it, B-02).
        """
        self._ledger.release(self.consumer_id)
        self.truncated = True

        if self._restart_budget.exhausted:
            self.state = ConsumerState.FAILED
            return ConsumerEvent(
                consumer_id=self.consumer_id,
                kind="exited",
                state=ConsumerState.FAILED,
                reason="unexpected",
                truncated=True,
            )

        backoff = self._restart_budget.next_backoff()
        self._restart_budget.record_attempt()
        self.restarts += 1
        self.state = ConsumerState.EXITED
        return ConsumerEvent(
            consumer_id=self.consumer_id,
            kind="exited",
            state=ConsumerState.EXITED,
            reason="unexpected",
            truncated=True,
            backoff_seconds=backoff,
        )

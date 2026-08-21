from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum

from ..models import ConsumerState
from ..pipelines.builder import PipelineSpec
from ..publishers.base import RestartBudget
from ..supervisor.health import HealthConfirmer
from ..supervisor.ledger import EncodeLedger
from ..supervisor.process import ManagedProcess, ProcessSupervisor
from ..supervisor.stop import STOP_DEADLINE_SECONDS, SignalFn, kill_and_reap, send_group_signal, stop_process

# How often the exit watcher polls a live child for termination (A-REV-004).
# `Popen.poll()`/a fake's equivalent is non-blocking, so this never ties up a
# real OS thread the way waiting on `Popen.wait()` in an executor would.
EXIT_POLL_INTERVAL_SECONDS = 0.1


class RestartClass(str, Enum):
    RECORD = "record"
    CHANNEL = "channel"
    DISPLAY = "display"
    AUX = "aux"


@dataclass(frozen=True)
class ConsumerEvent:
    consumer_id: str
    kind: str
    state: ConsumerState
    reason: str | None = None
    truncated: bool | None = None
    error_code: str | None = None
    pgid: int | None = None
    backoff_seconds: float | None = None


def event_payload(event: ConsumerEvent) -> dict:
    """The `evt.pm.consumer.*` data shape published by the exit watcher and
    by a requested stop alike (mirrors `publishers.coordinator._event_payload`)."""
    return {
        "consumerId": event.consumer_id,
        "state": event.state.value,
        "reason": event.reason,
        "truncated": event.truncated,
        "errorCode": event.error_code,
        "pgid": event.pgid,
        "backoffSeconds": event.backoff_seconds,
    }


class PublisherNotRunning(RuntimeError):
    def __init__(self, role) -> None:  # role: SourceRole, kept untyped to avoid an import cycle
        super().__init__(f"required publisher for {role.value} is not running")
        self.role = role


class CaptureCardRecovering(RuntimeError):
    pass


class ConsumerNotRunning(RuntimeError):
    pass


class _ChildOwner:
    """Shared ownership mechanics mixed into every consumer that owns exactly
    one child process (`ConsumerController` and `RecordConsumer`, which keep
    their own distinct spawn/stop shapes otherwise): one waiter task per
    child that tells a requested exit from an unexpected one, a per-consumer
    lock so spawn/stop/the waiter never race each other, and the
    failed-confirm rollback (A-REV-004/005/006).

    A subclass must set `self.consumer_id`, `self.process`, `self._supervisor`,
    `self._send_signal`, and `self._events` (may be `None`) before calling
    `_init_ownership()`, and must implement `on_unexpected_exit()`.
    """

    consumer_id: str
    process: ManagedProcess | None
    _supervisor: ProcessSupervisor
    _send_signal: SignalFn
    _events: object | None

    def _init_ownership(self) -> None:
        self._lock = asyncio.Lock()
        self._exit_task: asyncio.Task | None = None
        self._terminal_event: ConsumerEvent | None = None

    async def _cleanup_failed_start(self, process: ManagedProcess) -> None:
        await kill_and_reap(self._supervisor, process, send_signal=self._send_signal)

    def _start_exit_watcher(self, process: ManagedProcess) -> None:
        self._terminal_event = None
        self._exit_task = asyncio.create_task(self._watch_exit(process))

    async def _watch_exit(self, process: ManagedProcess) -> None:
        try:
            while process.popen.poll() is None:
                await asyncio.sleep(EXIT_POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            return

        async with self._lock:
            if self.process is not process:
                return  # already claimed by a requested stop, or superseded by a new spawn

            self.process = None
            self._supervisor.forget(self.consumer_id)
            event = self.on_unexpected_exit()  # type: ignore[attr-defined]
            self._terminal_event = event
            if event is not None and self._events is not None:
                topic = "failed" if event.state is ConsumerState.FAILED else "exited"
                await self._events.publish(f"evt.pm.consumer.{topic}", event_payload(event))  # type: ignore[attr-defined]

    def on_unexpected_exit(self) -> ConsumerEvent | None:  # pragma: no cover - overridden by every subclass
        raise NotImplementedError


class ConsumerController(_ChildOwner):
    """Process mechanics only (spawn/confirm/stop/restart bookkeeping) — every
    subclass supplies its own preconditions and restart *decision* (Step 3:
    "keep preconditions/restart decisions in each class").
    """

    def __init__(
        self,
        consumer_id: str,
        *,
        restart_class: RestartClass,
        supervisor: ProcessSupervisor,
        ledger: EncodeLedger,
        confirmer: HealthConfirmer,
        send_signal: SignalFn = send_group_signal,
        restart_budget: RestartBudget | None = None,
        events=None,
    ) -> None:
        self.consumer_id = consumer_id
        self.restart_class = restart_class
        self._supervisor = supervisor
        self._ledger = ledger
        self._confirmer = confirmer
        self._send_signal = send_signal
        self._events = events
        self.restart_budget = restart_budget or RestartBudget()

        self.state = ConsumerState.EXITED
        self.process: ManagedProcess | None = None
        self.pgid: int | None = None
        self.spec: PipelineSpec | None = None
        self._init_ownership()

    async def spawn(self, spec: PipelineSpec, *, priority: str = "guaranteed") -> ConsumerEvent:
        async with self._lock:
            self.spec = spec
            self.state = ConsumerState.STARTING
            reservation = self._ledger.acquire(self.consumer_id, spec.encode_slots, priority)
            process: ManagedProcess | None = None
            try:
                process = await self._supervisor.start(spec, self.consumer_id)
                reservation.commit()
                await self._confirmer.confirm(process, is_record=False)
            except Exception:
                self._ledger.release(self.consumer_id)
                if process is not None:
                    await self._cleanup_failed_start(process)
                self.state = ConsumerState.FAILED
                raise

            self.process = process
            self.pgid = process.pgid
            self.state = ConsumerState.RUNNING
            self.restart_budget.reset()
            self._start_exit_watcher(process)
            return ConsumerEvent(
                consumer_id=self.consumer_id, kind="running", state=ConsumerState.RUNNING, pgid=self.pgid
            )

    async def stop(self, deadline_seconds: float = STOP_DEADLINE_SECONDS) -> ConsumerEvent:
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
            self.state = ConsumerState.EXITED if result.clean_eos else ConsumerState.FAILED
            event = ConsumerEvent(
                consumer_id=self.consumer_id,
                kind="eos" if result.clean_eos else "eos_timeout",
                state=self.state,
                truncated=not result.clean_eos,
                error_code=result.error_code,
            )
            self._terminal_event = event
            if self._events is not None:
                await self._events.publish(f"evt.pm.consumer.{event.kind}", event_payload(event))
            return event

    def on_unexpected_exit(self) -> ConsumerEvent:
        self._ledger.release(self.consumer_id)
        if self.restart_budget.exhausted:
            self.state = ConsumerState.FAILED
            return ConsumerEvent(
                consumer_id=self.consumer_id, kind="exited", state=ConsumerState.FAILED, reason="unexpected"
            )
        backoff = self.restart_budget.next_backoff()
        self.restart_budget.record_attempt()
        self.state = ConsumerState.EXITED
        return ConsumerEvent(
            consumer_id=self.consumer_id,
            kind="exited",
            state=ConsumerState.EXITED,
            reason="unexpected",
            backoff_seconds=backoff,
        )

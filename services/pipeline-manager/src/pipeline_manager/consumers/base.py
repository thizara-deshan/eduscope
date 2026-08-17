from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..models import ConsumerState
from ..pipelines.builder import PipelineSpec
from ..publishers.base import RestartBudget
from ..supervisor.health import HealthConfirmer
from ..supervisor.ledger import EncodeLedger
from ..supervisor.process import ManagedProcess, ProcessSupervisor
from ..supervisor.stop import STOP_DEADLINE_SECONDS, SignalFn, send_group_signal, stop_process


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


class PublisherNotRunning(RuntimeError):
    def __init__(self, role) -> None:  # role: SourceRole, kept untyped to avoid an import cycle
        super().__init__(f"required publisher for {role.value} is not running")
        self.role = role


class CaptureCardRecovering(RuntimeError):
    pass


class ConsumerNotRunning(RuntimeError):
    pass


class ConsumerController:
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
    ) -> None:
        self.consumer_id = consumer_id
        self.restart_class = restart_class
        self._supervisor = supervisor
        self._ledger = ledger
        self._confirmer = confirmer
        self._send_signal = send_signal
        self.restart_budget = restart_budget or RestartBudget()

        self.state = ConsumerState.EXITED
        self.process: ManagedProcess | None = None
        self.pgid: int | None = None
        self.spec: PipelineSpec | None = None

    async def spawn(self, spec: PipelineSpec, *, priority: str = "guaranteed") -> ConsumerEvent:
        self.spec = spec
        self.state = ConsumerState.STARTING
        reservation = self._ledger.acquire(self.consumer_id, spec.encode_slots, priority)
        try:
            self.process = await self._supervisor.start(spec, self.consumer_id)
            reservation.commit()
            await self._confirmer.confirm(self.process, is_record=False)
        except Exception:
            self._ledger.release(self.consumer_id)
            self.state = ConsumerState.FAILED
            raise

        self.pgid = self.process.pgid
        self.state = ConsumerState.RUNNING
        self.restart_budget.reset()
        return ConsumerEvent(consumer_id=self.consumer_id, kind="running", state=ConsumerState.RUNNING, pgid=self.pgid)

    async def stop(self, deadline_seconds: float = STOP_DEADLINE_SECONDS) -> ConsumerEvent:
        if self.process is None:
            raise ConsumerNotRunning(f"{self.consumer_id} is not running")

        self.state = ConsumerState.STOPPING
        result = await stop_process(self.process, deadline_seconds, send_signal=self._send_signal)
        self._ledger.release(self.consumer_id)
        self.state = ConsumerState.EXITED if result.clean_eos else ConsumerState.FAILED
        return ConsumerEvent(
            consumer_id=self.consumer_id,
            kind="eos" if result.clean_eos else "eos_timeout",
            state=self.state,
            truncated=not result.clean_eos,
            error_code=result.error_code,
        )

    def on_unexpected_exit(self) -> ConsumerEvent:
        self._ledger.release(self.consumer_id)
        if self.restart_budget.exhausted:
            self.state = ConsumerState.FAILED
            return ConsumerEvent(
                consumer_id=self.consumer_id, kind="exited", state=ConsumerState.FAILED, reason="unexpected"
            )
        self.restart_budget.record_attempt()
        self.state = ConsumerState.EXITED
        return ConsumerEvent(
            consumer_id=self.consumer_id, kind="exited", state=ConsumerState.EXITED, reason="unexpected"
        )

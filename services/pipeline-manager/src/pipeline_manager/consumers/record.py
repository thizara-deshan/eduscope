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
from .base import CaptureCardRecovering, ConsumerEvent, ConsumerNotRunning, PublisherNotRunning

START_CONFIRM_TIMEOUT_SECONDS = 5.0


class RecordConsumer:
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
    ) -> None:
        self.consumer_id = consumer_id
        self._supervisor = supervisor
        self._ledger = ledger
        self._confirmer = confirmer
        self._platform = platform
        self._is_publisher_running = is_publisher_running
        self._is_capture_card_recovering = is_capture_card_recovering
        self._send_signal = send_signal
        self._restart_budget = restart_budget or RestartBudget()

        self.state = ConsumerState.EXITED  # not yet started
        self.output_path: str | None = None
        self.pgid: int | None = None
        self.truncated = False
        self.restarts = 0
        self.process: ManagedProcess | None = None

    async def start(self, request: RecordRequest) -> ConsumerEvent:
        spec = build_record(request, self._platform)

        for role in spec.required_roles:
            if not self._is_publisher_running(role):
                raise PublisherNotRunning(f"required publisher for {role.value} is not running")
        if SourceRole.PRESENTATION in spec.required_roles and self._is_capture_card_recovering():
            raise CaptureCardRecovering("capture card is recovering")

        self.state = ConsumerState.STARTING
        reservation = self._ledger.acquire(self.consumer_id, spec.encode_slots, "guaranteed")
        try:
            self.process = await self._supervisor.start(spec, self.consumer_id)
            reservation.commit()
            await self._confirmer.confirm(
                self.process,
                is_record=True,
                output_path=spec.outputs[0],
                timeout=START_CONFIRM_TIMEOUT_SECONDS,
            )
        except Exception:
            self._ledger.release(self.consumer_id)
            self.state = ConsumerState.FAILED
            raise

        self.output_path = spec.outputs[0]
        self.pgid = self.process.pgid
        self.truncated = False
        self.state = ConsumerState.RUNNING
        self._restart_budget.reset()
        return ConsumerEvent(consumer_id=self.consumer_id, kind="running", state=ConsumerState.RUNNING, pgid=self.pgid)

    async def pause(self) -> ConsumerEvent:
        return await self._eos_stop(PAUSE_DEADLINE_SECONDS)

    async def stop(self) -> ConsumerEvent:
        return await self._eos_stop(STOP_DEADLINE_SECONDS)

    async def _eos_stop(self, deadline_seconds: float) -> ConsumerEvent:
        if self.process is None:
            raise ConsumerNotRunning(f"{self.consumer_id} is not running")

        self.state = ConsumerState.STOPPING
        result = await stop_process(self.process, deadline_seconds, send_signal=self._send_signal)
        self._ledger.release(self.consumer_id)

        if result.clean_eos:
            self.state = ConsumerState.EXITED
            self.truncated = False
            return ConsumerEvent(consumer_id=self.consumer_id, kind="eos", state=ConsumerState.EXITED, truncated=False)

        self.state = ConsumerState.FAILED
        self.truncated = True
        return ConsumerEvent(
            consumer_id=self.consumer_id,
            kind="eos_timeout",
            state=ConsumerState.FAILED,
            truncated=True,
            error_code="eos_timeout",
        )

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

        self._restart_budget.record_attempt()
        self.restarts += 1
        self.state = ConsumerState.EXITED
        return ConsumerEvent(
            consumer_id=self.consumer_id,
            kind="exited",
            state=ConsumerState.EXITED,
            reason="unexpected",
            truncated=True,
        )

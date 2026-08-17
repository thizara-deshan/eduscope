from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Callable

from ..models import ConsumerState, SourceRole
from ..pipelines.builder import PipelineSpec
from ..pipelines.thumbnails import ThumbnailOffer, worker_argv
from ..supervisor.health import HealthConfirmer
from ..supervisor.ledger import EncodeLedger
from ..supervisor.process import ManagedProcess, ProcessSupervisor
from ..supervisor.stop import STOP_DEADLINE_SECONDS, SignalFn, send_group_signal, stop_process
from .base import ConsumerEvent


class RoleNotPreviewable(RuntimeError):
    pass


@dataclass
class ThumbnailNegotiation:
    negotiation_id: str
    role_id: SourceRole
    process: ManagedProcess


class ThumbnailController:
    """One worker subprocess per negotiation, only the provisional third
    ledger slot — never a guaranteed record/live slot (A-06/A-07). Validates
    the public-envelope-equivalent model and translates it to A-06 worker
    messages; never opens a frontend socket itself (A-14/B map its typed
    internal events through core-api's bridge to contracts/events.md §3).
    """

    def __init__(
        self,
        *,
        supervisor: ProcessSupervisor,
        ledger: EncodeLedger,
        confirmer: HealthConfirmer | None = None,
        is_role_online_and_bound: Callable[[SourceRole], bool] = lambda role: True,
        python_executable: str = sys.executable,
        send_signal: SignalFn = send_group_signal,
    ) -> None:
        self._supervisor = supervisor
        self._ledger = ledger
        self._confirmer = confirmer
        self._is_role_online_and_bound = is_role_online_and_bound
        self._python_executable = python_executable
        self._send_signal = send_signal
        self.negotiations: dict[str, ThumbnailNegotiation] = {}

    def _consumer_id(self, negotiation_id: str) -> str:
        return f"thumbnails:{negotiation_id}"

    async def offer(self, offer: ThumbnailOffer) -> ConsumerEvent:
        if not self._is_role_online_and_bound(offer.role_id):
            raise RoleNotPreviewable(f"{offer.role_id.value} is not online/bound")

        if offer.negotiation_id in self.negotiations:
            await self.close(offer.negotiation_id)  # a second offer closes the first

        consumer_id = self._consumer_id(offer.negotiation_id)
        spec = PipelineSpec(
            argv=worker_argv(self._python_executable),
            required_roles=(offer.role_id,),
            encode_slots=1,
            outputs=(),
        )
        reservation = self._ledger.acquire(consumer_id, 1, "provisional")
        try:
            process = await self._supervisor.start(spec, consumer_id)
            reservation.commit()
        except Exception:
            self._ledger.release(consumer_id)
            raise

        self.negotiations[offer.negotiation_id] = ThumbnailNegotiation(
            negotiation_id=offer.negotiation_id, role_id=offer.role_id, process=process
        )
        return ConsumerEvent(consumer_id=consumer_id, kind="running", state=ConsumerState.RUNNING, pgid=process.pgid)

    async def close(self, negotiation_id: str) -> ConsumerEvent | None:
        """Idempotent — closing an unknown or already-closed negotiation is a no-op."""
        negotiation = self.negotiations.pop(negotiation_id, None)
        if negotiation is None:
            return None

        consumer_id = self._consumer_id(negotiation_id)
        result = await stop_process(negotiation.process, STOP_DEADLINE_SECONDS, send_signal=self._send_signal)
        self._ledger.release(consumer_id)
        return ConsumerEvent(
            consumer_id=consumer_id,
            kind="eos" if result.clean_eos else "eos_timeout",
            state=ConsumerState.EXITED if result.clean_eos else ConsumerState.FAILED,
            truncated=not result.clean_eos,
        )

    def negotiation_count(self) -> int:
        return len(self.negotiations)

    def negotiations_for_role(self, role_id: SourceRole) -> tuple[str, ...]:
        """Used to emit a terminal `source-offline` error and close every
        negotiation bound to a role that just went offline."""
        return tuple(nid for nid, neg in self.negotiations.items() if neg.role_id == role_id)

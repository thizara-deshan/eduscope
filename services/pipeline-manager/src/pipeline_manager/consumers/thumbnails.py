from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from typing import Callable

from ..models import ConsumerState, SourceRole
from ..pipelines.builder import PipelineSpec
from ..pipelines.platforms.base import PlatformProfile
from ..pipelines.platforms.rk3588 import RK3588Profile
from ..pipelines.thumbnails import (
    ThumbnailAnswer,
    ThumbnailIce,
    ThumbnailIceOut,
    ThumbnailOffer,
    ThumbnailPlaying,
    ThumbnailWorkerError,
    parse_worker_output_line,
    worker_argv,
    worker_graph,
)
from ..supervisor.health import HealthConfirmer
from ..supervisor.ledger import EncodeLedger
from ..supervisor.process import ManagedProcess, ProcessSupervisor
from ..supervisor.stop import STOP_DEADLINE_SECONDS, SignalFn, send_group_signal, stop_process
from .base import ConsumerEvent

# How often the output pump polls a negotiation's worker for new stdout
# lines (answer/ICE/error frames) — the worker itself pushes as soon as
# GStreamer/webrtcbin produces something, this only bounds parent latency.
OUTPUT_POLL_INTERVAL_SECONDS = 0.05


class RoleNotPreviewable(RuntimeError):
    pass


@dataclass
class ThumbnailNegotiation:
    negotiation_id: str
    role_id: SourceRole
    process: ManagedProcess


def _event_payload(message) -> dict:
    """The `evt.pm.thumbnails.signal` data shape (tests/fixtures/events/
    thumbnail-signaling.json) — the one translation point from the worker's
    internal snake_case wire messages to the camelCase contract shape."""
    if isinstance(message, ThumbnailAnswer):
        return {"type": "answer", "negotiationId": message.negotiation_id, "sdp": message.sdp}
    if isinstance(message, ThumbnailIceOut):
        return {
            "type": "ice",
            "negotiationId": message.negotiation_id,
            "candidate": message.candidate,
            "sdpMid": message.sdp_mid,
            "sdpMLineIndex": message.sdp_mline_index,
        }
    if isinstance(message, ThumbnailWorkerError):
        return {
            "type": "error",
            "negotiationId": message.negotiation_id,
            "code": message.code,
            "message": message.message,
        }
    if isinstance(message, ThumbnailPlaying):
        return {"type": "playing", "negotiationId": message.negotiation_id}
    raise TypeError(f"unhandled outbound thumbnail message: {message!r}")  # pragma: no cover - exhaustive


class ThumbnailController:
    """One worker subprocess per negotiation, only the provisional third
    ledger slot — never a guaranteed record/live slot (A-06/A-07). Validates
    the public-envelope-equivalent model and translates it to A-06 worker
    messages; never opens a frontend socket itself (A-14/B map its typed
    internal events through core-api's bridge to contracts/events.md §3).

    A-REV-008: the worker is a real long-running GStreamer/webrtcbin process
    (`pipelines.thumbnails._run_gst_worker`) — `offer()` writes the SDP
    offer to its stdin right after spawn, `send_ice()` forwards trickled
    candidates the same way, and a background pump relays the worker's
    answer/ICE/error/playing stdout lines back out as `evt.pm.thumbnails.*`.
    """

    def __init__(
        self,
        *,
        supervisor: ProcessSupervisor,
        ledger: EncodeLedger,
        confirmer: HealthConfirmer | None = None,
        events=None,
        platform: PlatformProfile | None = None,
        is_role_online_and_bound: Callable[[SourceRole], bool] = lambda role: True,
        python_executable: str = sys.executable,
        send_signal: SignalFn = send_group_signal,
    ) -> None:
        self._supervisor = supervisor
        self._ledger = ledger
        self._confirmer = confirmer
        self._events = events
        self._platform = platform or RK3588Profile()
        self._is_role_online_and_bound = is_role_online_and_bound
        self._python_executable = python_executable
        self._send_signal = send_signal
        self.negotiations: dict[str, ThumbnailNegotiation] = {}
        self.allowed_roles: frozenset[SourceRole] | None = None
        self._pump_tasks: dict[str, asyncio.Task] = {}

    def set_allowed_roles(self, roles: "frozenset[SourceRole] | None") -> None:
        """`None` means no restriction (previews for any online/bound role);
        a set restricts which roles `offer()` will negotiate."""
        self.allowed_roles = roles

    def _consumer_id(self, negotiation_id: str) -> str:
        return f"thumbnails:{negotiation_id}"

    async def offer(self, offer: ThumbnailOffer) -> ConsumerEvent:
        if self.allowed_roles is not None and offer.role_id not in self.allowed_roles:
            raise RoleNotPreviewable(f"{offer.role_id.value} is not an enabled preview source")
        if not self._is_role_online_and_bound(offer.role_id):
            raise RoleNotPreviewable(f"{offer.role_id.value} is not online/bound")

        if offer.negotiation_id in self.negotiations:
            await self.close(offer.negotiation_id)  # a second offer closes the first

        consumer_id = self._consumer_id(offer.negotiation_id)
        graph = worker_graph(offer.role_id, self._platform)
        spec = PipelineSpec(
            argv=worker_argv(self._python_executable, graph=graph),
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

        self._write_control_line(process, offer.model_dump_json())

        negotiation = ThumbnailNegotiation(negotiation_id=offer.negotiation_id, role_id=offer.role_id, process=process)
        self.negotiations[offer.negotiation_id] = negotiation
        self._pump_tasks[offer.negotiation_id] = asyncio.create_task(self._pump_worker_output(negotiation))
        return ConsumerEvent(consumer_id=consumer_id, kind="running", state=ConsumerState.RUNNING, pgid=process.pgid)

    def send_ice(
        self, negotiation_id: str, *, candidate: str, sdp_mid: str | None, sdp_mline_index: int | None
    ) -> bool:
        """Forward a trickled ICE candidate to the running worker. Returns
        False (a silent no-op) for an unknown/already-closed negotiation —
        the route layer is the one that decides whether that's a 404."""
        negotiation = self.negotiations.get(negotiation_id)
        if negotiation is None:
            return False
        message = ThumbnailIce(
            type="ice", negotiation_id=negotiation_id, candidate=candidate, sdp_mid=sdp_mid, sdp_mline_index=sdp_mline_index
        )
        self._write_control_line(negotiation.process, message.model_dump_json())
        return True

    def _write_control_line(self, process: ManagedProcess, json_line: str) -> None:
        stdin = process.popen.stdin
        if stdin is None:
            return
        stdin.write(json_line + "\n")
        stdin.flush()

    async def _pump_worker_output(self, negotiation: ThumbnailNegotiation) -> None:
        """Tails the worker's already-captured raw stdout/stderr lines
        (`ManagedProcess.raw_lines`, populated by `ProcessSupervisor`'s own
        reader thread) for signaling frames the generic bus-line classifier
        doesn't recognize, and republishes them as `evt.pm.thumbnails.*`.
        """
        process = negotiation.process
        cursor = 0
        try:
            while negotiation.negotiation_id in self.negotiations:
                lines = process.raw_lines[cursor:]
                cursor += len(lines)
                for line in lines:
                    message = parse_worker_output_line(line)
                    if message is not None and self._events is not None:
                        await self._events.publish("evt.pm.thumbnails.signal", _event_payload(message))
                if process.popen.poll() is not None:
                    return
                await asyncio.sleep(OUTPUT_POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            return

    async def close(self, negotiation_id: str) -> ConsumerEvent | None:
        """Idempotent — closing an unknown or already-closed negotiation is a no-op."""
        negotiation = self.negotiations.pop(negotiation_id, None)
        if negotiation is None:
            return None

        pump = self._pump_tasks.pop(negotiation_id, None)
        if pump is not None:
            pump.cancel()

        consumer_id = self._consumer_id(negotiation_id)
        result = await stop_process(negotiation.process, STOP_DEADLINE_SECONDS, send_signal=self._send_signal)
        self._supervisor.forget(consumer_id)
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

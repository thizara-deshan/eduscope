from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Literal

from .helper_client import HelperClient

CaptureCardState = Literal["present", "absent", "recovering", "failed"]

PROBE_INTERVAL_SECONDS = 30.0  # T-CAPTURE-PROBE
CONSECUTIVE_MISSES_BEFORE_ABSENT = 2
MAX_CYCLES_PER_HOUR = 2
CYCLE_WINDOW_SECONDS = 3600.0
RECOVER_TIMEOUT_SECONDS = 25.0  # T-CAPTURE-RECOVER


@dataclass(frozen=True)
class ProbeResult:
    returncode: int
    stdout: str = ""


ProbeFn = Callable[[], Awaitable[ProbeResult]]


@dataclass
class CaptureCardWatchdog:
    """Supervised, in-uptime capture-card watchdog (B-39 successor). Probes
    `v4l2-ctl --list-devices` via an argv-only injected runner and matches the
    configured stable identifier. While absent/recovering it only updates the
    source-health projection — it never reaches into camera runtime process
    ownership (that boundary is structural: this module has no such import).
    """

    stable_identifier: str
    hub_location: str
    hub_port: int
    helper: HelperClient
    probe: ProbeFn
    clock: Callable[[], float] = field(default=time.monotonic)

    state: CaptureCardState = "present"
    consecutive_misses: int = 0
    cycle_timestamps: "deque[float]" = field(default_factory=deque)

    def _matches(self, result: ProbeResult) -> bool:
        return result.returncode == 0 and self.stable_identifier in result.stdout

    def _prune_cycles(self) -> None:
        cutoff = self.clock() - CYCLE_WINDOW_SECONDS
        while self.cycle_timestamps and self.cycle_timestamps[0] < cutoff:
            self.cycle_timestamps.popleft()

    async def tick(self) -> CaptureCardState:
        """One probe cycle (called every T-CAPTURE-PROBE)."""
        result = await self.probe()

        if self._matches(result):
            self.consecutive_misses = 0
            self.state = "present"
            return self.state

        self.consecutive_misses += 1
        if self.consecutive_misses < CONSECUTIVE_MISSES_BEFORE_ABSENT:
            return self.state  # not yet two consecutive misses

        self.state = "absent"
        self._prune_cycles()
        if len(self.cycle_timestamps) >= MAX_CYCLES_PER_HOUR:
            self.state = "failed"
            return self.state

        self.cycle_timestamps.append(self.clock())
        self.state = "recovering"
        await self.helper.cycle_usb_hub(self.hub_location, self.hub_port)
        return self.state

    async def confirm_recovery(
        self,
        *,
        deadline_seconds: float = RECOVER_TIMEOUT_SECONDS,
        poll_interval: float = 1.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> CaptureCardState:
        """Called after a cycle: re-enumerates <= T-CAPTURE-RECOVER (25s) ->
        present, else failed and needs a human."""
        deadline = self.clock() + deadline_seconds
        while True:
            result = await self.probe()
            if self._matches(result):
                self.state = "present"
                self.consecutive_misses = 0
                return self.state
            if self.clock() >= deadline:
                self.state = "failed"
                return self.state
            await sleep(poll_interval)


async def run_watchdog_loop(
    watchdog: CaptureCardWatchdog,
    *,
    interval: float = PROBE_INTERVAL_SECONDS,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    stop_event: "asyncio.Event | None" = None,
) -> None:
    """Supervised probe loop: one `tick()` every `interval`, guarded so a
    transient probe/hub-cycle error never tears the loop down. Cancel the task
    (or set `stop_event`) to stop it — the FastAPI lifespan cancels it on
    shutdown. On the board this runs for the process lifetime; off-board the
    default probe simply reports the card absent.
    """
    while stop_event is None or not stop_event.is_set():
        try:
            await watchdog.tick()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - a probe/helper error must not kill the loop
            pass
        await sleep(interval)

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Literal

from .helper_client import HelperClient

_LOGGER = logging.getLogger(__name__)

CaptureCardState = Literal["present", "absent", "recovering", "failed"]

CAPTURE_CARD_EVENT_KIND = "evt.pm.device.captureCard"

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


async def real_v4l2_probe() -> ProbeResult:
    """Argv-only `v4l2-ctl --list-devices` adapter (A-REV-013) — the real
    `watchdog.probe` seam `create_production_app` injects. Never a shell —
    `asyncio.create_subprocess_exec` only.
    A nonzero exit still yields a `ProbeResult` (`_matches` reports it as a
    miss, same as any other absent-card cycle); a missing `v4l2-ctl` binary
    raises `FileNotFoundError`, which `run_watchdog_loop`'s own guard logs
    and treats as a skipped cycle rather than tearing the loop down.
    """
    process = await asyncio.create_subprocess_exec(
        "v4l2-ctl", "--list-devices",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await process.communicate()
    returncode = process.returncode if process.returncode is not None else 1
    return ProbeResult(returncode=returncode, stdout=stdout.decode("utf-8", errors="replace"))


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
    events=None,
) -> None:
    """Supervised probe loop: one `tick()` every `interval`, guarded so a
    transient probe/hub-cycle error never tears the loop down. Cancel the task
    (or set `stop_event`) to stop it — the FastAPI lifespan cancels it on
    shutdown. On the board this runs for the process lifetime; off-board the
    default probe simply reports the card absent.

    A-REV-013: a cycle that lands on "recovering" immediately calls
    `confirm_recovery` — T-CAPTURE-RECOVER's 25s deadline starts right after
    the hub cycle, not after an additional up-to-`interval`-second wait for
    the next scheduled tick. Every state *change* (not every tick) publishes
    `evt.pm.device.captureCard` on `events` (optional — omitted in hermetic
    unit tests, always passed by `app.py`'s real `EventBroker`, which is
    infrastructure, not a hardware seam). A caught exception is logged, never
    silently discarded — the loop still survives it, same as before.
    """
    while stop_event is None or not stop_event.is_set():
        try:
            previous = watchdog.state
            state = await watchdog.tick()
            if state != previous:
                await _publish_transition(events, state)
            if state == "recovering":
                confirmed = await watchdog.confirm_recovery(sleep=sleep)
                if confirmed != state:
                    await _publish_transition(events, confirmed)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a probe/helper error must not kill the loop
            _LOGGER.warning("capture-card watchdog cycle failed: %s", exc)
        await sleep(interval)


async def _publish_transition(events, state: CaptureCardState) -> None:
    if events is not None:
        await events.publish(CAPTURE_CARD_EVENT_KIND, {"state": state})

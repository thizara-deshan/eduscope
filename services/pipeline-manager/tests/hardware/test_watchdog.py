from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pytest

from pipeline_manager.hardware.watchdog import (
    CONSECUTIVE_MISSES_BEFORE_ABSENT,
    MAX_CYCLES_PER_HOUR,
    PROBE_INTERVAL_SECONDS,
    RECOVER_TIMEOUT_SECONDS,
    CaptureCardWatchdog,
    ProbeResult,
)

STABLE_ID = "usb-v4l2-eduscope-dongle-001"


class FakeClock:
    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds

    async def sleep(self, seconds: float) -> None:
        self.advance(seconds)


@dataclass
class SpyHelper:
    calls: list = field(default_factory=list)

    async def cycle_usb_hub(self, location, port):
        self.calls.append((location, port))
        return None


def _present() -> ProbeResult:
    return ProbeResult(returncode=0, stdout=f"video0: dongle ({STABLE_ID})")


def _absent() -> ProbeResult:
    return ProbeResult(returncode=0, stdout="video0: some-other-device (unrelated)")


def _watchdog(probe, clock=None) -> CaptureCardWatchdog:
    return CaptureCardWatchdog(
        stable_identifier=STABLE_ID,
        hub_location="1-2",
        hub_port=3,
        helper=SpyHelper(),
        probe=probe,
        clock=clock or FakeClock(),
    )


def test_probe_cadence_is_thirty_seconds() -> None:
    assert PROBE_INTERVAL_SECONDS == 30.0


def test_recover_timeout_is_twenty_five_seconds() -> None:
    assert RECOVER_TIMEOUT_SECONDS == 25.0


class TestConsecutiveMisses:
    @pytest.mark.asyncio
    async def test_single_miss_does_not_go_absent(self) -> None:
        watchdog = _watchdog(probe=lambda: _absent_async())
        state = await watchdog.tick()
        assert state == "present"  # default state, only one miss so far

    @pytest.mark.asyncio
    async def test_exactly_two_consecutive_misses_before_absent(self) -> None:
        assert CONSECUTIVE_MISSES_BEFORE_ABSENT == 2
        watchdog = _watchdog(probe=lambda: _absent_async())
        await watchdog.tick()
        state = await watchdog.tick()
        assert state in ("absent", "recovering")  # absent triggers an immediate cycle attempt

    @pytest.mark.asyncio
    async def test_presence_resets_miss_counter(self) -> None:
        calls = iter([_absent(), _present(), _absent(), _absent()])

        async def probe():
            return next(calls)

        watchdog = _watchdog(probe=probe)
        await watchdog.tick()  # miss 1
        await watchdog.tick()  # present -> resets
        await watchdog.tick()  # miss 1 again
        state = await watchdog.tick()  # miss 2 -> absent/recovering
        assert state in ("absent", "recovering")


class TestCycleBudget:
    @pytest.mark.asyncio
    async def test_recovering_state_reported_and_helper_cycled(self) -> None:
        calls = iter([_absent(), _absent()])

        async def probe():
            return next(calls)

        watchdog = _watchdog(probe=probe)
        await watchdog.tick()
        state = await watchdog.tick()
        assert state == "recovering"
        assert watchdog.helper.calls == [("1-2", 3)]

    @pytest.mark.asyncio
    async def test_max_two_cycles_per_rolling_hour_then_failed(self) -> None:
        clock = FakeClock()

        async def probe():
            return _absent()

        watchdog = _watchdog(probe=probe, clock=clock)
        assert MAX_CYCLES_PER_HOUR == 2

        # First absence -> one cycle.
        await watchdog.tick()
        await watchdog.tick()
        assert watchdog.state == "recovering"
        assert len(watchdog.helper.calls) == 1

        # Recovery fails; card goes absent again shortly after (within the hour) -> second cycle.
        clock.advance(60)
        watchdog.consecutive_misses = 0
        await watchdog.tick()
        await watchdog.tick()
        assert len(watchdog.helper.calls) == 2

        # Third absence within the same rolling hour -> budget exhausted -> failed.
        clock.advance(60)
        watchdog.consecutive_misses = 0
        await watchdog.tick()
        state = await watchdog.tick()
        assert state == "failed"
        assert len(watchdog.helper.calls) == 2  # no third cycle attempted

    @pytest.mark.asyncio
    async def test_cycles_older_than_an_hour_are_pruned(self) -> None:
        clock = FakeClock()

        async def probe():
            return _absent()

        watchdog = _watchdog(probe=probe, clock=clock)
        await watchdog.tick()
        await watchdog.tick()
        await watchdog.tick()
        await watchdog.tick()
        assert len(watchdog.helper.calls) == 2  # budget exhausted within this hour

        clock.advance(3601)
        watchdog.consecutive_misses = 0
        await watchdog.tick()
        state = await watchdog.tick()
        assert state == "recovering"  # budget refreshed after the rolling window
        assert len(watchdog.helper.calls) == 3


class TestConfirmRecovery:
    @pytest.mark.asyncio
    async def test_success_within_twenty_five_seconds_reports_present(self) -> None:
        clock = FakeClock()
        calls = iter([_absent(), _present()])

        async def probe():
            return next(calls)

        watchdog = _watchdog(probe=probe, clock=clock)
        watchdog.state = "recovering"

        state = await watchdog.confirm_recovery(deadline_seconds=25.0, poll_interval=1.0, sleep=clock.sleep)

        assert state == "present"
        assert watchdog.consecutive_misses == 0

    @pytest.mark.asyncio
    async def test_timeout_reports_failed(self) -> None:
        clock = FakeClock()

        async def probe():
            return _absent()

        watchdog = _watchdog(probe=probe, clock=clock)
        watchdog.state = "recovering"

        state = await watchdog.confirm_recovery(deadline_seconds=25.0, poll_interval=1.0, sleep=clock.sleep)

        assert state == "failed"


def test_watchdog_module_never_imports_consumers_or_publishers() -> None:
    """Structural guarantee: a camera-only record controller is never
    stopped by the watchdog — this module cannot even reach it."""
    source = Path(__import__("pipeline_manager.hardware.watchdog", fromlist=["x"]).__file__).read_text(
        encoding="utf-8"
    )
    assert "consumers" not in source
    assert "publishers" not in source


async def _absent_async() -> ProbeResult:
    return _absent()

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

import pytest

from pipeline_manager.hardware.watchdog import (
    CAPTURE_CARD_EVENT_KIND,
    CaptureCardWatchdog,
    ProbeResult,
    run_watchdog_loop,
)

IDENTIFIER = "eduscope-capture-dongle"


@dataclass
class SpyEvents:
    published: list = field(default_factory=list)

    async def publish(self, kind: str, data: dict) -> None:
        self.published.append((kind, data))


@dataclass
class SpyHelper:
    calls: list = field(default_factory=list)

    async def cycle_usb_hub(self, location, port):
        self.calls.append((location, port))
        return None


def _watchdog(probe) -> CaptureCardWatchdog:
    return CaptureCardWatchdog(
        stable_identifier=IDENTIFIER,
        hub_location="1-2",
        hub_port=3,
        helper=None,  # never reached: a present card never triggers a hub cycle
        probe=probe,
    )


@pytest.mark.asyncio
async def test_loop_ticks_until_stopped() -> None:
    calls: list[int] = []

    async def probe() -> ProbeResult:
        calls.append(1)
        return ProbeResult(returncode=0, stdout=IDENTIFIER)

    stop = asyncio.Event()

    async def fake_sleep(_seconds: float) -> None:
        if len(calls) >= 3:
            stop.set()

    watchdog = _watchdog(probe)
    await run_watchdog_loop(watchdog, sleep=fake_sleep, stop_event=stop)

    assert len(calls) == 3
    assert watchdog.state == "present"


@pytest.mark.asyncio
async def test_loop_survives_a_raised_probe_error() -> None:
    calls: list[int] = []

    async def probe() -> ProbeResult:
        calls.append(1)
        raise RuntimeError("v4l2 hiccup")

    stop = asyncio.Event()

    async def fake_sleep(_seconds: float) -> None:
        if len(calls) >= 2:
            stop.set()

    watchdog = _watchdog(probe)
    # must not raise: a transient probe error is logged (not silently
    # discarded, A-REV-013) and the loop continues
    await run_watchdog_loop(watchdog, sleep=fake_sleep, stop_event=stop)

    assert len(calls) == 2


@pytest.mark.asyncio
async def test_loop_logs_a_caught_probe_error(caplog: pytest.LogCaptureFixture) -> None:
    """A-REV-013: a caught cycle error must be observable (logged), not a
    bare `except Exception: pass`."""

    async def probe() -> ProbeResult:
        raise RuntimeError("v4l2 hiccup")

    stop = asyncio.Event()

    async def fake_sleep(_seconds: float) -> None:
        stop.set()

    watchdog = _watchdog(probe)
    with caplog.at_level(logging.WARNING, logger="pipeline_manager.hardware.watchdog"):
        await run_watchdog_loop(watchdog, sleep=fake_sleep, stop_event=stop)

    assert any("v4l2 hiccup" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_loop_exits_on_cancellation() -> None:
    async def probe() -> ProbeResult:
        return ProbeResult(returncode=0, stdout=IDENTIFIER)

    task = asyncio.create_task(run_watchdog_loop(_watchdog(probe), interval=0.01))
    await asyncio.sleep(0.03)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_loop_confirms_recovery_immediately_after_the_cycle_that_triggers_it() -> None:
    """A-REV-013: `confirm_recovery` fires in the same iteration as the hub
    cycle — it must not wait for the next scheduled probe interval — and
    every state *change* publishes `evt.pm.device.captureCard`."""
    results = iter(
        [
            ProbeResult(returncode=0, stdout="unrelated"),  # miss 1: stays present
            ProbeResult(returncode=0, stdout="unrelated"),  # miss 2: -> recovering, cycles hub
            ProbeResult(returncode=0, stdout=IDENTIFIER),  # confirm_recovery's own probe: present
        ]
    )
    probe_calls: list[int] = []

    async def probe() -> ProbeResult:
        probe_calls.append(1)
        return next(results)

    stop = asyncio.Event()
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) >= 2:
            stop.set()

    helper = SpyHelper()
    watchdog = CaptureCardWatchdog(
        stable_identifier=IDENTIFIER, hub_location="1-2", hub_port=3, helper=helper, probe=probe
    )
    events = SpyEvents()

    await run_watchdog_loop(watchdog, sleep=fake_sleep, stop_event=stop, events=events)

    assert len(probe_calls) == 3  # 2 ticks to reach recovering + 1 confirm_recovery probe
    assert helper.calls == [("1-2", 3)]  # exactly one hub cycle
    assert watchdog.state == "present"
    assert events.published == [
        (CAPTURE_CARD_EVENT_KIND, {"state": "recovering"}),
        (CAPTURE_CARD_EVENT_KIND, {"state": "present"}),
    ]


@pytest.mark.asyncio
async def test_loop_confirm_recovery_timeout_publishes_failed() -> None:
    """A-REV-013: a recovery that never re-enumerates within the deadline
    still gets its transition published, ending in `failed`."""

    async def probe() -> ProbeResult:
        return ProbeResult(returncode=0, stdout="unrelated")  # never matches

    stop = asyncio.Event()
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) >= 2:
            stop.set()

    class InstantClock:
        def __init__(self) -> None:
            self.now = 0.0

        def __call__(self) -> float:
            self.now += 100.0  # first confirm_recovery poll already past any deadline
            return self.now

    helper = SpyHelper()
    watchdog = CaptureCardWatchdog(
        stable_identifier=IDENTIFIER, hub_location="1-2", hub_port=3, helper=helper, probe=probe, clock=InstantClock()
    )
    events = SpyEvents()

    await run_watchdog_loop(watchdog, sleep=fake_sleep, stop_event=stop, events=events)

    assert watchdog.state == "failed"
    assert (CAPTURE_CARD_EVENT_KIND, {"state": "recovering"}) in events.published
    assert (CAPTURE_CARD_EVENT_KIND, {"state": "failed"}) in events.published


@pytest.mark.asyncio
async def test_loop_does_not_publish_when_events_is_none() -> None:
    """Unit-level default: `events=None` (the hermetic case) must not raise."""

    async def probe() -> ProbeResult:
        return ProbeResult(returncode=0, stdout=IDENTIFIER)

    stop = asyncio.Event()

    async def fake_sleep(_seconds: float) -> None:
        stop.set()

    watchdog = _watchdog(probe)
    await run_watchdog_loop(watchdog, sleep=fake_sleep, stop_event=stop)  # must not raise
    assert watchdog.state == "present"

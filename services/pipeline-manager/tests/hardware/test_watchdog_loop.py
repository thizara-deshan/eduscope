from __future__ import annotations

import asyncio

import pytest

from pipeline_manager.hardware.watchdog import CaptureCardWatchdog, ProbeResult, run_watchdog_loop

IDENTIFIER = "eduscope-capture-dongle"


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
    # must not raise: a transient probe error is swallowed and the loop continues
    await run_watchdog_loop(watchdog, sleep=fake_sleep, stop_event=stop)

    assert len(calls) == 2


@pytest.mark.asyncio
async def test_loop_exits_on_cancellation() -> None:
    async def probe() -> ProbeResult:
        return ProbeResult(returncode=0, stdout=IDENTIFIER)

    task = asyncio.create_task(run_watchdog_loop(_watchdog(probe), interval=0.01))
    await asyncio.sleep(0.03)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

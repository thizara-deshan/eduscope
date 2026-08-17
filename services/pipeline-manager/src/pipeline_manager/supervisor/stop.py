from __future__ import annotations

import asyncio
import os
import signal
from dataclasses import dataclass
from typing import Callable

from .process import ManagedProcess

PAUSE_DEADLINE_SECONDS = 5.0
STOP_DEADLINE_SECONDS = 8.0

SignalFn = Callable[[int, int], None]

# RK3588 production is POSIX-only and always has real SIGKILL; the fallback
# only lets this module import/execute on a non-POSIX dev host running tests.
SIGKILL = getattr(signal, "SIGKILL", signal.SIGTERM)


@dataclass(frozen=True)
class StopResult:
    clean_eos: bool
    truncated: bool
    exit_code: int | None
    error_code: str | None = None


def send_group_signal(pgid: int, sig: int) -> None:
    """Targeted signal to exactly one process group — never a broad-pattern
    process-kill tool or a shell (B-06/B-14 death). Production always runs on
    the RK3588 board (POSIX) where `os.killpg` is used; the `os.kill` fallback
    only lets this path execute end-to-end on a non-POSIX dev host running tests.
    """
    if hasattr(os, "killpg"):
        os.killpg(pgid, sig)
    else:
        os.kill(pgid, sig)


async def stop_process(
    process: ManagedProcess,
    deadline_seconds: float,
    *,
    send_signal: SignalFn = send_group_signal,
) -> StopResult:
    """SIGINT that consumer's process group, wait for `Got EOS` up to
    `deadline_seconds`, else escalate to SIGKILL. Releases only this
    process's ledger reservation is the caller's job, after this returns.
    """
    send_signal(process.pgid, signal.SIGINT)

    try:
        await asyncio.wait_for(process.eos_seen.wait(), timeout=deadline_seconds)
        await asyncio.to_thread(process.popen.wait)
        return StopResult(clean_eos=True, truncated=False, exit_code=process.popen.returncode)
    except asyncio.TimeoutError:
        send_signal(process.pgid, SIGKILL)
        await asyncio.to_thread(process.popen.wait)
        return StopResult(
            clean_eos=False,
            truncated=True,
            exit_code=process.popen.returncode,
            error_code="eos_timeout",
        )

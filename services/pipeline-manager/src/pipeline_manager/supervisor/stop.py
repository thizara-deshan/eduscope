from __future__ import annotations

import asyncio
import os
import signal
from contextlib import suppress
from dataclasses import dataclass
from typing import Callable

from .process import ManagedProcess, ProcessSupervisor

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
    """SIGINT that consumer's process group, then wait for **both** `Got EOS`
    and the child actually exiting, bounded by one monotonic deadline
    measured from the SIGINT (A-REV-006). A child that prints `Got EOS` but
    then never actually exits (a hung downstream muxer/sink) is escalated to
    SIGKILL at the same deadline, not left waiting forever past it — the
    previous version awaited the post-EOS exit with no timeout at all.
    Releases only this process's ledger reservation is the caller's job,
    after this returns.
    """
    send_signal(process.pgid, signal.SIGINT)

    loop = asyncio.get_running_loop()
    deadline_at = loop.time() + deadline_seconds
    exit_waiter = asyncio.ensure_future(asyncio.to_thread(process.popen.wait))

    def _remaining() -> float:
        return max(deadline_at - loop.time(), 0.0)

    clean = False
    with suppress(asyncio.TimeoutError):
        await asyncio.wait_for(process.eos_seen.wait(), timeout=_remaining())
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(exit_waiter), timeout=_remaining())
            clean = True

    if clean:
        return StopResult(clean_eos=True, truncated=False, exit_code=process.popen.returncode)

    # The child may already have exited and been reaped by `exit_waiter` in
    # the gap between deciding to escalate and sending the signal (e.g. it
    # died on its own right after the initial SIGINT) — a stale pgid is not
    # an error here, just nothing left to kill.
    with suppress(ProcessLookupError):
        send_signal(process.pgid, SIGKILL)
    await exit_waiter
    return StopResult(
        clean_eos=False,
        truncated=True,
        exit_code=process.popen.returncode,
        error_code="eos_timeout",
    )


async def kill_and_reap(
    supervisor: ProcessSupervisor,
    process: ManagedProcess,
    *,
    send_signal: SignalFn = send_group_signal,
) -> None:
    """Failed-start transactional rollback (A-REV-005): a process that spawned
    but never confirmed healthy must not linger as a registered, running
    orphan. Targeted SIGKILL of the group, reap it, close its pipes (which
    unblocks any reader thread still blocked in `readline`), cancel the
    reader futures, then drop the supervisor's registry entry.
    """
    with suppress(ProcessLookupError):
        send_signal(process.pgid, SIGKILL)
    await asyncio.to_thread(process.popen.wait)
    for stream in (process.popen.stdin, process.popen.stdout, process.popen.stderr):
        if stream is not None:
            with suppress(Exception):
                stream.close()
    supervisor.forget(process.identity)

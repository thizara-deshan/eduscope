"""Arch integ-A coverage for B4 (A-REV-007): a real fake_child.py subprocess,
a real runtime_dir on disk, and a real second `create_app` instance standing
in for "the manager restarted while a recording was still running." POSIX-only
— /proc and killpg are verified on the target; a non-POSIX dev host skips
these.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from contextlib import suppress
from functools import partial
from pathlib import Path

import httpx
import pytest

from pipeline_manager.app import _run_shutdown, _run_startup, create_app
from pipeline_manager.config import Settings
from pipeline_manager.models import ConsumerState
from pipeline_manager.pipelines.builder import PipelineSpec
from pipeline_manager.supervisor.recovery import (
    SIDECAR_MARKER,
    Sidecar,
    argv_hash,
    read_sidecars,
    real_expected_processes,
    real_proc_scanner,
    write_sidecar,
)

FAKE_CHILD = Path(__file__).resolve().parents[1] / "supervisor" / "fake_child.py"
TOKEN = "0123456789abcdef0123456789abcdef"
AUTH_HEADERS = {"Authorization": f"Bearer {TOKEN}"}

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="/proc and killpg are POSIX-only; verified on target"
)


def _spec_grow(output_path: str) -> PipelineSpec:
    return PipelineSpec(
        argv=(sys.executable, str(FAKE_CHILD), f"grow:{output_path}"),
        required_roles=(),
        encode_slots=0,
        outputs=(output_path,),
    )


def _wire_real_recovery(app, runtime_dir: Path) -> None:
    """The two seams this batch adds — everything else about `app` stays the
    hermetic `create_app` default, same as the rest of the Integ-A suite."""
    app.state.proc_scanner = real_proc_scanner
    app.state.expected_processes = partial(real_expected_processes, runtime_dir)


async def _cancel_watchdog(app) -> None:
    task = app.state.watchdog_task
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def _until(predicate, *, timeout: float = 5.0, interval: float = 0.05) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError("condition never became true within the timeout")


@pytest.mark.asyncio
async def test_manager_restart_adopts_a_live_record_from_real_proc(tmp_path, monkeypatch) -> None:
    """start a record (real fake_child) -> abandon the app instance without a
    graceful shutdown (a crash: the child, in its own session, keeps running)
    -> a second instance sharing the same runtime_dir boots, adopts it from a
    real /proc read, reports it truthfully via /status, and can stop it."""
    import pipeline_manager.consumers.record as record_module

    output_path = str(tmp_path / "seg.ts")
    monkeypatch.setattr(record_module, "build_record", lambda request, platform: _spec_grow(output_path))

    runtime_dir = tmp_path / "runtime"
    settings = Settings(shared_bearer_token=TOKEN, recordings_root=tmp_path, runtime_dir=runtime_dir)

    app1 = create_app(settings, popen=subprocess.Popen, runtime_dir=runtime_dir)
    _wire_real_recovery(app1, runtime_dir)
    await _run_startup(app1)

    pid: int | None = None
    try:
        transport1 = httpx.ASGITransport(app=app1)
        async with httpx.AsyncClient(transport=transport1, base_url="http://testserver") as client1:
            resp = await client1.post(
                "/consumers/record",
                json={"preset": "cam-1", "outputPath": output_path},
                headers=AUTH_HEADERS,
            )
            assert resp.status_code == 202
            consumer_id = resp.json()["consumerId"]

        consumer1 = app1.state.consumers[consumer_id]
        assert consumer1.state is ConsumerState.RUNNING
        pid = consumer1.process.pid
        await _cancel_watchdog(app1)  # test hygiene only — not part of the "crash"

        # --- simulate a manager restart: a fresh app, same runtime_dir ---
        app2 = create_app(settings, popen=subprocess.Popen, runtime_dir=runtime_dir)
        _wire_real_recovery(app2, runtime_dir)
        await _run_startup(app2)
        try:
            assert [a.identity for a in app2.state.recovery.adopted] == [consumer_id]
            assert app2.state.recovery.foreign == ()

            adopted = app2.state.consumers[consumer_id]
            assert adopted.adopted is True
            assert adopted.state is ConsumerState.RUNNING
            assert adopted.process is not None
            assert adopted.process.pid == pid
            assert adopted.output_path == output_path

            transport2 = httpx.ASGITransport(app=app2)
            async with httpx.AsyncClient(transport=transport2, base_url="http://testserver") as client2:
                status = (await client2.get("/status", headers=AUTH_HEADERS)).json()
                entry = next(c for c in status["consumers"] if c["id"] == consumer_id)
                assert entry["state"] == "running"
                assert entry["output"] == output_path
                assert entry["pgid"] == adopted.pgid

            # stop safely: no stdout pipe survives adoption, so this always
            # falls through to the SIGKILL deadline rather than a clean EOS —
            # still a bounded, safe termination, not a hang.
            event = await asyncio.wait_for(adopted._eos_stop(0.75), timeout=5.0)
            assert event.truncated is True
            assert adopted.process is None
            assert adopted.state is ConsumerState.FAILED  # no EOS observed -> not a clean stop
            assert read_sidecars(runtime_dir) == []

            await _until(lambda: not _pid_alive(pid))
        finally:
            await _run_shutdown(app2)
    finally:
        if pid is not None:
            with suppress(ProcessLookupError):
                os.kill(pid, 9)


@pytest.mark.asyncio
async def test_foreign_process_with_a_mismatched_sidecar_is_never_signaled(tmp_path) -> None:
    """A live process this instance never spawned, whose sidecar's argv_hash
    doesn't match what's actually running under that pid: reported foreign,
    left completely alone (not adopted, no signal sent)."""
    runtime_dir = tmp_path / "runtime"
    settings = Settings(shared_bearer_token=TOKEN, recordings_root=tmp_path, runtime_dir=runtime_dir)

    foreign = subprocess.Popen([sys.executable, str(FAKE_CHILD), "hang"], start_new_session=True)
    try:
        pgid = os.getpgid(foreign.pid)
        write_sidecar(
            runtime_dir,
            Sidecar(
                marker=SIDECAR_MARKER,
                identity="record:foreign",
                pid=foreign.pid,
                pgid=pgid,
                argv_hash=argv_hash(("not", "the", "real", "argv")),
                kind="record",
                output_path=None,
                started_at_ms=0,
                proc_start_ticks=0,
            ),
        )

        app = create_app(settings, popen=subprocess.Popen, runtime_dir=runtime_dir)
        _wire_real_recovery(app, runtime_dir)
        await _run_startup(app)
        try:
            assert app.state.recovery.adopted == ()
            assert app.state.recovery.foreign[0].identity == "record:foreign"
            assert app.state.recovery.foreign[0].reason == "argv_mismatch"
            assert "record:foreign" not in app.state.consumers
            assert foreign.poll() is None  # still alive — never signaled
        finally:
            await _run_shutdown(app)
    finally:
        foreign.terminate()
        foreign.wait(timeout=5)


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True

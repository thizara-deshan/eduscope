from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from pipeline_manager.supervisor.recovery import (
    SIDECAR_MARKER,
    ExpectedProcess,
    ProcStat,
    Sidecar,
    argv_hash,
    read_sidecars,
    real_expected_processes,
    real_proc_scanner,
    recover_orphans,
    remove_sidecar,
    sidecar_path,
    write_sidecar,
)

EXE = "/usr/bin/gst-launch-1.0"
ARGV = ("gst-launch-1.0", "-e", "-m", "shmsrc")


def _sidecar(identity: str, pid: int, pgid: int, argv: tuple[str, ...] = ARGV, ticks: int = 1000) -> Sidecar:
    return Sidecar(
        marker=SIDECAR_MARKER,
        identity=identity,
        pid=pid,
        pgid=pgid,
        argv_hash=argv_hash(argv),
        kind="record",
        output_path="/media/eduscope/recordings/seg.ts",
        started_at_ms=1_700_000_000_000,
        proc_start_ticks=ticks,
    )


def _expected(identity: str, argv: tuple[str, ...] = ARGV) -> ExpectedProcess:
    return ExpectedProcess(identity=identity, argv=argv, kind="record", executable=EXE)


def test_write_and_read_sidecar_roundtrip(tmp_path: Path) -> None:
    sidecar = _sidecar("record:1", pid=100, pgid=100)
    write_sidecar(tmp_path, sidecar)
    read_back = read_sidecars(tmp_path)
    assert read_back == [sidecar]


def test_adopts_exact_executable_identity_argv_and_ticks_match(tmp_path: Path) -> None:
    write_sidecar(tmp_path, _sidecar("record:1", pid=100, pgid=100, ticks=1000))
    result = recover_orphans(
        [_expected("record:1")],
        tmp_path,
        proc_scanner=lambda pid: ProcStat(start_time_ticks=1000, executable=EXE),
    )
    assert len(result.adopted) == 1
    assert result.adopted[0].identity == "record:1"
    assert result.adopted[0].pid == 100
    assert result.foreign == ()


def test_pid_reuse_is_detected_via_start_time_mismatch(tmp_path: Path) -> None:
    write_sidecar(tmp_path, _sidecar("record:1", pid=100, pgid=100, ticks=1000))
    result = recover_orphans(
        [_expected("record:1")],
        tmp_path,
        proc_scanner=lambda pid: ProcStat(start_time_ticks=9999, executable=EXE),  # different process now
    )
    assert result.adopted == ()
    assert result.foreign[0].reason == "pid_reused"


def test_executable_mismatch_is_foreign(tmp_path: Path) -> None:
    write_sidecar(tmp_path, _sidecar("record:1", pid=100, pgid=100))
    result = recover_orphans(
        [_expected("record:1")],
        tmp_path,
        proc_scanner=lambda pid: ProcStat(start_time_ticks=1000, executable="/bin/some-other-binary"),
    )
    assert result.adopted == ()
    assert result.foreign[0].reason == "executable_mismatch"


def test_argv_mismatch_is_foreign(tmp_path: Path) -> None:
    write_sidecar(tmp_path, _sidecar("record:1", pid=100, pgid=100, argv=("gst-launch-1.0", "different")))
    result = recover_orphans(
        [_expected("record:1")],  # expects the default ARGV, sidecar has a different one
        tmp_path,
        proc_scanner=lambda pid: ProcStat(start_time_ticks=1000, executable=EXE),
    )
    assert result.adopted == ()
    assert result.foreign[0].reason == "argv_mismatch"


def test_unexpected_identity_is_foreign_not_signaled(tmp_path: Path) -> None:
    write_sidecar(tmp_path, _sidecar("record:orphaned-from-old-run", pid=100, pgid=100))
    result = recover_orphans([], tmp_path, proc_scanner=lambda pid: ProcStat(start_time_ticks=1000, executable=EXE))
    assert result.adopted == ()
    assert result.foreign[0].reason == "unexpected_identity"


def test_process_not_found_is_foreign(tmp_path: Path) -> None:
    write_sidecar(tmp_path, _sidecar("record:1", pid=100, pgid=100))
    result = recover_orphans([_expected("record:1")], tmp_path, proc_scanner=lambda pid: None)
    assert result.adopted == ()
    assert result.foreign[0].reason == "process_not_found"


def test_bad_marker_is_foreign(tmp_path: Path) -> None:
    sidecar = _sidecar("record:1", pid=100, pgid=100)
    bad = Sidecar(**{**sidecar.__dict__, "marker": "some-other-daemon"})
    write_sidecar(tmp_path, bad)
    result = recover_orphans([_expected("record:1")], tmp_path, proc_scanner=lambda pid: ProcStat(1000, EXE))
    assert result.adopted == ()
    assert result.foreign[0].reason == "bad_marker"


def test_no_sidecars_means_nothing_adopted_and_nothing_foreign(tmp_path: Path) -> None:
    result = recover_orphans([_expected("record:1")], tmp_path, proc_scanner=lambda pid: None)
    assert result.adopted == ()
    assert result.foreign == ()


def test_remove_sidecar_deletes_the_file(tmp_path: Path) -> None:
    write_sidecar(tmp_path, _sidecar("record:1", pid=100, pgid=100))
    assert sidecar_path(tmp_path, "record:1").exists()
    remove_sidecar(tmp_path, "record:1")
    assert not sidecar_path(tmp_path, "record:1").exists()
    assert read_sidecars(tmp_path) == []


def test_remove_sidecar_on_a_missing_identity_is_a_no_op(tmp_path: Path) -> None:
    remove_sidecar(tmp_path, "record:never-written")  # must not raise


@pytest.mark.skipif(sys.platform == "win32", reason="/proc is Linux-only; verified on target")
def test_real_proc_scanner_reads_the_calling_process_itself() -> None:
    pid = os.getpid()
    stat = real_proc_scanner(pid)
    assert stat is not None
    assert stat.executable == os.readlink(f"/proc/{pid}/exe")
    assert stat.start_time_ticks > 0


@pytest.mark.skipif(sys.platform == "win32", reason="/proc is Linux-only; verified on target")
def test_real_proc_scanner_returns_none_for_a_dead_pid() -> None:
    child = subprocess.Popen([sys.executable, "-c", "pass"])
    child.wait()
    assert real_proc_scanner(child.pid) is None


@pytest.mark.skipif(sys.platform == "win32", reason="/proc is Linux-only; verified on target")
def test_real_expected_processes_reads_live_argv_and_exe_from_proc(tmp_path: Path) -> None:
    pid = os.getpid()
    live_cmdline = tuple(
        part.decode("utf-8", errors="replace")
        for part in Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\x00")
        if part
    )
    write_sidecar(
        tmp_path,
        Sidecar(
            marker=SIDECAR_MARKER,
            identity="record:self",
            pid=pid,
            pgid=pid,
            argv_hash=argv_hash(live_cmdline),
            kind="record",
            output_path=None,
            started_at_ms=0,
            proc_start_ticks=0,
        ),
    )
    expected = real_expected_processes(tmp_path)
    assert len(expected) == 1
    assert expected[0].identity == "record:self"
    assert expected[0].kind == "record"
    assert expected[0].argv == live_cmdline
    assert expected[0].executable == os.readlink(f"/proc/{pid}/exe")


@pytest.mark.skipif(sys.platform == "win32", reason="/proc is Linux-only; verified on target")
def test_real_expected_processes_skips_a_sidecar_for_a_dead_pid(tmp_path: Path) -> None:
    child = subprocess.Popen([sys.executable, "-c", "pass"])
    child.wait()
    write_sidecar(tmp_path, _sidecar("record:1", pid=child.pid, pgid=child.pid))
    assert real_expected_processes(tmp_path) == []


def test_ambiguous_or_foreign_processes_are_never_signaled(tmp_path: Path) -> None:
    """recover_orphans is pure data-in/data-out — it must not import signal-sending
    machinery at all, so a foreign match structurally cannot be killed here."""
    import pipeline_manager.supervisor.recovery as recovery_module

    assert "signal" not in dir(recovery_module) or not hasattr(recovery_module, "os_kill")
    source = Path(recovery_module.__file__).read_text(encoding="utf-8")
    assert "killpg" not in source
    assert "os.kill(" not in source

from __future__ import annotations

from pathlib import Path

from pipeline_manager.supervisor.recovery import (
    SIDECAR_MARKER,
    ExpectedProcess,
    ProcStat,
    Sidecar,
    argv_hash,
    read_sidecars,
    recover_orphans,
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


def test_ambiguous_or_foreign_processes_are_never_signaled(tmp_path: Path) -> None:
    """recover_orphans is pure data-in/data-out — it must not import signal-sending
    machinery at all, so a foreign match structurally cannot be killed here."""
    import pipeline_manager.supervisor.recovery as recovery_module

    assert "signal" not in dir(recovery_module) or not hasattr(recovery_module, "os_kill")
    source = Path(recovery_module.__file__).read_text(encoding="utf-8")
    assert "killpg" not in source
    assert "os.kill(" not in source

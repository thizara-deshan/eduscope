from __future__ import annotations

import hashlib
import json
import os
from contextlib import suppress
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Sequence

SIDECAR_MARKER = "eduscope-pipeline-manager"


def argv_hash(argv: Sequence[str]) -> str:
    joined = "\x00".join(argv)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Sidecar:
    """Atomic per-process ownership record, written at spawn (A-07/A-09) and
    read only at recovery. PID-reuse guard: `proc_start_ticks` is compared
    against a fresh /proc read, not just the pid number.
    """

    marker: str
    identity: str
    pid: int
    pgid: int
    argv_hash: str
    kind: str
    output_path: str | None
    started_at_ms: int
    proc_start_ticks: int


def sidecar_path(runtime_dir: Path, identity: str) -> Path:
    safe = identity.replace("/", "_").replace(":", "_")
    return runtime_dir / f"{safe}.sidecar.json"


def write_sidecar(runtime_dir: Path, sidecar: Sidecar) -> None:
    """Build in a temp file, then os.replace into place — a reader never
    observes a partially written sidecar."""
    runtime_dir.mkdir(parents=True, exist_ok=True)
    path = sidecar_path(runtime_dir, sidecar.identity)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(asdict(sidecar)), encoding="utf-8")
    os.replace(tmp_path, path)


def remove_sidecar(runtime_dir: Path, identity: str) -> None:
    """The write-side counterpart of `write_sidecar`: called once ownership
    of `identity` ends (clean stop, failed-start rollback, or an unexpected
    exit) so a dead identity never lingers on disk as a false adoption
    candidate for the next boot."""
    with suppress(FileNotFoundError):
        sidecar_path(runtime_dir, identity).unlink()


def read_sidecars(runtime_dir: Path) -> list[Sidecar]:
    sidecars: list[Sidecar] = []
    if not runtime_dir.exists():
        return sidecars
    for path in sorted(runtime_dir.glob("*.sidecar.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            sidecars.append(Sidecar(**data))
        except (json.JSONDecodeError, TypeError, KeyError):
            continue
    return sidecars


@dataclass(frozen=True)
class ExpectedProcess:
    identity: str
    argv: tuple[str, ...]
    kind: str
    executable: str


@dataclass(frozen=True)
class ProcStat:
    """The subset of /proc/<pid>/stat this module needs."""

    start_time_ticks: int
    executable: str


ProcScanner = Callable[[int], "ProcStat | None"]


@dataclass(frozen=True)
class AdoptedProcess:
    identity: str
    pid: int
    pgid: int
    kind: str
    output_path: str | None


@dataclass(frozen=True)
class ForeignProcess:
    """A sidecar/pid that could not be conservatively matched — reported,
    never signaled. There is no broad pattern kill anywhere in this path."""

    identity: str | None
    pid: int | None
    reason: str


@dataclass(frozen=True)
class RecoveryResult:
    adopted: tuple[AdoptedProcess, ...]
    foreign: tuple[ForeignProcess, ...]


def recover_orphans(
    expected: Sequence[ExpectedProcess],
    runtime_dir: Path,
    *,
    proc_scanner: ProcScanner,
) -> RecoveryResult:
    """Conservative adoption only: exact executable + opaque identity + argv
    hash + unreused pid. Anything else is reported as foreign, not signaled.
    """
    expected_by_identity = {item.identity: item for item in expected}
    adopted: list[AdoptedProcess] = []
    foreign: list[ForeignProcess] = []

    for sidecar in read_sidecars(runtime_dir):
        if sidecar.marker != SIDECAR_MARKER:
            foreign.append(ForeignProcess(identity=sidecar.identity, pid=sidecar.pid, reason="bad_marker"))
            continue

        expectation = expected_by_identity.get(sidecar.identity)
        if expectation is None:
            foreign.append(
                ForeignProcess(identity=sidecar.identity, pid=sidecar.pid, reason="unexpected_identity")
            )
            continue

        if sidecar.argv_hash != argv_hash(expectation.argv):
            foreign.append(ForeignProcess(identity=sidecar.identity, pid=sidecar.pid, reason="argv_mismatch"))
            continue

        stat = proc_scanner(sidecar.pid)
        if stat is None:
            foreign.append(
                ForeignProcess(identity=sidecar.identity, pid=sidecar.pid, reason="process_not_found")
            )
            continue

        if stat.executable != expectation.executable:
            foreign.append(
                ForeignProcess(identity=sidecar.identity, pid=sidecar.pid, reason="executable_mismatch")
            )
            continue

        if stat.start_time_ticks != sidecar.proc_start_ticks:
            foreign.append(ForeignProcess(identity=sidecar.identity, pid=sidecar.pid, reason="pid_reused"))
            continue

        adopted.append(
            AdoptedProcess(
                identity=sidecar.identity,
                pid=sidecar.pid,
                pgid=sidecar.pgid,
                kind=sidecar.kind,
                output_path=sidecar.output_path,
            )
        )

    return RecoveryResult(adopted=tuple(adopted), foreign=tuple(foreign))


def real_proc_scanner(pid: int) -> ProcStat | None:
    """Board/Arch adapter for `ProcScanner` (A-REV-007): a fresh `/proc/<pid>`
    read, never a cached or self-reported value. `starttime` (field 22 of
    `stat`, after the `)` that closes `comm` — `comm` itself may contain
    spaces or parens, so it can't be split on whitespace) is the kernel's own
    PID-reuse guard; `exe` is read via the symlink, not trusted from argv[0].
    """
    try:
        executable = os.readlink(f"/proc/{pid}/exe")
        stat_text = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    except OSError:
        return None
    _, _, rest = stat_text.rpartition(")")
    fields = rest.split()
    if len(fields) < 20:
        return None
    return ProcStat(start_time_ticks=int(fields[19]), executable=executable)


def _read_cmdline(pid: int) -> tuple[str, ...] | None:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return None
    if not raw:
        return None
    return tuple(part.decode("utf-8", errors="replace") for part in raw.split(b"\x00") if part)


def real_expected_processes(runtime_dir: Path) -> list[ExpectedProcess]:
    """Board/Arch adapter for the `expected_processes` seam.

    An opaque `record:<id>` identity carries no domain state a fresh process
    could rebuild ahead of a restart, so "expected" is necessarily
    self-referential: for each sidecar on disk, read that *same* pid's live
    argv/exe straight from `/proc` right now. This still isn't a rubber
    stamp — `recover_orphans` hashes this freshly-read argv and compares it
    against the sidecar's `argv_hash` (recorded at spawn time), so a sidecar
    whose claimed pid is now running something else entirely is still
    rejected as foreign, not adopted.
    """
    expected: list[ExpectedProcess] = []
    for sidecar in read_sidecars(runtime_dir):
        argv = _read_cmdline(sidecar.pid)
        if argv is None:
            continue  # process already gone; recover_orphans will report it foreign
        try:
            executable = os.readlink(f"/proc/{sidecar.pid}/exe")
        except OSError:
            continue
        expected.append(
            ExpectedProcess(identity=sidecar.identity, argv=argv, kind=sidecar.kind, executable=executable)
        )
    return expected

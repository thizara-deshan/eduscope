"""C-10 Step 6: the `--run-soak` real target-board resource/soak runner.

Owns authenticated HTTP/WS live-cycle control and one-sample-per-minute
metric collection for >=90 minutes; it never applies thresholds or claims
PASS itself -- `services/ai/test/bench/parse_ai_soak.py` is C-10's sole,
independent acceptance authority over the metrics.jsonl this module writes.

BENCH-ONLY SHORTCUT: the plan's Step 4 has this module read each service's
PID/memory via `systemctl show eduscope-{stt,slide,question,core-api,
pipeline-manager}`. Those five systemd units do not exist on this board yet
(Workstream F, device bring-up, has not run) -- confirmed via `systemctl
list-unit-files`/`list-units`/`getent passwd`, all empty. Per explicit
operator instruction, this runner instead finds each service's PID by
matching its own launch command (the same processes started by hand for
C-09's bench run) and reads RSS from /proc/<pid>/status directly. This is a
deliberate, flagged deviation from the plan's literal systemd-based
sampling, not a silent one -- swap `_find_pid`/`_rss_kib_for` for real
`systemctl show` parsing once Workstream F lands.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import websockets

SAMPLE_INTERVAL_SEC = 60
GENERATION_MINUTES = (5, 25, 45, 65)

# BENCH-ONLY SHORTCUT: process command-line patterns standing in for the
# five not-yet-provisioned systemd units (see module docstring).
SERVICE_PROCESS_PATTERNS = {
    "stt": "uvicorn stt_service.app",
    "slide": "uvicorn slide_service.app",
    "question": "uvicorn question_service.app",
    "coreApi": "src/server.ts",
    "pipelineManager": "uvicorn pipeline_manager.app",
}


def _find_pid(pattern: str) -> int | None:
    """BENCH-ONLY SHORTCUT: `pgrep -f <pattern>` in place of a systemd unit lookup."""
    try:
        completed = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    pids = [int(line) for line in completed.stdout.split() if line.isdigit()]
    return pids[0] if pids else None


def _rss_kib_for(pid: int) -> int | None:
    try:
        status_text = Path(f"/proc/{pid}/status").read_text(encoding="utf-8")
    except OSError:
        return None
    match = re.search(r"^VmRSS:\s+(\d+)\s+kB$", status_text, re.MULTILINE)
    return int(match.group(1)) if match else None


def _redact(value: str, bearer: str) -> str:
    return value.replace(bearer, "[REDACTED]") if bearer else value


@dataclass
class SoakRunner:
    core_url: str
    pm_url: str
    internal_bearer: str | None
    bearer: str = field(repr=False)
    http: httpx.AsyncClient = field(init=False)
    ws: Any = field(init=False, default=None)
    session_id: str | None = field(init=False, default=None)
    latest_recording: dict[str, Any] = field(init=False, default_factory=dict)
    latest_countdown: dict[str, Any] = field(init=False, default_factory=dict)
    ai_set_events: list[dict[str, Any]] = field(init=False, default_factory=list)
    _reader_task: asyncio.Task | None = field(init=False, default=None)

    def __post_init__(self) -> None:
        self.http = httpx.AsyncClient(base_url=self.core_url, headers={"authorization": f"Bearer {self.bearer}"}, timeout=60.0)

    async def _read_loop(self) -> None:
        async for raw in self.ws:
            envelope = json.loads(raw)
            event = envelope.get("event")
            if event == "recording.state":
                self.latest_recording = envelope["payload"]
            elif event == "ai.countdown":
                self.latest_countdown = envelope["payload"]
            elif event == "ai.set":
                self.ai_set_events.append(envelope["payload"])

    async def connect(self) -> None:
        ws_url = "ws" + self.core_url[4:] + "/api/v1/ws"
        self.ws = await websockets.connect(ws_url, subprotocols=[self.bearer])
        await asyncio.wait_for(self.ws.recv(), timeout=10)
        self._reader_task = asyncio.create_task(self._read_loop())

    async def close(self) -> None:
        if self._reader_task:
            self._reader_task.cancel()
        if self.ws:
            await self.ws.close()
        await self.http.aclose()

    def service_sample(self, name: str) -> dict[str, Any]:
        pid = _find_pid(SERVICE_PROCESS_PATTERNS[name])
        block: dict[str, Any] = {}
        if pid is not None:
            rss_kib = _rss_kib_for(pid)
            if rss_kib is not None:
                block["rssKiB"] = rss_kib
        return block

    async def stt_queue_depth(self) -> int | None:
        if not self.internal_bearer:
            return None
        try:
            response = await self.http.get(
                "http://127.0.0.1:7101/status", headers={"authorization": f"Bearer {self.internal_bearer}"}
            )
            response.raise_for_status()
            return response.json().get("queueDepth")
        except httpx.HTTPError:
            return None

    async def pm_record_consumer(self) -> tuple[str | None, str | None]:
        """Returns (consumer state, output path) for this session's record consumer via PM's /status."""
        if not self.internal_bearer or not self.session_id:
            return None, None
        try:
            response = await self.http.get(
                f"{self.pm_url}/status", headers={"authorization": f"Bearer {self.internal_bearer}"}
            )
            response.raise_for_status()
        except httpx.HTTPError:
            return None, None
        for consumer in response.json().get("consumers", []):
            output = consumer.get("output")
            if consumer.get("kind") == "record" and output and self.session_id in output:
                return consumer.get("state"), output
        return None, None

    async def collect_sample(self, elapsed_sec: int) -> dict[str, Any]:
        record_state, output_path = await self.pm_record_consumer()
        output_bytes = None
        if output_path:
            try:
                output_bytes = os.stat(output_path).st_size
            except OSError:
                output_bytes = None

        services: dict[str, Any] = {}
        for name in ("stt", "slide", "question", "coreApi", "pipelineManager"):
            services[name] = self.service_sample(name)
        queue_depth = await self.stt_queue_depth()
        if queue_depth is not None:
            services["stt"]["queueDepth"] = queue_depth

        return {
            "type": "sample",
            "elapsedSec": elapsed_sec,
            "services": services,
            "recording": {"state": self.latest_recording.get("state"), "outputBytes": output_bytes},
            "record": {"state": record_state},
        }

    async def watch_session_dirs(self, recordings_root: Path, runtime_root: Path) -> None:
        """Pre-create `<recordings_root>/sessions/<sessionId>/` and
        `<runtime_root>/slides/<sessionId>/` the instant the panel WS reveals
        a new session id. Neither core-api nor pipeline-manager creates these
        directories (`resolve_output_path` only validates the boundary) --
        production expects a pre-formatted recordings volume; this bench
        environment's scratch volume starts empty (same finding as C-09
        Step 6)."""
        seen: set[str] = set()
        while True:
            session_id = self.latest_recording.get("sessionId")
            if session_id and session_id not in seen:
                seen.add(session_id)
                (recordings_root / "sessions" / session_id).mkdir(parents=True, exist_ok=True)
                (runtime_root / "slides" / session_id).mkdir(parents=True, exist_ok=True)
            await asyncio.sleep(0.01)

    async def run_generation(self) -> dict[str, Any]:
        # A prior round's terminal ai.set{ready|failed} stays in ai_set_events
        # forever -- matching on state alone (without excluding known setIds)
        # let a stale entry satisfy the very next round instantly, reporting
        # a few-millisecond "latency" for what was really still in flight.
        known_set_ids = {s.get("setId") for s in self.ai_set_events}
        accepted_at = datetime.now(timezone.utc)
        await self.http.post("/api/v1/ai/generate-now")
        deadline = asyncio.get_event_loop().time() + 45.0
        outcome = "typed-failure"
        while asyncio.get_event_loop().time() < deadline:
            terminal = next(
                (
                    s
                    for s in reversed(self.ai_set_events)
                    if s.get("setId") not in known_set_ids and s.get("state") in ("ready", "failed")
                ),
                None,
            )
            if terminal is not None and terminal.get("state") == "ready":
                outcome = "ready"
                break
            if terminal is not None and terminal.get("state") == "failed":
                outcome = "typed-failure"
                break
            await asyncio.sleep(0.5)
        terminal_at = datetime.now(timezone.utc)
        return {
            "type": "generation",
            "acceptedAt": accepted_at.isoformat(),
            "terminalAt": terminal_at.isoformat(),
            "latencyMs": int((terminal_at - accepted_at).total_seconds() * 1000),
            "outcome": outcome,
        }


async def _write_metadata(metadata_path: Path, core_url: str) -> None:
    def _run(argv: list[str]) -> str | None:
        try:
            return subprocess.run(argv, capture_output=True, text=True, timeout=5).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            return None

    board_model = None
    try:
        board_model = Path("/proc/device-tree/model").read_text(encoding="utf-8").strip("\x00").strip()
    except OSError:
        pass

    metadata = {
        "startedAtUtc": datetime.now(timezone.utc).isoformat(),
        "gitCommit": _run(["git", "rev-parse", "HEAD"]),
        "boardModel": board_model,
        "kernel": _run(["uname", "-r"]),
        "coreUrl": core_url,
        "note": "BENCH-ONLY SHORTCUT: service status is PID/RSS based (see soak_runner.py docstring), not systemd unit state.",
    }
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")


async def _await_stable_file(session_dir: Path, *, max_wait_sec: float = 600.0, poll_sec: float = 3.0) -> Path | None:
    """Waits for the finalized recording to stop changing size before it is
    probed. `recording.state{completed}` reflects core-api's session state,
    not that pipeline-manager/the library merge worker has finished writing
    `main.mp4` to disk -- probing immediately after "completed" can catch a
    partially-written file (a real bug found running this module's own first
    90-minute soak: ffprobe read 0.0s duration and ffmpeg decode hit 4 errors
    against a file that, once fully written moments later, decoded cleanly
    at the full 5,615s duration)."""
    deadline = asyncio.get_event_loop().time() + max_wait_sec
    last_size: int | None = None
    stable_reads = 0
    while asyncio.get_event_loop().time() < deadline:
        candidates = sorted(session_dir.glob("main.mp4")) + sorted(session_dir.glob("seg-*.ts"))
        if candidates:
            size = candidates[0].stat().st_size
            if size > 0 and size == last_size:
                stable_reads += 1
                if stable_reads >= 2:
                    return candidates[0]
            else:
                stable_reads = 0
            last_size = size
        await asyncio.sleep(poll_sec)
    candidates = sorted(session_dir.glob("main.mp4")) + sorted(session_dir.glob("seg-*.ts"))
    return candidates[0] if candidates else None


async def _run_ffprobe_validation(session_dir: Path) -> dict[str, Any]:
    media_path = await _await_stable_file(session_dir)
    if media_path is None:
        return {"type": "final", "ffprobeDurationSec": 0.0, "decodeErrors": 1}

    duration_sec = 0.0
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(media_path)],
            capture_output=True, text=True, timeout=60,
        )
        duration_sec = float(json.loads(probe.stdout)["format"]["duration"])
    except (OSError, subprocess.TimeoutExpired, KeyError, ValueError, json.JSONDecodeError):
        duration_sec = 0.0

    decode_errors = 1
    try:
        decode = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(media_path), "-f", "null", "-"],
            capture_output=True, text=True, timeout=600,
        )
        decode_errors = len([line for line in decode.stderr.splitlines() if line.strip()])
    except (OSError, subprocess.TimeoutExpired):
        decode_errors = 1

    return {"type": "final", "ffprobeDurationSec": duration_sec, "decodeErrors": decode_errors}


async def run_soak(core_url: str, duration_sec: int, metrics_jsonl: str | Path, metadata_json: str | Path) -> None:
    bearer = os.environ.get("CORE_API_BEARER")
    if not bearer:
        raise SystemExit("CORE_API_BEARER must be set (lecturer bearer, never a CLI argument)")
    internal_bearer = os.environ.get("EDUSCOPE_INTERNAL_BEARER")
    pm_url = os.environ.get("EDUSCOPE_PM_URL", "http://127.0.0.1:8091")
    recordings_root = os.environ.get("EDUSCOPE_RECORDINGS_ROOT", "/media/eduscope")

    metrics_path = Path(metrics_jsonl)
    metadata_path = Path(metadata_json)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    await _write_metadata(metadata_path, core_url)

    runner = SoakRunner(core_url=core_url, pm_url=pm_url, internal_bearer=internal_bearer, bearer=bearer)
    metrics_file = metrics_path.open("w", encoding="utf-8")

    def append(row: dict[str, Any]) -> None:
        metrics_file.write(json.dumps(row) + "\n")
        metrics_file.flush()

    dir_watcher: asyncio.Task | None = None
    try:
        await runner.connect()
        dir_watcher = asyncio.create_task(
            runner.watch_session_dirs(Path(recordings_root), Path(os.environ.get("EDUSCOPE_RUNTIME_ROOT", "/run/eduscope")))
        )
        await runner.http.post("/api/v1/recording/start")
        deadline = asyncio.get_event_loop().time() + 30
        while asyncio.get_event_loop().time() < deadline and runner.latest_recording.get("state") != "recording":
            await asyncio.sleep(0.5)
        runner.session_id = runner.latest_recording.get("sessionId")
        if runner.session_id is None:
            raise SystemExit("recording did not reach 'recording' state within 30s")

        generation_elapsed = {minutes * 60 for minutes in GENERATION_MINUTES}
        elapsed = 0
        while elapsed <= duration_sec:
            append(await runner.collect_sample(elapsed))
            if elapsed in generation_elapsed:
                append(await runner.run_generation())
            await asyncio.sleep(SAMPLE_INTERVAL_SEC)
            elapsed += SAMPLE_INTERVAL_SEC

        await runner.http.post("/api/v1/recording/stop")
        stop_deadline = asyncio.get_event_loop().time() + 60
        while asyncio.get_event_loop().time() < stop_deadline and runner.latest_recording.get("state") != "completed":
            await asyncio.sleep(0.5)

        session_dir = Path(recordings_root) / "sessions" / runner.session_id
        append(await _run_ffprobe_validation(session_dir))
    finally:
        if dir_watcher is not None:
            dir_watcher.cancel()
        metrics_file.close()
        await runner.close()


def add_soak_arguments(parser) -> None:
    parser.add_argument("--duration-sec", type=int, default=None)
    parser.add_argument("--metrics-jsonl", type=str, default=None)
    parser.add_argument("--metadata-json", type=str, default=None)


def main(argv: list[str] | None = None) -> None:  # pragma: no cover - thin CLI wrapper, exercised via live-cycle.py
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--core-url", required=True)
    parser.add_argument("--run-soak", action="store_true", required=True)
    add_soak_arguments(parser)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if not args.duration_sec or not args.metrics_jsonl or not args.metadata_json:
        raise SystemExit("--run-soak requires --duration-sec, --metrics-jsonl, and --metadata-json")
    asyncio.run(run_soak(args.core_url, args.duration_sec, args.metrics_jsonl, args.metadata_json))


if __name__ == "__main__":  # pragma: no cover
    main()

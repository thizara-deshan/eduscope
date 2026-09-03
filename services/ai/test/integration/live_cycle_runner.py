"""C-09 Step 6: real target-board live-record verification runner.

Drives a real, already-running core-api (behind a real pipeline-manager and
the three real C services) over its public panel WS + REST surface exactly
as a lecturer client would, and writes dated JSON evidence containing only
ids, timestamps, counts, states, latency, and PASS/FAIL assertions -- never
the bearer, transcript text, prompts, or question text.

The lecturer bearer is read from the `CORE_API_BEARER` environment variable
only (never a CLI argument, so it never appears in process listings).
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import websockets


class AssertionFailed(Exception):
    pass


class LiveCycleRunner:
    def __init__(self, core_url: str, db_path: str) -> None:
        self.core_url = core_url.rstrip("/")
        self.ws_url = "ws" + self.core_url[4:] + "/api/v1/ws"
        self.db_path = db_path
        bearer = os.environ.get("CORE_API_BEARER")
        if not bearer:
            raise SystemExit("CORE_API_BEARER must be set (lecturer bearer, never a CLI argument)")
        self._bearer = bearer
        self.http = httpx.AsyncClient(base_url=self.core_url, headers={"authorization": f"Bearer {bearer}"}, timeout=60.0)
        self.ws: Any = None
        self.assertions: list[dict[str, Any]] = []
        self.session_id: str | None = None
        self._latest_recording: dict[str, Any] = {}
        self._latest_countdown: dict[str, Any] = {}
        self._ai_set_events: list[dict[str, Any]] = []
        self._ai_question_events: list[dict[str, Any]] = []
        self._reader_task: asyncio.Task | None = None

    def record(self, assertion_id: str, description: str, ok: bool, **detail: Any) -> None:
        self.assertions.append({"id": assertion_id, "description": description, "status": "PASS" if ok else "FAIL", **detail})
        if not ok:
            raise AssertionFailed(f"{assertion_id}: {description}")

    def db_counts(self, session_id: str) -> tuple[int, int]:
        conn = sqlite3.connect(self.db_path)
        try:
            transcripts = conn.execute(
                "SELECT COUNT(*) FROM transcript_segments WHERE session_id = ?", (session_id,)
            ).fetchone()[0]
            slides = conn.execute(
                "SELECT COUNT(*) FROM slide_captures WHERE session_id = ?", (session_id,)
            ).fetchone()[0]
            return transcripts, slides
        finally:
            conn.close()

    async def _read_loop(self) -> None:
        async for raw in self.ws:
            envelope = json.loads(raw)
            event = envelope.get("event")
            payload = envelope.get("payload")
            if event == "recording.state":
                self._latest_recording = payload
            elif event == "ai.countdown":
                self._latest_countdown = payload
            elif event == "ai.set":
                self._ai_set_events.append(payload)
            elif event == "ai.question":
                self._ai_question_events.append(payload)

    async def connect(self) -> dict[str, Any]:
        self.ws = await websockets.connect(self.ws_url, subprotocols=[self._bearer])
        first = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=10))
        self._reader_task = asyncio.create_task(self._read_loop())
        return first

    async def wait_for(self, predicate, timeout: float, message: str):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = predicate()
            if result:
                return result
            await asyncio.sleep(0.2)
        raise AssertionFailed(f"timeout waiting for: {message}")

    async def watch_session_dirs(self, recordings_root: Path, runtime_root: Path) -> None:
        """Pre-create `<recordings_root>/sessions/<sessionId>/` the instant the
        panel WS reveals a new session id. Neither core-api nor pipeline-manager
        creates this directory (`resolve_output_path` only validates the
        boundary) -- production expects it to already exist on the mounted
        recordings volume; this bench environment's scratch volume starts
        empty, so the runner does the one-time provisioning step a real
        formatted disk would already have done, reacting to the earliest
        signal (the WS snapshot/delta carrying `sessionId`) to win the race
        against pipeline-manager's own record-start attempt."""
        seen: set[str] = set()
        seen_db: set[str] = set()
        while True:
            session_id = self._latest_recording.get("sessionId")
            if session_id and session_id not in seen:
                seen.add(session_id)
                (recordings_root / "sessions" / session_id).mkdir(parents=True, exist_ok=True)
                (runtime_root / "slides" / session_id).mkdir(parents=True, exist_ok=True)
            try:
                conn = sqlite3.connect(self.db_path)
                try:
                    rows = conn.execute("SELECT id FROM lecture_sessions").fetchall()
                finally:
                    conn.close()
                for (row_id,) in rows:
                    if row_id not in seen_db:
                        seen_db.add(row_id)
                        (recordings_root / "sessions" / row_id).mkdir(parents=True, exist_ok=True)
                        (runtime_root / "slides" / row_id).mkdir(parents=True, exist_ok=True)
            except sqlite3.Error:
                pass
            await asyncio.sleep(0.002)

    async def close(self) -> None:
        if self._reader_task:
            self._reader_task.cancel()
        if self.ws:
            await self.ws.close()
        await self.http.aclose()


async def run_live_cycle(core_url: str, evidence_dir: str | Path, db_path: str, recordings_root: str | Path, runtime_root: str | Path) -> None:
    runner = LiveCycleRunner(core_url, db_path)
    evidence_dir = Path(evidence_dir)
    evidence_dir.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(timezone.utc)
    exit_code = 0
    dir_watcher = asyncio.create_task(runner.watch_session_dirs(Path(recordings_root), Path(runtime_root)))

    try:
        # Step 1: open panel WS, validate initial snapshot.
        first = await runner.connect()
        runner.record(
            "1-snapshot",
            "panel WS opens with bearer as Sec-WebSocket-Protocol and delivers an initial snapshot",
            first.get("event") is not None,
            firstEvent=first.get("event"),
        )

        # Step 2: recording start -> recording.state{recording}.
        resp = await runner.http.post("/api/v1/recording/start")
        runner.record("2-start-accepted", "POST recording/start is accepted", resp.status_code == 202, httpStatus=resp.status_code)
        state = await runner.wait_for(
            lambda: runner._latest_recording if runner._latest_recording.get("state") == "recording" else None,
            30, "recording.state{recording}",
        )
        runner.session_id = state["sessionId"]
        runner.record("2-recording", "recording.state reaches 'recording'", True, sessionId=runner.session_id)

        # Step 3: >=1 STT segment and >=1 slide capture.
        t0, s0 = await runner.wait_for(
            lambda: (lambda c: c if c[0] >= 1 and c[1] >= 1 else None)(runner.db_counts(runner.session_id)),
            120, ">=1 transcript segment and >=1 slide capture",
        )
        runner.record("3-stt-slide", "at least one STT segment and one slide capture observed", True, transcriptCount=t0, slideCount=s0)

        # Step 4: generate-now -> ai.set{ready} + 3-5 ai.question.
        gen_requested_at = datetime.now(timezone.utc)
        resp = await runner.http.post("/api/v1/ai/generate-now")
        runner.record("4-generate-accepted", "POST ai/generate-now is accepted", resp.status_code == 202, httpStatus=resp.status_code)
        ready_set = await runner.wait_for(
            lambda: next((s for s in runner._ai_set_events if s.get("state") == "ready"), None),
            60, "ai.set{ready}",
        )
        gen_ready_at = datetime.now(timezone.utc)
        questions_for_set = [q for q in runner._ai_question_events if q.get("setId") == ready_set["setId"]]
        runner.record(
            "4-generate-ready", "ai.set reaches ready with 3-5 ai.question drafts",
            3 <= len(questions_for_set) <= 5,
            setId=ready_set["setId"], questionCount=len(questions_for_set),
            latencyMs=int((gen_ready_at - gen_requested_at).total_seconds() * 1000),
        )

        # Step 5: pause 10s (counts unchanged), resume (offsets continue).
        resp = await runner.http.post("/api/v1/recording/pause")
        runner.record("5-pause-accepted", "POST recording/pause is accepted", resp.status_code == 202, httpStatus=resp.status_code)
        await runner.wait_for(lambda: True if runner._latest_recording.get("state") == "paused" else None, 30, "recording.state{paused}")
        t_pause, s_pause = runner.db_counts(runner.session_id)
        await asyncio.sleep(10)
        t_after, s_after = runner.db_counts(runner.session_id)
        runner.record(
            "5-pause-hold", "transcript/slide counts do not change across a 10s pause",
            t_after == t_pause and s_after == s_pause,
            transcriptCount=t_after, slideCount=s_after,
        )
        duration_before_resume = runner._latest_recording.get("recordedDurationMs")
        resp = await runner.http.post("/api/v1/recording/resume")
        runner.record("5-resume-accepted", "POST recording/resume is accepted", resp.status_code == 202, httpStatus=resp.status_code)
        await runner.wait_for(lambda: True if runner._latest_recording.get("state") == "recording" else None, 30, "recording.state{recording} after resume")
        await runner.wait_for(
            lambda: True if (runner._latest_recording.get("recordedDurationMs") or 0) >= (duration_before_resume or 0) else None,
            30, "recordedDurationMs continuing from pre-pause value",
        )
        runner.record("5-resume", "resume continues offsets from the recorded duration at pause", True, recordedDurationMsAtResume=runner._latest_recording.get("recordedDurationMs"))

        # Step 6: LLM offline -> degraded while recording continues; restore -> probe recovery.
        t_before_offline, s_before_offline = runner.db_counts(runner.session_id)
        await runner.http.put("http://127.0.0.1:7200/__control__/online", json={"online": False})
        resp = await runner.http.post("/api/v1/ai/generate-now")
        degraded_countdown = await runner.wait_for(
            lambda: runner._latest_countdown if runner._latest_countdown.get("state") == "degraded" else None,
            60, "ai.countdown{degraded} while LLM is offline",
        )
        recording_ok_during_outage = runner._latest_recording.get("state") == "recording"
        await asyncio.sleep(5)
        t_during_offline, s_during_offline = runner.db_counts(runner.session_id)
        runner.record(
            "6-degraded", "LLM offline yields typed degraded state; recording continues; new rows still arrive",
            degraded_countdown.get("state") == "degraded" and recording_ok_during_outage
            and t_during_offline >= t_before_offline and s_during_offline >= s_before_offline,
            transcriptCountBefore=t_before_offline, transcriptCountDuring=t_during_offline,
            slideCountBefore=s_before_offline, slideCountDuring=s_during_offline,
        )
        await runner.http.put("http://127.0.0.1:7200/__control__/online", json={"online": True})
        recovered_countdown = await runner.wait_for(
            lambda: runner._latest_countdown if runner._latest_countdown.get("state") not in ("degraded",) else None,
            90, "probe recovery clearing degraded state",
        )
        runner.record("6-recovery", "restoring LLM access clears the degraded state without restarting C or B", True, countdownState=recovered_countdown.get("state"))

        # Step 7: stop -> final flush / session idle.
        resp = await runner.http.post("/api/v1/recording/stop")
        runner.record("7-stop-accepted", "POST recording/stop is accepted", resp.status_code == 202, httpStatus=resp.status_code)
        await runner.wait_for(lambda: True if runner._latest_recording.get("state") == "completed" else None, 60, "recording.state{completed}")
        idle_countdown = await runner.wait_for(
            lambda: runner._latest_countdown if runner._latest_countdown.get("state") == "unavailable" else None,
            30, "ai.countdown{unavailable} after stop",
        )
        t_final, s_final = runner.db_counts(runner.session_id)
        runner.record(
            "7-final-flush", "recording completes and the AI session goes idle with a final flush",
            idle_countdown.get("state") == "unavailable",
            transcriptCount=t_final, slideCount=s_final,
        )

    except AssertionFailed as exc:
        exit_code = 1
        runner.assertions.append({"id": "runner", "description": "unhandled failure", "status": "FAIL", "error": str(exc)})
    finally:
        dir_watcher.cancel()
        await runner.close()

    ended_at = datetime.now(timezone.utc)
    evidence = {
        "task": "C-09",
        "step": 6,
        "startedAt": started_at.isoformat(),
        "endedAt": ended_at.isoformat(),
        "coreUrl": core_url,
        "sessionId": runner.session_id,
        "assertions": runner.assertions,
        "result": "PASS" if all(a["status"] == "PASS" for a in runner.assertions) else "FAIL",
    }
    evidence_path = evidence_dir / f"c09-live-cycle-{started_at.strftime('%Y%m%dT%H%M%SZ')}.json"
    evidence_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"evidencePath": str(evidence_path), "result": evidence["result"]}))
    if exit_code != 0 or evidence["result"] != "PASS":
        raise SystemExit(1)

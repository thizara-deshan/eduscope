# A-16 evidence — output/resource/WebRTC bench gate

Copy this file to `a16-<YYYYMMDD>-<device>.md` and fill every field from the
actual target run. Runs only after A-15 has passed on the same target
commit. An unrun row stays `NOT RUN — gate failed` — never leave it blank
and never mark the task complete with a blank or invented PASS.

## Identity

| Field | Value |
|---|---|
| A-15 evidence link | NOT RUN — gate failed |
| Date | NOT RUN — gate failed |
| Commit SHA | NOT RUN — gate failed |
| Device serial | NOT RUN — gate failed |
| Pipeline engineer sign-off | NOT RUN — gate failed |

## 300s status JSONL

| Field | Value |
|---|---|
| Path | NOT RUN — gate failed |
| sha256 | NOT RUN — gate failed |
| Record fps (avg_frame_rate) | NOT RUN — gate failed |
| Live relay fps | NOT RUN — gate failed |

## Consumer pids before/after

| Consumer | pid before | pid after | Unchanged? |
|---|---|---|---|
| record | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| live | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| meeting | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| projector | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| snapshot | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |

## WebRTC first-frame latency (60 negotiations: 20 x presentation/lecturer-cam/students-cam)

| Metric | Value |
|---|---|
| p50 (ms) | NOT RUN — gate failed |
| p95 (ms) | NOT RUN — gate failed |
| max (ms) | NOT RUN — gate failed |
| All 60 < 1000ms? | NOT RUN — gate failed |
| Worker pid disappears after close? | NOT RUN — gate failed |
| Record pid/growth unchanged throughout? | NOT RUN — gate failed |

Raw per-negotiation rows: see `webrtc-latencies.jsonl` in the evidence
directory (60 rows: `{role, ms}`).

## /proc/stat CPU idle

| Field | Value |
|---|---|
| Sample file | NOT RUN — gate failed |
| sha256 | NOT RUN — gate failed |
| min idle % | NOT RUN — gate failed |
| p05 idle % | NOT RUN — gate failed |
| median idle % | NOT RUN — gate failed |
| mean idle % (headroom) | NOT RUN — gate failed |
| Mean ≥ 30.00%? | NOT RUN — gate failed |
| 30s rolling mean ever < 20%? | NOT RUN — gate failed |

## Encode-ledger refusal

| Field | Value |
|---|---|
| Ledger snapshot (capacity/inUse/reservedBy) | NOT RUN — gate failed |
| Second-thumbnail attempt HTTP status | NOT RUN — gate failed |
| Second-thumbnail attempt code | NOT RUN — gate failed |
| Record/live/first-thumbnail undisturbed? | NOT RUN — gate failed |

## HDMI #2 mic (KEEP B-59)

| Field | Value |
|---|---|
| Receiver capture device (`arecord -l`) | NOT RUN — gate failed |
| `ffprobe` output (48kHz stereo, non-silent) | NOT RUN — gate failed |
| Waveform/recording path | NOT RUN — gate failed |
| Meeting-platform input-meter screenshot | NOT RUN — gate failed |

## Projector latency (10 trials, 240fps phone capture)

| Trial | Frames | Latency (ms) |
|---|---|---|
| 1 | NOT RUN — gate failed | NOT RUN — gate failed |
| 2 | NOT RUN — gate failed | NOT RUN — gate failed |
| 3 | NOT RUN — gate failed | NOT RUN — gate failed |
| 4 | NOT RUN — gate failed | NOT RUN — gate failed |
| 5 | NOT RUN — gate failed | NOT RUN — gate failed |
| 6 | NOT RUN — gate failed | NOT RUN — gate failed |
| 7 | NOT RUN — gate failed | NOT RUN — gate failed |
| 8 | NOT RUN — gate failed | NOT RUN — gate failed |
| 9 | NOT RUN — gate failed | NOT RUN — gate failed |
| 10 | NOT RUN — gate failed | NOT RUN — gate failed |

| Metric | Value |
|---|---|
| p50 (ms) | NOT RUN — gate failed |
| p95 (ms) | NOT RUN — gate failed |
| max (ms) | NOT RUN — gate failed |
| Video hash | NOT RUN — gate failed |

No pass threshold is invented for this metric — latency is recorded and
flagged for the gate, not hidden behind a made-up number.

## Question/passthrough switch

| Field | Value |
|---|---|
| Projector pgid before switch | NOT RUN — gate failed |
| Projector pgid after switch back | NOT RUN — gate failed |
| Same pgid (no restart)? | NOT RUN — gate failed |
| Leaderboard/PII present? (must be no) | NOT RUN — gate failed |
| Question-mode frame capture | NOT RUN — gate failed |
| Passthrough-mode frame capture | NOT RUN — gate failed |

## Temperature

| Field | Value |
|---|---|
| Min (°C) | NOT RUN — gate failed |
| Max (°C) | NOT RUN — gate failed |

## Commands and exit codes

```text
NOT RUN — gate failed
```

## KEEP verdicts

| KEEP item | Verdict |
|---|---|
| B-56 (encoder bitrate/fps knobs honored) | NOT RUN — gate failed |
| B-59 (HDMI #2 mic usable) | NOT RUN — gate failed |
| B-60 (presets-as-data) | NOT RUN — gate failed |

## PASS/FAIL per phase

| Phase | Result |
|---|---|
| A16-OUT full-mix-300s | NOT RUN — gate failed |
| A16-RES cpu-headroom / ledger-enforced | NOT RUN — gate failed |
| A16-WEBRTC max-first-frame-ms<1000 | NOT RUN — gate failed |

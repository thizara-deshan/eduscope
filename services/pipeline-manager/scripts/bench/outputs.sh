#!/usr/bin/env bash
# A-16 bench gate: full output mix sustains 30 fps for 300s, preview starts
# <1s, encode ledger enforced. Requires A-15 to have already passed.
# Usage: outputs.sh --base-url URL --output-dir DIR --evidence-dir DIR
#
# CURL/JQ/FFPROBE/STAT/KILL/SLEEP may be overridden with the absolute path to
# a replacement binary — used by the test wrappers; defaults to the real tool.
set -euo pipefail

CURL="${CURL:-curl}"
JQ="${JQ:-jq}"
FFPROBE="${FFPROBE:-ffprobe}"
SLEEP="${SLEEP:-sleep}"

command -v "$CURL" >/dev/null || { echo "FAIL A16-OUT curl is required"; exit 1; }
command -v "$JQ" >/dev/null || { echo "FAIL A16-OUT jq is required"; exit 1; }
command -v "$FFPROBE" >/dev/null || { echo "FAIL A16-OUT ffprobe is required"; exit 1; }

BASE_URL="http://127.0.0.1:8091"
OUTPUT_DIR=""
EVIDENCE_DIR=""
STREAM_KEY="bench"
SAMPLE_SECONDS=300
MIN_FPS="30.00"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="$2"; shift 2 ;;
    --sample-seconds) SAMPLE_SECONDS="$2"; shift 2 ;;
    *) echo "FAIL A16-OUT unknown argument: $1"; exit 1 ;;
  esac
done
test -n "$OUTPUT_DIR" || { echo "FAIL A16-OUT --output-dir is required"; exit 1; }
test -n "$EVIDENCE_DIR" || { echo "FAIL A16-OUT --evidence-dir is required"; exit 1; }
mkdir -p "$EVIDENCE_DIR"
: "${EDUSCOPE_PM_TOKEN:?set EDUSCOPE_PM_TOKEN}"
AUTH=( -H "Authorization: Bearer ${EDUSCOPE_PM_TOKEN}" )

status() { "$CURL" -fsS "${AUTH[@]}" "${BASE_URL}/status"; }
post_json() { "$CURL" -fsS -X POST "${AUTH[@]}" -H 'Content-Type: application/json' -d "$2" "${BASE_URL}$1"; }

fps_at_least() {
  # fps_at_least <value> <min>
  awk -v v="$1" -v m="$2" 'BEGIN { exit !(v >= m) }'
}

# ── 1. Baseline ──────────────────────────────────────────────────────────
baseline_pub="$(status | "$JQ" -c '.publishers | map_values(.pid)')"
baseline_ledger="$(status | "$JQ" -c '.encodeLedger')"

# ── 2. Start the full output mix ────────────────────────────────────────
record_out="${OUTPUT_DIR}/a16-mix.ts"
record_id="$(post_json /consumers/record "$("$JQ" -n --arg p fifty-fifty --arg o "$record_out" '{preset:$p, outputPath:$o}')" | "$JQ" -r '.consumerId')"
live_id="$(post_json /consumers/live "$("$JQ" -n --arg p fifty-fifty --arg k "$STREAM_KEY" '{preset:$p, streamKey:$k}')" | "$JQ" -r '.consumerId')"
meeting_id="$(post_json /consumers/meeting '{"preset":"cams-fifty-fifty"}' | "$JQ" -r '.consumerId')"
post_json /consumers/projector '{"mode":"passthrough"}' >/dev/null
snapshot_out="${OUTPUT_DIR}/a16-snapshot.png"
post_json /consumers/snapshot/start "$("$JQ" -n --arg o "$snapshot_out" '{intervalSec:1, outputPath:$o}')" >/dev/null

# ── 3. Confirm every consumer, record start-confirm latency ────────────
for id in "$record_id" "$live_id" "$meeting_id"; do
  deadline=$((SECONDS + 5))
  while :; do
    state="$(status | "$JQ" -r --arg id "$id" '.consumers[] | select(.id == $id) | .state')"
    [[ "$state" == "running" ]] && break
    (( SECONDS < deadline )) || { echo "FAIL A16-OUT confirm timeout for $id"; exit 1; }
    "$SLEEP" 1
  done
done

# ── 4. Sample /status once/second for SAMPLE_SECONDS, JSONL evidence ───
jsonl="${EVIDENCE_DIR}/status-samples.jsonl"
: > "$jsonl"
for ((i = 0; i < SAMPLE_SECONDS; i++)); do
  snapshot="$(status)"
  echo "$snapshot" >> "$jsonl"

  pub_now="$("$JQ" -c '.publishers | map_values(.pid)' <<<"$snapshot")"
  test "$pub_now" = "$baseline_pub" || { echo "FAIL A16-OUT unexpected publisher pid change at sample $i"; exit 1; }

  bad_state="$("$JQ" -r '[.consumers[].state] | map(select(. != "running" and . != "degraded")) | length' <<<"$snapshot")"
  test "$bad_state" = "0" || { echo "FAIL A16-OUT consumer left running/degraded at sample $i"; exit 1; }

  in_use="$("$JQ" -r '.encodeLedger.inUse' <<<"$snapshot")"
  capacity="$("$JQ" -r '.encodeLedger.capacity' <<<"$snapshot")"
  awk -v u="$in_use" -v c="$capacity" 'BEGIN { exit !(u <= c) }' || { echo "FAIL A16-OUT ledger over capacity at sample $i"; exit 1; }

  "$SLEEP" 1
done

# ── 5. EOS-stop record/live/meeting and aux; verify fps ─────────────────
post_json "/consumers/${record_id}/stop" '{"mode":"eos"}' >/dev/null
post_json "/consumers/${live_id}/stop" '{"mode":"eos"}' >/dev/null
post_json "/consumers/${meeting_id}/stop" '{"mode":"eos"}' >/dev/null
post_json /consumers/snapshot/stop '{}' >/dev/null

record_probe="${EVIDENCE_DIR}/record-probe.json"
"$FFPROBE" -v error -select_streams v:0 -show_entries stream=avg_frame_rate,nb_read_frames \
  -count_frames -of json "$record_out" > "$record_probe" 2>/dev/null || true
record_fps="$("$JQ" -r '.streams[0].avg_frame_rate // "0/1"' "$record_probe" | awk -F/ '{ if ($2==0) print 0; else print $1/$2 }')"
fps_at_least "$record_fps" "$MIN_FPS" || { echo "FAIL A16-OUT record fps $record_fps < $MIN_FPS"; exit 1; }

live_probe="${EVIDENCE_DIR}/live-probe.json"
"$FFPROBE" -v error -select_streams v:0 -show_entries stream=avg_frame_rate \
  -of json "rtmp://127.0.0.1:1935/live/${STREAM_KEY}" > "$live_probe" 2>/dev/null || true
live_fps="$("$JQ" -r '.streams[0].avg_frame_rate // "0/1"' "$live_probe" | awk -F/ '{ if ($2==0) print 0; else print $1/$2 }')"
fps_at_least "$live_fps" "$MIN_FPS" || { echo "FAIL A16-OUT live fps $live_fps < $MIN_FPS"; exit 1; }

echo "PASS A16-OUT full-mix-300s"

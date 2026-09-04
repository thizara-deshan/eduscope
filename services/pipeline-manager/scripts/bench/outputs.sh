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
TIMEOUT="${TIMEOUT:-timeout}"
SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON="${PYTHON:-${SERVICE_DIR}/.venv/bin/python}"

command -v "$CURL" >/dev/null || { echo "FAIL A16-OUT curl is required"; exit 1; }
command -v "$JQ" >/dev/null || { echo "FAIL A16-OUT jq is required"; exit 1; }
command -v "$FFPROBE" >/dev/null || { echo "FAIL A16-OUT ffprobe is required"; exit 1; }
command -v "$PYTHON" >/dev/null || { echo "FAIL A16-OUT python3 is required"; exit 1; }
command -v "$TIMEOUT" >/dev/null || { echo "FAIL A16-OUT timeout is required"; exit 1; }

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

record_id=""
live_id=""
meeting_id=""
cleanup() {
  post_json /consumers/thumbnails/stop '{}' >/dev/null 2>&1 || true
  post_json /consumers/snapshot/stop '{}' >/dev/null 2>&1 || true
  for id in "$record_id" "$live_id" "$meeting_id"; do
    test -n "$id" && post_json "/consumers/${id}/stop" '{"mode":"eos"}' >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

fps_at_least() {
  # fps_at_least <value> <min>
  awk -v v="$1" -v m="$2" 'BEGIN { exit !(v >= m) }'
}

# ── 1. Baseline ──────────────────────────────────────────────────────────
baseline_pub="$(status | "$JQ" -c '.publishers | map_values(.pid)')"
baseline_ledger="$(status | "$JQ" -c '.encodeLedger')"

# ── 2. Start the full output mix ────────────────────────────────────────
record_out="${OUTPUT_DIR}/a16-mix.ts"
record_id="$(post_json /consumers/record "$("$JQ" -n --arg p fifty-fifty --arg o "$record_out" '{preset:$p, outputPath:$o, videoBitrateBps:4000000, fps:30}')" | "$JQ" -r '.consumerId')"
live_id="$(post_json /consumers/live "$("$JQ" -n --arg p fifty-fifty --arg k "$STREAM_KEY" '{preset:$p, streamKey:$k, videoBitrateBps:4000000, fps:30}')" | "$JQ" -r '.consumerId')"
meeting_id="$(post_json /consumers/meeting '{"preset":"cams-fifty-fifty"}' | "$JQ" -r '.consumerId')"
projector_id="$(post_json /consumers/projector '{"mode":"passthrough"}' | "$JQ" -r '.consumerId')"
snapshot_out="${OUTPUT_DIR}/a16-snapshot.png"
snapshot_id="$(post_json /consumers/snapshot/start "$("$JQ" -n --arg o "$snapshot_out" '{intervalSec:1, outputPath:$o}')" | "$JQ" -r '.consumerId')"

# One encode-free worker refreshes all three JPEG previews at 1 Hz.
post_json /consumers/thumbnails/start '{"sources":["presentation","lecturer-cam","students-cam"]}' >/dev/null

# ── 3. Confirm every consumer, record start-confirm latency ────────────
for id in "$record_id" "$live_id" "$meeting_id" "$projector_id" "$snapshot_id"; do
  deadline=$((SECONDS + 5))
  while :; do
    state="$(status | "$JQ" -r --arg id "$id" '.consumers[] | select(.id == $id) | .state')"
    [[ "$state" == "running" ]] && break
    (( SECONDS < deadline )) || { echo "FAIL A16-OUT confirm timeout for $id"; exit 1; }
    "$SLEEP" 1
  done
done

deadline=$((SECONDS + 10))
while :; do
  ledger_in_use="$(status | "$JQ" -r '.encodeLedger.inUse')"
  preview_count="$(status | "$JQ" '[.consumers[] | select(.id == "jpeg-previews:main" and .state == "running")] | length')"
  test "$ledger_in_use" = "2" && test "$preview_count" = "1" && break
  (( SECONDS < deadline )) || { echo "FAIL A16-OUT JPEG preview worker not ready or encoder ledger not 2"; exit 1; }
  "$SLEEP" 1
done

for role in presentation lecturer-cam students-cam; do
  jpeg="${EVIDENCE_DIR}/preview-${role}.jpg"
  "$CURL" -fsS "${AUTH[@]}" "${BASE_URL}/consumers/thumbnails/${role}.jpg" -o "$jpeg"
  test -s "$jpeg" || { echo "FAIL A16-OUT empty JPEG preview for $role"; exit 1; }
  first_mtime="$(stat -c %Y "$jpeg")"
  "$SLEEP" 2
  "$CURL" -fsS "${AUTH[@]}" "${BASE_URL}/consumers/thumbnails/${role}.jpg" -o "$jpeg"
  second_mtime="$(stat -c %Y "$jpeg")"
  test "$second_mtime" -gt "$first_mtime" || { echo "FAIL A16-OUT stale JPEG preview for $role"; exit 1; }
done

tracked_ids="$(printf '%s\n' "$record_id" "$live_id" "$meeting_id" "$projector_id" "$snapshot_id" | "$JQ" -Rsc 'split("\n")[:-1]')"
baseline_consumers="$(status | "$JQ" -c --argjson ids "$tracked_ids" '[.consumers[] | select(.id as $id | $ids | index($id)) | {id,pgid}] | sort_by(.id)')"
test "$("$JQ" 'length' <<<"$baseline_consumers")" = "5" || { echo "FAIL A16-OUT missing full-mix consumer status"; exit 1; }
previous_record_size="$(stat -c %s "$record_out")"
printf 'ready\n' > "${EVIDENCE_DIR}/full-mix-ready"

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

  consumers_now="$("$JQ" -c --argjson ids "$tracked_ids" '[.consumers[] | select(.id as $id | $ids | index($id)) | {id,pgid}] | sort_by(.id)' <<<"$snapshot")"
  test "$consumers_now" = "$baseline_consumers" || { echo "FAIL A16-OUT consumer pid change at sample $i"; exit 1; }

  record_size="$(stat -c %s "$record_out")"
  test "$record_size" -gt "$previous_record_size" || { echo "FAIL A16-OUT record did not grow at sample $i"; exit 1; }
  previous_record_size="$record_size"

  "$SLEEP" 1
done

# Probe live while the publisher is still running; probing after EOS can only
# measure a relay cache (or fail when the relay has no cache at all).
live_probe="${EVIDENCE_DIR}/live-probe.json"
status > "${EVIDENCE_DIR}/pre-live-probe-status.json"
"$TIMEOUT" 15 "$FFPROBE" -v error -read_intervals '%+3' -select_streams v:0 -show_entries stream=avg_frame_rate \
  -of json "rtmp://127.0.0.1:1935/live/${STREAM_KEY}" > "$live_probe" \
  || { echo "FAIL A16-OUT live relay probe timed out or failed"; exit 1; }
live_fps="$("$JQ" -r '.streams[0].avg_frame_rate // "0/1"' "$live_probe" | awk -F/ '{ if ($2==0) print 0; else print $1/$2 }')"
fps_at_least "$live_fps" "$MIN_FPS" || { echo "FAIL A16-OUT live fps $live_fps < $MIN_FPS"; exit 1; }

# ── 5. EOS-stop record/live/meeting and aux; verify fps ─────────────────
post_json "/consumers/${record_id}/stop" '{"mode":"eos"}' >/dev/null
post_json "/consumers/${live_id}/stop" '{"mode":"eos"}' >/dev/null
post_json "/consumers/${meeting_id}/stop" '{"mode":"eos"}' >/dev/null
post_json /consumers/snapshot/stop '{}' >/dev/null
post_json /consumers/thumbnails/stop '{}' >/dev/null
rm -f "${EVIDENCE_DIR}/full-mix-ready"

record_probe="${EVIDENCE_DIR}/record-probe.json"
"$FFPROBE" -v error -select_streams v:0 -show_entries stream=avg_frame_rate,nb_read_frames \
  -count_frames -of json "$record_out" > "$record_probe" 2>/dev/null || true
record_fps="$("$JQ" -r '.streams[0].avg_frame_rate // "0/1"' "$record_probe" | awk -F/ '{ if ($2==0) print 0; else print $1/$2 }')"
fps_at_least "$record_fps" "$MIN_FPS" || { echo "FAIL A16-OUT record fps $record_fps < $MIN_FPS"; exit 1; }

if test "$SAMPLE_SECONDS" = "300"; then
  echo "PASS A16-OUT full-mix-300s"
else
  echo "SMOKE A16-OUT full-mix-${SAMPLE_SECONDS}s"
fi

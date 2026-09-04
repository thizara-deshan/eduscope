#!/usr/bin/env bash
# A-16 bench gate: WebRTC first-frame latency, 20 negotiations x 3 roles,
# each closed before the next. Requires the A-06 board-only loopback probe
# (real PyGObject/GStreamer/webrtcbin — not available off the RK3588 target).
# Usage: webrtc.sh --base-url URL --evidence-dir DIR
#
# CURL/JQ/PYTHON may be overridden for testing; defaults to the real tool.
set -euo pipefail

CURL="${CURL:-curl}"
JQ="${JQ:-jq}"
SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON="${PYTHON:-${SERVICE_DIR}/.venv/bin/python}"
STAT="${STAT:-stat}"

command -v "$CURL" >/dev/null || { echo "FAIL A16-WEBRTC curl is required"; exit 1; }
command -v "$JQ" >/dev/null || { echo "FAIL A16-WEBRTC jq is required"; exit 1; }
command -v "$PYTHON" >/dev/null || { echo "FAIL A16-WEBRTC python3 is required"; exit 1; }
command -v "$STAT" >/dev/null || { echo "FAIL A16-WEBRTC stat is required"; exit 1; }

BASE_URL="http://127.0.0.1:8091"
EVIDENCE_DIR=""
ITERATIONS=20
MAX_MS=1000
OUTPUT_DIR="/media/eduscope/recordings/bench/a16"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="$2"; shift 2 ;;
    --iterations) ITERATIONS="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    *) echo "FAIL A16-WEBRTC unknown argument: $1"; exit 1 ;;
  esac
done
test -n "$EVIDENCE_DIR" || { echo "FAIL A16-WEBRTC --evidence-dir is required"; exit 1; }
mkdir -p "$EVIDENCE_DIR"
: "${EDUSCOPE_PM_TOKEN:?set EDUSCOPE_PM_TOKEN}"
AUTH=( -H "Authorization: Bearer ${EDUSCOPE_PM_TOKEN}" )
record_id=""
cleanup() {
  test -n "$record_id" && "$CURL" -fsS -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
    -d '{"mode":"eos"}' "${BASE_URL}/consumers/${record_id}/stop" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR"
guard_record="${OUTPUT_DIR}/a16-webrtc-guard.ts"
record_id="$("$CURL" -fsS -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "$("$JQ" -n --arg o "$guard_record" '{preset:"fifty-fifty",outputPath:$o,videoBitrateBps:4000000,fps:30}')" \
  "${BASE_URL}/consumers/record" | "$JQ" -r '.consumerId')"
deadline=$((SECONDS + 5))
while :; do
  guard_status="$("$CURL" -fsS "${AUTH[@]}" "${BASE_URL}/status")"
  guard_state="$("$JQ" -r --arg id "$record_id" '.consumers[] | select(.id == $id) | .state' <<<"$guard_status")"
  test "$guard_state" = "running" && break
  (( SECONDS < deadline )) || { echo "FAIL A16-WEBRTC guard record confirm timeout"; exit 1; }
  sleep 1
done
guard_pgid="$("$JQ" -r --arg id "$record_id" '.consumers[] | select(.id == $id) | .pgid' <<<"$guard_status")"
guard_size_before="$("$STAT" -c %s "$guard_record")"

all_results="${EVIDENCE_DIR}/webrtc-latencies.jsonl"
: > "$all_results"

for role in presentation lecturer-cam students-cam; do
  role_out="${EVIDENCE_DIR}/webrtc-${role}.json"
  EDUSCOPE_PM_TOKEN="${EDUSCOPE_PM_TOKEN}" "$PYTHON" -m pipeline_manager.pipelines.thumbnails \
    --loopback-probe --base-url "$BASE_URL" --role "$role" --iterations "$ITERATIONS" --json \
    > "$role_out"
  "$JQ" -c --arg role "$role" \
    '.results[] | {role: $role, ms: .first_frame_ms, workerPgid: .worker_pgid, worker_closed, error}' \
    "$role_out" >> "$all_results"
done

total_results="$(wc -l < "$all_results")"
expected=$((ITERATIONS * 3))
test "$total_results" -eq "$expected" || { echo "FAIL A16-WEBRTC expected $expected results, got $total_results"; exit 1; }

over_budget="$("$JQ" -s 'map(select(.ms >= 1000)) | length' "$all_results")"
probe_failures="$("$JQ" -s 'map(select(.ms == null)) | length' "$all_results")"
not_closed="$("$JQ" -s 'map(select(.worker_closed != true)) | length' "$all_results")"
test "$not_closed" = "0" || { echo "FAIL A16-WEBRTC $not_closed/$expected workers remained after close"; exit 1; }

guard_after="$("$CURL" -fsS "${AUTH[@]}" "${BASE_URL}/status")"
guard_pgid_after="$("$JQ" -r --arg id "$record_id" '.consumers[] | select(.id == $id) | .pgid' <<<"$guard_after")"
guard_size_after="$("$STAT" -c %s "$guard_record")"
test "$guard_pgid_after" = "$guard_pgid" || { echo "FAIL A16-WEBRTC guard record pid changed"; exit 1; }
test "$guard_size_after" -gt "$guard_size_before" || { echo "FAIL A16-WEBRTC guard record did not grow"; exit 1; }
test "$probe_failures" = "0" || { echo "FAIL A16-WEBRTC $probe_failures/$expected negotiations produced no frame"; exit 1; }
test "$over_budget" = "0" || { echo "FAIL A16-WEBRTC $over_budget/$expected negotiations >= 1000ms"; exit 1; }

max_ms="$("$JQ" -s 'map(.ms) | max' "$all_results")"
p50="$("$JQ" -s 'map(.ms) | sort | .[length/2 | floor]' "$all_results")"
p95="$("$JQ" -s 'map(.ms) | sort | .[(length * 0.95) | floor]' "$all_results")"
printf '{"p50":%s,"p95":%s,"max":%s}\n' "$p50" "$p95" "$max_ms" > "${EVIDENCE_DIR}/webrtc-summary.json"

printf "PASS A16-WEBRTC max-first-frame-ms=%s\n" "$max_ms"

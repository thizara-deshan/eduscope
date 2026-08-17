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
PYTHON="${PYTHON:-python3}"

command -v "$CURL" >/dev/null || { echo "FAIL A16-WEBRTC curl is required"; exit 1; }
command -v "$JQ" >/dev/null || { echo "FAIL A16-WEBRTC jq is required"; exit 1; }
command -v "$PYTHON" >/dev/null || { echo "FAIL A16-WEBRTC python3 is required"; exit 1; }

BASE_URL="http://127.0.0.1:8091"
EVIDENCE_DIR=""
ITERATIONS=20
MAX_MS=1000

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="$2"; shift 2 ;;
    --iterations) ITERATIONS="$2"; shift 2 ;;
    *) echo "FAIL A16-WEBRTC unknown argument: $1"; exit 1 ;;
  esac
done
test -n "$EVIDENCE_DIR" || { echo "FAIL A16-WEBRTC --evidence-dir is required"; exit 1; }
mkdir -p "$EVIDENCE_DIR"
: "${EDUSCOPE_PM_TOKEN:?set EDUSCOPE_PM_TOKEN}"

all_results="${EVIDENCE_DIR}/webrtc-latencies.jsonl"
: > "$all_results"

for role in presentation lecturer-cam students-cam; do
  role_out="${EVIDENCE_DIR}/webrtc-${role}.json"
  EDUSCOPE_PM_TOKEN="${EDUSCOPE_PM_TOKEN}" "$PYTHON" -m pipeline_manager.pipelines.thumbnails \
    --loopback-probe --base-url "$BASE_URL" --role "$role" --iterations "$ITERATIONS" --json \
    > "$role_out"
  "$JQ" -c --arg role "$role" '.results[] | {role: $role, ms: .first_frame_ms}' "$role_out" >> "$all_results"
done

total_results="$(wc -l < "$all_results")"
expected=$((ITERATIONS * 3))
test "$total_results" -eq "$expected" || { echo "FAIL A16-WEBRTC expected $expected results, got $total_results"; exit 1; }

over_budget="$("$JQ" -s 'map(select(.ms >= 1000)) | length' "$all_results")"
test "$over_budget" = "0" || { echo "FAIL A16-WEBRTC $over_budget/$expected negotiations >= 1000ms"; exit 1; }

max_ms="$("$JQ" -s 'map(.ms) | max' "$all_results")"
p50="$("$JQ" -s 'map(.ms) | sort | .[length/2 | floor]' "$all_results")"
p95="$("$JQ" -s 'map(.ms) | sort | .[(length * 0.95) | floor]' "$all_results")"
printf '{"p50":%s,"p95":%s,"max":%s}\n' "$p50" "$p95" "$max_ms" > "${EVIDENCE_DIR}/webrtc-summary.json"

printf "PASS A16-WEBRTC max-first-frame-ms=%s\n" "$max_ms"

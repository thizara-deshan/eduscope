#!/usr/bin/env bash
# A-16 bench gate: CPU headroom via /proc/stat, and encode-ledger enforcement
# under load (a second thumbnail must be refused while three slots are held).
# Usage: resource-ledger.sh --base-url URL --duration-sec N --evidence-dir DIR
#
# CURL/JQ/STAT_PROC (path to /proc/stat) may be overridden for testing;
# defaults to the real tool/path.
set -euo pipefail

CURL="${CURL:-curl}"
JQ="${JQ:-jq}"
PROC_STAT="${PROC_STAT:-/proc/stat}"

command -v "$CURL" >/dev/null || { echo "FAIL A16-RES curl is required"; exit 1; }
command -v "$JQ" >/dev/null || { echo "FAIL A16-RES jq is required"; exit 1; }

BASE_URL="http://127.0.0.1:8091"
DURATION_SEC=300
EVIDENCE_DIR=""
MIN_HEADROOM="30.00"
MIN_ROLLING="20.00"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --duration-sec) DURATION_SEC="$2"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="$2"; shift 2 ;;
    *) echo "FAIL A16-RES unknown argument: $1"; exit 1 ;;
  esac
done
test -n "$EVIDENCE_DIR" || { echo "FAIL A16-RES --evidence-dir is required"; exit 1; }
mkdir -p "$EVIDENCE_DIR"
: "${EDUSCOPE_PM_TOKEN:?set EDUSCOPE_PM_TOKEN}"
AUTH=( -H "Authorization: Bearer ${EDUSCOPE_PM_TOKEN}" )

# idle_percent = 100 * ((idle+iowait)_2 - (idle+iowait)_1) / (sum(all)_2 - sum(all)_1)
cpu_idle_percent() {
  # cpu_idle_percent <before-line> <after-line>
  awk -v before="$1" -v after="$2" '
    function fields(line,   n, a) { n = split(line, a, " "); return n }
    BEGIN {
      nb = split(before, b, " ")
      na = split(after, a, " ")
      idle1 = b[5] + b[6]; idle2 = a[5] + a[6]
      total1 = 0; for (i = 2; i <= nb; i++) total1 += b[i]
      total2 = 0; for (i = 2; i <= na; i++) total2 += a[i]
      idle_delta = idle2 - idle1
      total_delta = total2 - total1
      if (total_delta <= 0) { print 0; exit }
      printf "%.4f", 100 * idle_delta / total_delta
    }'
}

samples_file="${EVIDENCE_DIR}/cpu-idle-samples.txt"
: > "$samples_file"

before="$(head -n1 "$PROC_STAT")"
for ((i = 0; i < DURATION_SEC; i++)); do
  sleep 1
  after="$(head -n1 "$PROC_STAT")"
  idle="$(cpu_idle_percent "$before" "$after")"
  echo "$idle" >> "$samples_file"
  before="$after"
done

mean_idle="$(awk '{ s += $1; n++ } END { if (n == 0) print 0; else printf "%.4f", s / n }' "$samples_file")"
min_idle="$(sort -n "$samples_file" | head -n1)"

awk -v m="$mean_idle" -v min="$MIN_HEADROOM" 'BEGIN { exit !(m >= min) }' \
  || { echo "FAIL A16-RES mean idle $mean_idle% < $MIN_HEADROOM%"; exit 1; }

# 30-second rolling mean must never dip below MIN_ROLLING.
rolling_ok=1
awk -v w=30 -v min="$MIN_ROLLING" '
  { buf[NR % w] = $1; sum += $1; if (NR > w) sum -= buf[(NR - w) % w]
    if (NR >= w) { avg = sum / w; if (avg < min) { print "LOW"; exit } } }
' "$samples_file" | grep -q LOW && rolling_ok=0
test "$rolling_ok" = "1" || { echo "FAIL A16-RES 30s rolling mean idle dropped below $MIN_ROLLING%"; exit 1; }

# Ledger enforcement: attempt a second thumbnail while three slots are held.
status_json="$("$CURL" -fsS "${AUTH[@]}" "${BASE_URL}/status")"
echo "$status_json" > "${EVIDENCE_DIR}/ledger-snapshot.json"
in_use="$("$JQ" -r '.encodeLedger.inUse' <<<"$status_json")"
capacity="$("$JQ" -r '.encodeLedger.capacity' <<<"$status_json")"

if [[ "$in_use" == "$capacity" ]]; then
  refusal_body='{"negotiationId":"a16-ledger-probe","roleId":"presentation","sdp":"v=0..."}'
  refusal_status="$("$CURL" -s -o "${EVIDENCE_DIR}/ledger-refusal.json" -w '%{http_code}' \
    -X POST "${AUTH[@]}" -H 'Content-Type: application/json' -d "$refusal_body" \
    "${BASE_URL}/consumers/thumbnails/offer")"
  refusal_code="$("$JQ" -r '.code // empty' "${EVIDENCE_DIR}/ledger-refusal.json" 2>/dev/null || echo "")"
  test "$refusal_status" = "409" && test "$refusal_code" = "encoder_budget_exceeded" \
    || { echo "FAIL A16-RES ledger did not refuse over-capacity thumbnail"; exit 1; }
fi

printf "PASS A16-RES cpu-headroom=%s ledger-enforced\n" "$mean_idle"

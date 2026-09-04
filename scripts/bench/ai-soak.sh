#!/usr/bin/env bash
set -euo pipefail

: "${CORE_API_BEARER:?CORE_API_BEARER is required}"
: "${EVIDENCE_DIR:?EVIDENCE_DIR is required}"

SOAK_SECONDS="${SOAK_SECONDS:-5400}"
CORE_API_URL="${CORE_API_URL:-http://127.0.0.1:5000}"

if ! [[ "$SOAK_SECONDS" =~ ^[0-9]+$ ]] || (( SOAK_SECONDS < 5400 )); then
  echo "SOAK_SECONDS must be at least 5400" >&2
  exit 64
fi

for command_name in curl jq systemctl ffprobe python git sha256sum uname date; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "required command missing: $command_name" >&2
    exit 69
  }
done

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="${EVIDENCE_DIR%/}/$stamp"
install -d -m 0700 "$run_dir"

metrics="$run_dir/metrics.jsonl"
metadata="$run_dir/metadata.json"
summary="$run_dir/summary.json"
report="$run_dir/evidence.md"
runner_pid=""

cleanup() {
  exit_code=$?
  if [[ -n "$runner_pid" ]] && kill -0 "$runner_pid" 2>/dev/null; then
    kill -TERM "$runner_pid"
    wait "$runner_pid" || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

python "$repo_root/services/ai/test/integration/live-cycle.py" \
  --core-url "$CORE_API_URL" \
  --run-soak \
  --duration-sec "$SOAK_SECONDS" \
  --metrics-jsonl "$metrics" \
  --metadata-json "$metadata" &
runner_pid=$!
wait "$runner_pid"
runner_pid=""

python "$repo_root/services/ai/test/bench/parse_ai_soak.py" \
  "$metrics" \
  --output "$summary" \
  --evidence-template "$repo_root/services/ai/test/bench/evidence/c10-template.md" \
  --evidence-output "$report"

trap - EXIT INT TERM
echo "C-10 evidence: $run_dir"

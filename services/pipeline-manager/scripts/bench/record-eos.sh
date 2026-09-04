#!/usr/bin/env bash
# A-15 bench gate: warm attach, camera-only, targeted EOS, pause/resume A/V
# sync, and source-loss placeholder continuity. Five explicit phases.
# Usage: record-eos.sh --base-url URL --output-dir DIR
#
# CURL/JQ/FFPROBE/STAT/KILL/SLEEP may be overridden with the absolute path to
# a replacement binary — used by the test wrappers; defaults to the real tool.
set -euo pipefail

CURL="${CURL:-curl}"
JQ="${JQ:-jq}"
FFPROBE="${FFPROBE:-ffprobe}"
FFMPEG="${FFMPEG:-ffmpeg}"
STAT="${STAT:-stat}"
KILL="${KILL:-kill}"
SLEEP="${SLEEP:-sleep}"

command -v "$CURL" >/dev/null || { echo "FAIL A15-REC curl is required"; exit 1; }
command -v "$JQ" >/dev/null || { echo "FAIL A15-REC jq is required"; exit 1; }
command -v "$FFPROBE" >/dev/null || { echo "FAIL A15-REC ffprobe is required"; exit 1; }
command -v "$FFMPEG" >/dev/null || { echo "FAIL A15-REC ffmpeg is required"; exit 1; }
command -v "$STAT" >/dev/null || { echo "FAIL A15-REC stat is required"; exit 1; }
command -v "$KILL" >/dev/null || { echo "FAIL A15-REC kill is required"; exit 1; }

BASE_URL="http://127.0.0.1:8091"
OUTPUT_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    *) echo "FAIL A15-REC unknown argument: $1"; exit 1 ;;
  esac
done
test -n "$OUTPUT_DIR" || { echo "FAIL A15-REC --output-dir is required"; exit 1; }
: "${EDUSCOPE_PM_TOKEN:?set EDUSCOPE_PM_TOKEN}"
AUTH=( -H "Authorization: Bearer ${EDUSCOPE_PM_TOKEN}" )

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

status() { "$CURL" -fsS "${AUTH[@]}" "${BASE_URL}/status"; }

post_json() {
  # post_json <path> <json-body>
  "$CURL" -fsS -X POST "${AUTH[@]}" -H 'Content-Type: application/json' -d "$2" "${BASE_URL}$1"
}

wait_consumer_state() {
  # wait_consumer_state <consumerId> <state> <deadline-seconds>
  local id="$1" want="$2" deadline=$((SECONDS + $3))
  while :; do
    local have
    have="$(status | "$JQ" -r --arg id "$id" '.consumers[] | select(.id == $id) | .state')"
    [[ "$have" == "$want" ]] && return 0
    (( SECONDS < deadline )) || return 1
    "$SLEEP" 1
  done
}

wait_growth() {
  # wait_growth <path> <deadline-seconds>
  local path="$1" deadline=$((SECONDS + $2))
  local before after
  before="$("$STAT" -c%s "$path" 2>/dev/null || echo 0)"
  while :; do
    "$SLEEP" 1
    after="$("$STAT" -c%s "$path" 2>/dev/null || echo 0)"
    (( after > before )) && return 0
    (( SECONDS < deadline )) || return 1
  done
}

stop_eos() {
  # stop_eos <consumerId>
  post_json "/consumers/$1/stop" '{"mode":"eos"}' >/dev/null
  wait_consumer_state "$1" "exited" 10
}

probe_positive_duration() {
  # probe_positive_duration <path>
  local duration
  duration="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null || echo 0)"
  awk -v d="$duration" 'BEGIN { exit !(d > 0) }'
}

# ── 1. Warm attach ───────────────────────────────────────────────────────
warm_out="${OUTPUT_DIR}/a15-warm.ts"
before_pub="$(status | "$JQ" -c '.publishers | map_values(.pid)')"
warm_id="$(post_json /consumers/record "$("$JQ" -n --arg p fifty-fifty --arg o "$warm_out" '{preset:$p, outputPath:$o}')" | "$JQ" -r '.consumerId')"
wait_consumer_state "$warm_id" running 5 || { echo "FAIL A15-REC warm-attach confirm"; exit 1; }
wait_growth "$warm_out" 5 || { echo "FAIL A15-REC warm-attach growth"; exit 1; }
after_pub="$(status | "$JQ" -c '.publishers | map_values(.pid)')"
test "$before_pub" = "$after_pub" || { echo "FAIL A15-REC warm-attach publisher pids changed"; exit 1; }
stop_eos "$warm_id" || { echo "FAIL A15-REC warm-attach stop"; exit 1; }
echo "PASS A15-REC warm-attach"

# ── 2. Camera-only ───────────────────────────────────────────────────────
"$CURL" -fsS -X POST "${AUTH[@]}" "${BASE_URL}/publishers/usb/stop" >/dev/null
cam_out="${OUTPUT_DIR}/a15-camera-only.ts"
cam_id="$(post_json /consumers/record "$("$JQ" -n --arg p cam-1 --arg o "$cam_out" '{preset:$p, outputPath:$o}')" | "$JQ" -r '.consumerId')"
wait_consumer_state "$cam_id" running 5 || { echo "FAIL A15-REC camera-only confirm"; exit 1; }
wait_growth "$cam_out" 5 || { echo "FAIL A15-REC camera-only growth"; exit 1; }
stop_eos "$cam_id" || { echo "FAIL A15-REC camera-only stop"; exit 1; }
probe_positive_duration "$cam_out" || { echo "FAIL A15-REC camera-only duration"; exit 1; }
"$CURL" -fsS -X POST "${AUTH[@]}" "${BASE_URL}/publishers/usb/start" >/dev/null
deadline=$((SECONDS + 15))
usb_pid=""
until [[ "$(status | "$JQ" -r '.publishers.usb.state')" == "online" ]]; do
  (( SECONDS < deadline )) || { echo "FAIL A15-REC camera-only usb restore"; exit 1; }
  "$SLEEP" 1
done
while :; do
  current_usb_pid="$(status | "$JQ" -r '.publishers.usb.pid')"
  if [[ "$current_usb_pid" =~ ^[1-9][0-9]*$ ]] && test "$current_usb_pid" = "$usb_pid"; then
    break
  fi
  usb_pid="$current_usb_pid"
  (( SECONDS < deadline )) || { echo "FAIL A15-REC camera-only usb stable"; exit 1; }
  "$SLEEP" 1
done
echo "PASS A15-REC camera-only"

# ── 3. Targeted EOS ──────────────────────────────────────────────────────
rec_out="${OUTPUT_DIR}/a15-targeted.ts"
rec_id="$(post_json /consumers/record "$("$JQ" -n --arg p fifty-fifty --arg o "$rec_out" '{preset:$p, outputPath:$o}')" | "$JQ" -r '.consumerId')"
live_id="$(post_json /consumers/live '{"preset":"fifty-fifty","streamKey":"a15bench"}' | "$JQ" -r '.consumerId')"
meeting_id="$(post_json /consumers/meeting '{"preset":"cams-fifty-fifty"}' | "$JQ" -r '.consumerId')"
wait_consumer_state "$rec_id" running 5 || { echo "FAIL A15-REC targeted-eos record confirm"; exit 1; }
wait_consumer_state "$live_id" running 5 || { echo "FAIL A15-REC targeted-eos live confirm"; exit 1; }
wait_consumer_state "$meeting_id" running 5 || { echo "FAIL A15-REC targeted-eos meeting confirm"; exit 1; }
live_pgid_before="$(status | "$JQ" -r --arg id "$live_id" '.consumers[] | select(.id == $id) | .pgid')"
meeting_pgid_before="$(status | "$JQ" -r --arg id "$meeting_id" '.consumers[] | select(.id == $id) | .pgid')"
stop_eos "$rec_id" || { echo "FAIL A15-REC targeted-eos stop"; exit 1; }
probe_positive_duration "$rec_out" || { echo "FAIL A15-REC targeted-eos duration"; exit 1; }
targeted_status="$(status)"
live_pgid_after="$("$JQ" -r --arg id "$live_id" '.consumers[] | select(.id == $id) | .pgid' <<<"$targeted_status")"
meeting_pgid_after="$("$JQ" -r --arg id "$meeting_id" '.consumers[] | select(.id == $id) | .pgid' <<<"$targeted_status")"
test "$live_pgid_before" = "$live_pgid_after" || { echo "FAIL A15-REC targeted-eos live pgid changed"; exit 1; }
test "$meeting_pgid_before" = "$meeting_pgid_after" || { echo "FAIL A15-REC targeted-eos meeting pgid changed"; exit 1; }
test "$("$JQ" -r --arg id "$live_id" '.consumers[] | select(.id == $id) | .state' <<<"$targeted_status")" = running \
  || { echo "FAIL A15-REC targeted-eos live not running"; exit 1; }
test "$("$JQ" -r --arg id "$meeting_id" '.consumers[] | select(.id == $id) | .state' <<<"$targeted_status")" = running \
  || { echo "FAIL A15-REC targeted-eos meeting not running"; exit 1; }
stop_eos "$live_id" || true
stop_eos "$meeting_id" || true
echo "PASS A15-REC targeted-eos"

# ── 4. Pause/resume A/V sync ─────────────────────────────────────────────
before_out="${OUTPUT_DIR}/a15-before-pause.ts"
after_out="${OUTPUT_DIR}/a15-after-resume.ts"
pause_id="$(post_json /consumers/record "$("$JQ" -n --arg p fifty-fifty --arg o "$before_out" '{preset:$p, outputPath:$o}')" | "$JQ" -r '.consumerId')"
wait_consumer_state "$pause_id" running 5 || { echo "FAIL A15-REC pause-resume-sync confirm"; exit 1; }
"$SLEEP" 10
post_json "/consumers/${pause_id}/stop" '{"mode":"eos","timeoutMs":5000}' >/dev/null
wait_consumer_state "$pause_id" exited 5 || { echo "FAIL A15-REC pause-resume-sync pause"; exit 1; }
"$SLEEP" 3
resume_id="$(post_json /consumers/record "$("$JQ" -n --arg p fifty-fifty --arg o "$after_out" '{preset:$p, outputPath:$o}')" | "$JQ" -r '.consumerId')"
wait_consumer_state "$resume_id" running 5 || { echo "FAIL A15-REC pause-resume-sync resume confirm"; exit 1; }
"$SLEEP" 10
stop_eos "$resume_id" || { echo "FAIL A15-REC pause-resume-sync resume stop"; exit 1; }
test "$before_out" != "$after_out" || { echo "FAIL A15-REC pause-resume-sync same path"; exit 1; }

for f in "$before_out" "$after_out"; do
  "$FFPROBE" -v error -select_streams v:0 -show_entries stream=start_time -of csv=p=0 "$f" > "${TMP_DIR}/$(basename "$f").v"
  "$FFPROBE" -v error -select_streams a:0 -show_entries stream=start_time -of csv=p=0 "$f" > "${TMP_DIR}/$(basename "$f").a"
  v="$(cat "${TMP_DIR}/$(basename "$f").v")"
  a="$(cat "${TMP_DIR}/$(basename "$f").a")"
  offset="$(awk -v v="$v" -v a="$a" 'BEGIN { d = v - a; if (d < 0) d = -d; print d }')"
  awk -v d="$offset" 'BEGIN { exit !(d <= 0.100) }' || { echo "FAIL A15-REC pause-resume-sync offset $(basename "$f")=$offset"; exit 1; }
done
echo "PASS A15-REC pause-resume-sync"

# ── 5. Source loss ───────────────────────────────────────────────────────
loss_out="${OUTPUT_DIR}/a15-source-loss.ts"
loss_id="$(post_json /consumers/record "$("$JQ" -n --arg p fifty-fifty --arg o "$loss_out" '{preset:$p, outputPath:$o}')" | "$JQ" -r '.consumerId')"
wait_consumer_state "$loss_id" running 5 || { echo "FAIL A15-REC source-loss confirm"; exit 1; }
wait_growth "$loss_out" 5 || { echo "FAIL A15-REC source-loss initial growth"; exit 1; }
size_before="$("$STAT" -c%s "$loss_out")"
loss_pgid_before="$(status | "$JQ" -r --arg id "$loss_id" '.consumers[] | select(.id == $id) | .pgid')"
rtsp_pid="$(status | "$JQ" -r '.publishers.rtsp.pid')"
"$KILL" -TERM "$rtsp_pid"
saw_loss=0
for _ in {1..12}; do
  "$SLEEP" 1
  current_publisher_state="$(status | "$JQ" -r '.publishers.rtsp.state')"
  [[ "$current_publisher_state" == degraded || "$current_publisher_state" == offline ]] && saw_loss=1
done
size_after="$("$STAT" -c%s "$loss_out")"
(( size_after > size_before )) || { echo "FAIL A15-REC source-loss file did not grow"; exit 1; }
loss_status="$(status)"
loss_pgid="$("$JQ" -r --arg id "$loss_id" '.consumers[] | select(.id == $id) | .pgid' <<<"$loss_status")"
test "$saw_loss" = 1 || { echo "FAIL A15-REC source-loss transition not observed"; exit 1; }
test "$loss_pgid" = "$loss_pgid_before" || { echo "FAIL A15-REC source-loss consumer pgid changed"; exit 1; }
test "$("$JQ" -r --arg id "$loss_id" '.consumers[] | select(.id == $id) | .state' <<<"$loss_status")" = running \
  || { echo "FAIL A15-REC source-loss consumer not running"; exit 1; }
test "$("$JQ" -r '.publishers.rtsp.state' <<<"$loss_status")" = online \
  || { echo "FAIL A15-REC source-loss publisher not restored"; exit 1; }
stop_eos "$loss_id" || { echo "FAIL A15-REC source-loss stop"; exit 1; }
probe_positive_duration "$loss_out" || { echo "FAIL A15-REC source-loss duration"; exit 1; }
loss_duration="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$loss_out" 2>/dev/null || echo 0)"
awk -v d="$loss_duration" 'BEGIN { exit !(d >= 12.0) }' \
  || { echo "FAIL A15-REC source-loss finalized duration $loss_duration < 12s"; exit 1; }
placeholder_frame="${OUTPUT_DIR}/a15-source-loss-placeholder.png"
"$FFMPEG" -hide_banner -loglevel error -y -ss 2 -i "$loss_out" -frames:v 1 "$placeholder_frame" \
  || { echo "FAIL A15-REC source-loss placeholder frame extraction"; exit 1; }
test -s "$placeholder_frame" || { echo "FAIL A15-REC source-loss placeholder frame empty"; exit 1; }
echo "PASS A15-REC source-loss-placeholder"

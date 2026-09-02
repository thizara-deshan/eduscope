#!/usr/bin/env bash
# A-15 bench gate: warm publishers, exact sockets, isolated restarts.
# Usage: publishers.sh [BASE_URL]
# Requires: EDUSCOPE_PM_TOKEN in the environment (never as a CLI argument).
#
# CURL/JQ/KILL/SLEEP may be overridden with the absolute path to a
# replacement binary — used by the test wrappers; defaults to the real tool.
set -euo pipefail

CURL="${CURL:-curl}"
JQ="${JQ:-jq}"
KILL="${KILL:-kill}"
SLEEP="${SLEEP:-sleep}"

command -v "$CURL" >/dev/null || { echo "FAIL A15-PUB curl is required"; exit 1; }
command -v "$JQ" >/dev/null || { echo "FAIL A15-PUB jq is required"; exit 1; }
command -v "$KILL" >/dev/null || { echo "FAIL A15-PUB kill is required"; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

BASE_URL="${1:-http://127.0.0.1:8091}"
: "${EDUSCOPE_PM_TOKEN:?set EDUSCOPE_PM_TOKEN}"
AUTH=( -H "Authorization: Bearer ${EDUSCOPE_PM_TOKEN}" )

status() { "$CURL" -fsS "${AUTH[@]}" "${BASE_URL}/status"; }

for id in usb rtsp rtsp2 audio; do
  "$CURL" -fsS -X POST "${AUTH[@]}" "${BASE_URL}/publishers/${id}/start" >/dev/null
done

deadline=$((SECONDS + 15))
until status | "$JQ" -e '[.publishers.usb,.publishers.rtsp,.publishers.rtsp2,.publishers.audio]
  | all(.state == "online" or .state == "degraded")' >/dev/null; do
  (( SECONDS < deadline )) || { echo "FAIL A15-PUB warm publishers"; exit 1; }
  "$SLEEP" 1
done

for sock in /tmp/usb.sock /tmp/rtsp.sock /tmp/rtsp2.sock /tmp/audio.sock; do
  test -S "$sock" || { echo "FAIL A15-PUB missing $sock"; exit 1; }
done

for id in usb rtsp rtsp2 audio; do
  before="$(status)"
  old_pid="$("$JQ" -r --arg id "$id" '.publishers[$id].pid' <<<"$before")"
  sibling="$("$JQ" -c --arg id "$id" '.consumers | map(select(.state == "running") | .pgid) | sort' <<<"$before")"
  "$KILL" -TERM "$old_pid"
  deadline=$((SECONDS + 15))
  while :; do
    after="$(status)"
    new_pid="$("$JQ" -r --arg id "$id" '.publishers[$id].pid' <<<"$after")"
    new_state="$("$JQ" -r --arg id "$id" '.publishers[$id].state' <<<"$after")"
    if [[ "$new_pid" =~ ^[1-9][0-9]*$ ]] && test "$new_pid" != "$old_pid" \
      && test "$new_state" = online; then
      "$SLEEP" 1
      stable="$(status)"
      test "$("$JQ" -r --arg id "$id" '.publishers[$id].pid' <<<"$stable")" = "$new_pid" \
        && test "$("$JQ" -r --arg id "$id" '.publishers[$id].state' <<<"$stable")" = online \
        && break
    fi
    (( SECONDS < deadline )) || { echo "FAIL A15-PUB restart $id"; exit 1; }
    "$SLEEP" 1
  done
  test "$("$JQ" -c '.consumers | map(select(.state == "running") | .pgid) | sort' <<<"$after")" = "$sibling" \
    || { echo "FAIL A15-PUB consumer changed after $id"; exit 1; }
done
echo "PASS A15-PUB warm publishers, sockets, isolated restarts"

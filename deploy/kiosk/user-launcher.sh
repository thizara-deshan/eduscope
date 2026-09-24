#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly manifest=/etc/eduscope/device-manifest.json
readonly flags_file=/opt/eduscope/current/deploy/kiosk/chromium-flags.conf
readonly profile_dir="$HOME/snap/chromium/common/edus-kiosk"
readonly profile="${EDUSCOPE_DEPLOYMENT_PROFILE:-production}"

for ((attempt=0; attempt<120; attempt++)); do
  /usr/bin/xdpyinfo -display "${DISPLAY:?}" >/dev/null 2>&1 && break
  /usr/bin/sleep 0.5
done
/usr/bin/xdpyinfo -display "$DISPLAY" >/dev/null 2>&1
/usr/bin/xhost +SI:localuser:eduscope-pipeline >/dev/null
/opt/eduscope/current/deploy/kiosk/xrandr-layout.sh --manifest "$manifest" --profile "$profile"
/opt/eduscope/current/deploy/kiosk/display-hotplug-watch.sh &
watcher_pid=$!
/usr/bin/mkdir -p -- "$profile_dir"

flags=("--user-data-dir=$profile_dir")
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] || flags+=("$line")
done <"$flags_file"
/snap/bin/chromium "${flags[@]}" &
browser_pid=$!
trap 'kill "$browser_pid" "$watcher_pid" 2>/dev/null || true' EXIT INT TERM

window=
for ((attempt=0; attempt<60; attempt++)); do
  window=$(/usr/bin/wmctrl -lp | /usr/bin/awk -v pid="$browser_pid" '$3 == pid { print $1; exit }')
  [[ -z "$window" ]] || break
  /usr/bin/sleep 0.25
done
[[ -n "$window" ]] || { printf 'Chromium kiosk window unavailable\n' >&2; exit 1; }
/usr/bin/wmctrl -ir "$window" -b remove,fullscreen
/usr/bin/wmctrl -ir "$window" -e 0,3840,0,1920,1080
/usr/bin/wmctrl -ir "$window" -b add,fullscreen
wait "$browser_pid"

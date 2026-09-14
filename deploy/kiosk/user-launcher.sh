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
/usr/bin/mkdir -p -- "$profile_dir"

flags=("--user-data-dir=$profile_dir")
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] || flags+=("$line")
done <"$flags_file"
exec /snap/bin/chromium "${flags[@]}"

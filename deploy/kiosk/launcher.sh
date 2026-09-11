#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

kiosk_uid="$(id -u)"
readonly kiosk_uid
readonly manifest=/etc/eduscope/device-manifest.json
readonly flags_file=/opt/eduscope/current/deploy/kiosk/chromium-flags.conf
readonly gdm_auth="/run/user/${kiosk_uid}/gdm/Xauthority"
readonly home_auth=/var/lib/eduscope/kiosk/.Xauthority
export DISPLAY=:0

if [[ -r "$gdm_auth" ]]; then
  export XAUTHORITY="$gdm_auth"
elif [[ -r "$home_auth" ]]; then
  export XAUTHORITY="$home_auth"
else
  printf 'Xauthority unavailable\n' >&2
  exit 78
fi

for ((attempt=0; attempt<120; attempt++)); do
  if /usr/bin/xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    break
  fi
  /usr/bin/sleep 0.5
done
/usr/bin/xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 || {
  printf 'X11 display unavailable after 60 seconds\n' >&2
  exit 1
}

# The meeting consumer runs under its own unprivileged account and renders to
# this local X server. Grant only that local user access; no TCP or global
# access-control relaxation is involved.
/usr/bin/xhost +SI:localuser:eduscope-pipeline >/dev/null

readonly profile="${EDUSCOPE_DEPLOYMENT_PROFILE:-production}"
/opt/eduscope/current/deploy/kiosk/xrandr-layout.sh --manifest "$manifest" --profile "$profile"

chromium=/usr/bin/chromium
[[ -x /snap/bin/chromium ]] && chromium=/snap/bin/chromium
[[ -x "$chromium" ]] || { printf 'Chromium executable unavailable\n' >&2; exit 69; }

flags=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] || flags+=("$line")
done <"$flags_file"
exec "$chromium" "${flags[@]}"

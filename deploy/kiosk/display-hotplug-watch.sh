#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly manifest=/etc/eduscope/device-manifest.json
readonly profile="${EDUSCOPE_DEPLOYMENT_PROFILE:-production}"
readonly layout=/opt/eduscope/current/deploy/kiosk/xrandr-layout.sh

# GNOME reacts to DRM hot-plug first and may rearrange the desktop. Reapply
# the device policy after the connector has settled so fixed outputs retain
# their resolution and coordinates when the optional meeting display changes.
/usr/bin/udevadm monitor --udev --subsystem-match=drm |
  while IFS= read -r event; do
    [[ "$event" == UDEV*change*drm/card* ]] || continue
    /usr/bin/sleep 1
    "$layout" --manifest "$manifest" --profile "$profile" ||
      printf 'display hot-plug layout rejected\n' >&2
  done

#!/usr/bin/env bash
set -euo pipefail
/usr/bin/xset s off
/usr/bin/xset -dpms
exec /usr/bin/dbus-run-session -- /usr/bin/sleep infinity

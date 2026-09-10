#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ ${1:-} == --output && -n ${2:-} ]] || { echo 'usage: inventory.sh --output DIR' >&2; exit 64; }
evidence_dir=$2
mkdir -p "$evidence_dir"
run() { local name=$1; shift; { printf '$'; printf ' %q' "$@"; printf '\n'; "$@"; } >"$evidence_dir/$name.txt" 2>&1 || true; }
run os-release sh -c 'cat /etc/os-release; uname -a; uname -m'
run board sh -c 'tr -d "\\0" </proc/device-tree/model; printf "\\n"; cat /proc/meminfo'
run block lsblk --json --bytes --output NAME,PATH,TYPE,SIZE,FSTYPE,LABEL,UUID,PARTUUID,MOUNTPOINTS,MODEL,SERIAL,TRAN
run usb lsusb -v
run video v4l2-ctl --list-devices
run audio-capture arecord -l
run audio-playback aplay -l
# Variables expand in the child sh, not this script.
# shellcheck disable=SC2016
run alsa-ids sh -c 'for p in /proc/asound/card*/id; do printf "%s " "$p"; cat "$p"; done'
run displays xrandr --props
# Variables expand in the child sh, not this script.
# shellcheck disable=SC2016
run display-edids sh -c 'for p in /sys/class/drm/card*-*/edid; do test -s "$p" && sha256sum "$p"; done'
run input udevadm info --export-db
run gpio sh -c 'command -v gpioinfo >/dev/null && { gpiodetect; gpioinfo; }; find /sys/class/leds -maxdepth 2 -type f -print 2>/dev/null'
run network networkctl list --no-legend
run versions sh -c 'node --version; pnpm --version; python3 --version; systemd --version | head -1; gst-inspect-1.0 --version | head -1; nginx -v; stunnel4 -version 2>&1 | head -1; chromium --version || chromium-browser --version'
(cd "$evidence_dir" && sha256sum ./*.txt >sha256sums.txt)
printf 'PASS inventory captured: %s\n' "$evidence_dir"

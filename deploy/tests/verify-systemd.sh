#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} == --live && $# == 1 ]]; then
  services=(eduscope-pipeline-manager.service eduscope-core-api.service eduscope-stt.service eduscope-slide.service eduscope-question.service eduscope-kiosk.service)
  for service in "${services[@]}"; do
    systemctl is-active --quiet "$service"
  done
  systemctl is-active --quiet eduscope-helper.socket

  mount_source=$(findmnt -n -o SOURCE --target /media/eduscope)
  expected_uuid=$(findmnt -n -o UUID --target /media/eduscope)
  [[ -n $expected_uuid && $(readlink -f "$mount_source") == $(readlink -f "/dev/disk/by-uuid/$expected_uuid") ]]
  if findmnt -rn -o TARGET,OPTIONS,SOURCE | awk '$1 != "/media/eduscope" && $2 ~ /(^|,)x-udisks-auth(,|$)/ { found=1 } END { exit found ? 0 : 1 }'; then
    echo 'unexpected removable automount found' >&2
    exit 1
  fi

  restart_and_wait() {
    local service=$1 old_pid new_pid deadline
    old_pid=$(systemctl show -p MainPID --value "$service")
    [[ $old_pid =~ ^[1-9][0-9]*$ ]]
    kill -TERM "$old_pid"
    deadline=$((SECONDS + 30))
    while (( SECONDS < deadline )); do
      new_pid=$(systemctl show -p MainPID --value "$service")
      if [[ $new_pid =~ ^[1-9][0-9]*$ && $new_pid != "$old_pid" ]] && systemctl is-active --quiet "$service"; then
        return 0
      fi
      sleep 1
    done
    echo "unit did not restart once: $service" >&2
    return 1
  }

  restart_and_wait eduscope-pipeline-manager.service
  systemctl is-active --quiet eduscope-core-api.service
  systemctl is-active --quiet eduscope-kiosk.service
  /opt/eduscope/current/deploy/systemd/wait-http.py http://127.0.0.1:5000/healthz 30

  restart_and_wait eduscope-core-api.service
  systemctl is-active --quiet eduscope-pipeline-manager.service
  systemctl is-active --quiet eduscope-stt.service
  systemctl is-active --quiet eduscope-slide.service
  systemctl is-active --quiet eduscope-question.service
  /opt/eduscope/current/deploy/systemd/wait-http.py http://127.0.0.1:5000/healthz 30

  for service in eduscope-stt.service eduscope-slide.service eduscope-question.service; do
    restart_and_wait "$service"
    systemctl is-active --quiet eduscope-pipeline-manager.service
    systemctl is-active --quiet eduscope-core-api.service
    systemctl is-active --quiet eduscope-kiosk.service
  done
  restart_and_wait eduscope-kiosk.service
  for service in eduscope-pipeline-manager.service eduscope-core-api.service eduscope-stt.service eduscope-slide.service eduscope-question.service; do
    systemctl is-active --quiet "$service"
  done

  helper_pid=$(systemctl show -p MainPID --value eduscope-helper.service)
  if [[ $helper_pid =~ ^[1-9][0-9]*$ ]]; then
    kill -TERM "$helper_pid"
  fi
  systemctl stop eduscope-helper.service
  python3 - <<'PY'
import json
import socket
import uuid

request = {"verb": "firmware.check", "args": {}, "requestId": str(uuid.uuid4())}
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
    client.settimeout(5)
    client.connect("/run/eduscope/helper.sock")
    client.sendall(json.dumps(request, separators=(",", ":")).encode() + b"\n")
    if not client.recv(16384).endswith(b"\n"):
        raise SystemExit("helper socket response was not newline framed")
PY
  systemctl is-active --quiet eduscope-helper.service
  echo 'PASS systemd live restart matrix'
  exit 0
fi

[[ $# == 1 && $1 != --live ]] || {
  echo 'usage: verify-systemd.sh DIR' >&2
  exit 64
}

unit_dir=$(realpath "$1")
[[ -d $unit_dir ]] || { echo "unit directory not found: $unit_dir" >&2; exit 1; }
root=$(mktemp -d /tmp/eduscope-systemd-verify.XXXXXX)
trap 'rm -rf -- "$root"' EXIT

mkdir -p "$root/etc/systemd/system" "$root/etc/systemd/system/nginx.service.d" "$root/etc/systemd/system/stunnel4.service.d"
sed -e 's/@RECORDINGS_UUID@/11111111-2222-3333-4444-555555555555/g' \
  "$unit_dir/media-eduscope.mount.template" > "$root/etc/systemd/system/media-eduscope.mount"
for unit in "$unit_dir"/*.service "$unit_dir"/*.socket; do
  sed -e 's|@TOUCH_DEVNODE@|/dev/input/event0|g' -e 's/@KIOSK_UID@/1000/g' "$unit" > "$root/etc/systemd/system/$(basename "$unit")"
done
cp "$unit_dir/nginx.service.d/eduscope.conf" "$root/etc/systemd/system/nginx.service.d/eduscope.conf"
cp "$unit_dir/stunnel4.service.d/eduscope.conf" "$root/etc/systemd/system/stunnel4.service.d/eduscope.conf"

for unit in nginx.service stunnel4.service display-manager.service; do
  ln -s /dev/null "$root/etc/systemd/system/$unit"
done
for target in sysinit.target basic.target local-fs.target network-online.target graphical.target multi-user.target sockets.target; do
  printf '[Unit]\nDescription=Verification stub %s\n' "$target" > "$root/etc/systemd/system/$target"
done

stub_paths=(
  /usr/bin/systemd-tmpfiles /usr/bin/node /usr/bin/stunnel4 /usr/sbin/nginx /bin/kill
  /opt/eduscope/current/venvs/helper/bin/eduscope-privileged-helper
  /opt/eduscope/current/deploy/runtime/render.py
  /opt/eduscope/current/deploy/runtime/render-hardware.py
  /opt/eduscope/current/venvs/pipeline/bin/uvicorn
  /opt/eduscope/current/services/core-api/dist/src/server.js
  /opt/eduscope/current/venvs/ai/bin/eduscope-stt-service
  /opt/eduscope/current/venvs/ai/bin/eduscope-slide-service
  /opt/eduscope/current/venvs/ai/bin/eduscope-question-service
  /opt/eduscope/current/deploy/systemd/wait-http.py
  /opt/eduscope/current/deploy/kiosk/launcher.sh
)
for path in "${stub_paths[@]}"; do
  mkdir -p "$root$(dirname "$path")"
  touch "$root$path"
  chmod 0755 "$root$path"
done

units=("$root"/etc/systemd/system/eduscope-*.service "$root"/etc/systemd/system/eduscope-helper.socket "$root"/etc/systemd/system/media-eduscope.mount)
SYSTEMD_LOG_LEVEL=warning systemd-analyze verify --root="$root" "${units[@]}"

python3 - "$root/etc/systemd/system" <<'PY'
import pathlib
import sys

directory = pathlib.Path(sys.argv[1])
texts = {path.name: path.read_text() for path in directory.glob("eduscope-*.service")}
assert "Requires=media-eduscope.mount" in texts["eduscope-runtime-config.service"]
assert "Wants=network-online.target eduscope-pipeline-manager.service" in texts["eduscope-core-api.service"]
assert "Requires=eduscope-pipeline-manager.service" not in texts["eduscope-core-api.service"]
for name in ("eduscope-stt.service", "eduscope-slide.service"):
    assert "Wants=eduscope-pipeline-manager.service" in texts[name]
    assert "Requires=eduscope-pipeline-manager.service" not in texts[name]
PY

echo 'PASS systemd unit graph'

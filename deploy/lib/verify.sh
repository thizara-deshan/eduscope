#!/usr/bin/env bash
# shellcheck disable=SC2154
start_and_smoke() {
  fail_stage smoke
  [[ $EDUSCOPE_INSTALL_DRY_RUN == false ]] || { action 'bounded health proxy recording ffprobe smoke'; return; }
  systemctl restart eduscope-helper.socket eduscope-runtime-config.service
  systemctl stop eduscope-stunnel.service
  systemctl restart nginx.service
  systemctl restart eduscope-pipeline-manager.service eduscope-core-api.service
  systemctl restart eduscope-stt.service eduscope-slide.service eduscope-question.service
  "$release/deploy/systemd/wait-http.py" http://127.0.0.1:8091/healthz 60
  "$release/deploy/systemd/wait-http.py" http://127.0.0.1:5000/healthz 60
  "$release/deploy/systemd/wait-http.py" http://127.0.0.1:7101/healthz 60
  "$release/deploy/systemd/wait-http.py" http://127.0.0.1:7102/healthz 60
  "$release/deploy/systemd/wait-http.py" http://127.0.0.1:7103/healthz 60
  "$release/deploy/systemd/wait-http.py" http://127.0.0.1:80/healthz 60
  python3 - "$EDUSCOPE_INSTALL_PROFILE" <<'PY'
import json
import pathlib
import sys
config = json.loads(pathlib.Path('/run/eduscope/config.json').read_text())
if config.get('deploymentProfile') != sys.argv[1]:
    raise SystemExit('deployed profile mismatch')
PY
  systemctl restart gdm3.service
  local kiosk_xauthority deadline
  kiosk_xauthority="/run/user/$(id -u eduscope-kiosk)/gdm/Xauthority"
  deadline=$((SECONDS + 60))
  while [[ ! -r $kiosk_xauthority && $SECONDS -lt $deadline ]]; do
    sleep 1
  done
  [[ -r $kiosk_xauthority ]] || { echo 'kiosk Xauthority unavailable after 60 seconds' >&2; return 1; }
  deadline=$((SECONDS + 60))
  while ! runuser -u eduscope-kiosk -- env DISPLAY=:0 XAUTHORITY="$kiosk_xauthority" \
    xdpyinfo -display :0 >/dev/null 2>&1; do
    (( SECONDS < deadline )) || { echo 'kiosk X11 display unavailable after 60 seconds' >&2; return 1; }
    sleep 1
  done
  runuser -u eduscope-kiosk -- env DISPLAY=:0 XAUTHORITY="$kiosk_xauthority" \
    "$release/deploy/kiosk/xrandr-layout.sh" --manifest /etc/eduscope/device-manifest.json \
    --profile "$EDUSCOPE_INSTALL_PROFILE"
  systemctl restart eduscope-kiosk.service
  sleep 10
  systemctl is-active --quiet eduscope-kiosk.service
}
mark_install_success(){ fail_stage success;[[ $EDUSCOPE_INSTALL_DRY_RUN == false ]]||{ echo "DRY RUN COMPLETE profile=$EDUSCOPE_INSTALL_PROFILE";return;};install -d -m 0700 "$rollback_dir";printf '%s\n' "$release_id">"$rollback_dir/SUCCESS";[[ $EDUSCOPE_INSTALL_PROFILE == production ]]&&echo 'PASS install verified profile=production'||echo 'PASS demo smoke profile=demo-staging placeholder / firmware acceptance still open'; }

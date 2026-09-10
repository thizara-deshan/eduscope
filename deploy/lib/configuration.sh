#!/usr/bin/env bash
# shellcheck disable=SC2154
render_helper_config() {
  local output=$1 firmware_mode=enabled
  [[ $EDUSCOPE_INSTALL_PROFILE != demo-staging ]] || firmware_mode=disabled
  python3 - "$manifest" "$output" "$firmware_mode" <<'PY'
import json
import os
import pathlib
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
config = {
    "wiredInterface": manifest["network"]["wiredInterface"],
    "recordingsUuid": manifest["storage"]["recordingsUuid"],
    "captureHub": {
        "location": manifest["capture"]["hubLocation"],
        "port": manifest["capture"]["hubPort"],
    },
    "led": manifest["led"],
    "allowedDevnodes": [],
    "networkDirectory": "/etc/systemd/network",
    "firmwareMode": sys.argv[3],
}
temporary = pathlib.Path(sys.argv[2] + ".new")
temporary.write_text(json.dumps(config, separators=(",", ":")) + "\n")
os.chmod(temporary, 0o600)
os.replace(temporary, sys.argv[2])
PY
}

install_provisioning_and_secrets() {
  fail_stage configuration
  owned_install_as 0640 root eduscope-kiosk "$manifest" /etc/eduscope/device-manifest.json
  owned_install 0640 "$provisioning" /etc/eduscope/provisioning.json
  owned_install 0640 "$secrets" /etc/eduscope/secrets.json
  owned_install_as 0640 root eduscope-core "$(dirname "$secrets")/bootstrap-admin.password" /etc/eduscope/bootstrap-admin.password
  if [[ $EDUSCOPE_INSTALL_DRY_RUN == false ]]; then
    render_helper_config /etc/eduscope/helper.json
  else
    action "render helper.json profile=$EDUSCOPE_INSTALL_PROFILE"
  fi
}
render_unit(){
  local source=$1 target=$2 profile=$3 kiosk_uid=$4 temporary
  temporary="${target}.new.$$"
  sed -e 's|@TOUCH_DEVNODE@|/dev/input/eduscope-touch|g' -e "s/@KIOSK_UID@/$kiosk_uid/g" "$source">"$temporary"
  if [[ $profile == demo-staging ]];then
    sed -i -e 's/media-eduscope\.mount//g' -e 's/  */ /g' -e 's/ $//' -e '/^Requires=$/d' -e 's/EDUSCOPE_DEPLOYMENT_PROFILE=production/EDUSCOPE_DEPLOYMENT_PROFILE=demo-staging/' "$temporary"
  fi
  chmod 0644 "$temporary";mv -Tf "$temporary" "$target"
}

install_proxy_and_kiosk_configuration() {
  owned_install 0644 "$release/deploy/nginx/eduscope.conf" /etc/nginx/conf.d/eduscope.conf
  owned_install 0644 "$release/deploy/nginx/rtmp.conf.template" /etc/nginx/modules-enabled/90-eduscope-rtmp.conf
  owned_install 0644 "$release/deploy/stunnel/eduscope.conf.template" /etc/eduscope/stunnel/eduscope.conf.template
  owned_install 0755 "$release/deploy/relay/reload.py" /usr/libexec/eduscope-relay-reload
  owned_install 0755 "$release/deploy/relay/validate-stunnel.py" /usr/libexec/eduscope-stunnel-validate
  owned_install 0644 "$release/deploy/systemd/nginx.service.d/eduscope.conf" /etc/systemd/system/nginx.service.d/eduscope.conf

  local legacy_dropin=/etc/systemd/system/stunnel4.service.d/eduscope.conf
  if [[ -e $legacy_dropin ]]; then
    [[ $(sha256sum "$legacy_dropin" | cut -d' ' -f1) == 6a38c7dc05810f1c91aacb1c7c76db1ac1e96e10e7e9f3904850bdaa9008c27d ]] || {
      echo "refusing foreign admin file: $legacy_dropin" >&2
      return 1
    }
    rm -f "$legacy_dropin"
    rmdir "$(dirname "$legacy_dropin")" 2>/dev/null || true
  fi
  if [[ -L /etc/stunnel/eduscope.conf ]]; then
    [[ $(readlink /etc/stunnel/eduscope.conf) == /run/eduscope/relay/stunnel.conf ]] || {
      echo 'refusing foreign admin file: /etc/stunnel/eduscope.conf' >&2
      return 1
    }
    rm -f /etc/stunnel/eduscope.conf
  elif [[ -e /etc/stunnel/eduscope.conf ]]; then
    echo 'refusing foreign admin file: /etc/stunnel/eduscope.conf' >&2
    return 1
  fi

  install -d -m 0710 -o eduscope-core -g eduscope /run/eduscope/relay
  : > /run/eduscope/relay/nginx-push.conf
  install -o eduscope-core -g eduscope -m 0600 "$release/deploy/stunnel/eduscope.conf.template" /run/eduscope/relay/stunnel.conf
  sed -i 's/@SERVICE_SECTIONS@//' /run/eduscope/relay/stunnel.conf
  chown root:root /run/eduscope/relay/nginx-push.conf
  chmod 0600 /run/eduscope/relay/nginx-push.conf
  owned_install 0644 "$release/deploy/kiosk/eduscope.desktop" /usr/share/xsessions/eduscope.desktop
  owned_install 0644 "$release/deploy/kiosk/dconf/profile/user" /etc/dconf/profile/user
  owned_install 0644 "$release/deploy/kiosk/dconf/db/local.d/00-eduscope" /etc/dconf/db/local.d/00-eduscope
  owned_install 0644 "$release/deploy/kiosk/dconf/db/local.d/locks/eduscope" /etc/dconf/db/local.d/locks/eduscope
  owned_install 0644 "$release/deploy/kiosk/policies/managed/eduscope.json" /etc/chromium/policies/managed/eduscope.json
  install -D -m 0644 "$release/deploy/kiosk/gdm-custom.conf" /etc/gdm3/custom.conf
  dconf update
}

install_platform_configuration(){
  fail_stage configuration
  if [[ $EDUSCOPE_INSTALL_DRY_RUN == false ]]; then
    local kiosk_uid kiosk_tmpfiles_source
    kiosk_uid=$(id -u eduscope-kiosk)
    kiosk_tmpfiles_source="$rollback_dir/eduscope-kiosk.conf"
    printf 'd /run/user/%s 0700 eduscope-kiosk eduscope-kiosk -\n' "$kiosk_uid" >"$kiosk_tmpfiles_source"
    owned_install 0644 "$kiosk_tmpfiles_source" /etc/tmpfiles.d/eduscope-kiosk.conf
    systemd-tmpfiles --create /etc/tmpfiles.d/eduscope-kiosk.conf
  else
    action 'install kiosk runtime tmpfiles policy'
  fi
  if [[ $EDUSCOPE_INSTALL_DRY_RUN == false ]];then
    python3 "$release/deploy/runtime/render-hardware.py" --manifest "$manifest" --output-root / --profile "$EDUSCOPE_INSTALL_PROFILE"
  else action 'render stable udev and ALSA identities';fi
  for f in "$release"/deploy/systemd/*.service "$release"/deploy/systemd/*.socket;do
    if [[ $EDUSCOPE_INSTALL_DRY_RUN == true ]];then action "render unit $(basename "$f")";else render_unit "$f" "/etc/systemd/system/$(basename "$f")" "$EDUSCOPE_INSTALL_PROFILE" "$(id -u eduscope-kiosk)";fi
  done
  for u in eduscope-runtime-config eduscope-pipeline-manager eduscope-core-api;do
    if [[ $EDUSCOPE_INSTALL_DRY_RUN == true ]];then action "remove obsolete demo drop-in for $u";else rm -f "/etc/systemd/system/$u.service.d/demo-staging.conf";rmdir "/etc/systemd/system/$u.service.d" 2>/dev/null||true;fi
  done
  if [[ $EDUSCOPE_INSTALL_DRY_RUN == false ]]; then
    install_proxy_and_kiosk_configuration
    nginx -t
  else
    action 'install and validate proxy relay kiosk configuration'
  fi
}

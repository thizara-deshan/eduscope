#!/usr/bin/env bats
setup(){ R=$(cd "$BATS_TEST_DIRNAME/../.."&&pwd); }
@test "ten stages" { run python3 - "$R/deploy/install.sh" <<'PY'
import pathlib,sys
s=pathlib.Path(sys.argv[1]).read_text();n=['preflight','snapshot_owned_state','install_packages','install_identity_and_paths','install_application_artifacts','install_provisioning_and_secrets','install_platform_configuration','install_and_verify_units','start_and_smoke','mark_install_success'];p=[s.index(x) for x in n];assert p==sorted(p)
PY
[ "$status" -eq 0 ]; }
@test "all mount consumers get profile-rendered units" {
  for unit in eduscope-runtime-config eduscope-pipeline-manager eduscope-core-api;do
    out="$BATS_TEST_TMPDIR/$unit.service";run bash -c "source '$R/deploy/lib/configuration.sh'; render_unit '$R/deploy/systemd/$unit.service' '$out' demo-staging 1000";[ "$status" -eq 0 ];run grep -q media-eduscope.mount "$out";[ "$status" -eq 1 ]
  done
  grep -q 'eduscope-runtime-config.service eduscope-helper.socket' "$BATS_TEST_TMPDIR/eduscope-core-api.service"
  grep -q 'network-online.target eduscope-pipeline-manager.service' "$BATS_TEST_TMPDIR/eduscope-core-api.service"
}
@test "dry run ledger" { grep -q 'DRY RUN COMPLETE' "$R/deploy/lib/verify.sh"; }
@test "immutable release is traversable by service identities" {
  run grep -F 'install -d -m 0755 "$release_target"' "$R/deploy/lib/artifacts.sh"
  [ "$status" -eq 0 ]
  grep -Fq 'chmod -R a+rX,a-w "$release_target"' "$R/deploy/lib/artifacts.sh"
}
@test "release virtual environments are built rather than copied" {
  run grep -E 'cp -a .*\.venv' "$R/deploy/lib/artifacts.sh"
  [ "$status" -eq 1 ]
  run grep -F 'sha256sum' "$R/deploy/lib/artifacts.sh"
  [ "$status" -eq 0 ]
  run grep -F 'python3 -m venv' "$R/deploy/lib/artifacts.sh"
  [ "$status" -eq 0 ]
}
@test "native Node addons are rebuilt for the systemd Node runtime" {
  grep -q '/usr/bin/npm.*rebuild.*better-sqlite3' "$R/deploy/lib/artifacts.sh"
}
@test "source build outputs are restored to repository ownership" {
  grep -Fq 'chown -R --reference="$release"' "$R/deploy/lib/artifacts.sh"
  grep -Fq '"$release/apps/panel/dist"' "$R/deploy/lib/artifacts.sh"
}
@test "helper configuration follows the deployment profile" {
  run bash -c "source '$R/deploy/lib/configuration.sh'; manifest='$R/deploy/provisioning/device-manifest.example.json'; EDUSCOPE_INSTALL_PROFILE=demo-staging; render_helper_config '$BATS_TEST_TMPDIR/helper.json'; python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))[\"firmwareMode\"] == \"disabled\"' '$BATS_TEST_TMPDIR/helper.json'"
  [ "$status" -eq 0 ]
}
@test "bootstrap password is readable only by core" {
  grep -Fq 'owned_install_as 0640 root eduscope-core' "$R/deploy/lib/configuration.sh"
}
@test "device manifest is readable by kiosk and demo unit carries its profile" {
  grep -Fq 'owned_install_as 0640 root eduscope-kiosk "$manifest"' "$R/deploy/lib/configuration.sh"
  out="$BATS_TEST_TMPDIR/eduscope-kiosk.service"
  run bash -c "source '$R/deploy/lib/configuration.sh'; render_unit '$R/deploy/systemd/eduscope-kiosk.service' '$out' demo-staging 976"
  [ "$status" -eq 0 ]
  grep -Fq 'Environment=EDUSCOPE_DEPLOYMENT_PROFILE=demo-staging' "$out"
}
@test "kiosk runtime directory is recreated by tmpfiles" {
  grep -Fq '/etc/tmpfiles.d/eduscope-kiosk.conf' "$R/deploy/lib/configuration.sh"
  grep -Fq 'systemd-tmpfiles --create /etc/tmpfiles.d/eduscope-kiosk.conf' "$R/deploy/lib/configuration.sh"
}
@test "live smoke activates GDM and waits for kiosk Xauthority" {
  grep -Fq 'systemctl restart gdm3.service' "$R/deploy/lib/verify.sh"
  grep -Fq '/run/user/$(id -u eduscope-kiosk)/gdm/Xauthority' "$R/deploy/lib/verify.sh"
  grep -Fq 'runuser -u eduscope-kiosk' "$R/deploy/lib/verify.sh"
  grep -Fq 'xdpyinfo -display :0' "$R/deploy/lib/verify.sh"
  grep -Fq 'sleep 10' "$R/deploy/lib/verify.sh"
}

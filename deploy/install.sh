#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'; umask 077
deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; readonly deploy_dir
for library in common preflight packages identity artifacts configuration services verify rollback; do
  # shellcheck source=/dev/null
  source "$deploy_dir/lib/$library.sh"
done
usage(){ printf 'usage: %s --profile production|demo-staging --manifest ABS --secrets ABS --release ABS [--acknowledge-open-firmware-acceptance] [--dry-run]\n' "$0" >&2; exit 64; }
((EUID==0))||{ echo 'install must run as root' >&2;exit 77; }
profile='' manifest='' secrets='' release='' acknowledge_open_firmware=false dry_run=false
while (($#));do case $1 in --profile|--manifest|--secrets|--release) (($#>=2))||usage; key=${1#--};printf -v "$key" %s "$2";shift 2;;--acknowledge-open-firmware-acceptance)acknowledge_open_firmware=true;shift;;--dry-run)dry_run=true;shift;;*)usage;;esac;done
[[ $profile == production || $profile == demo-staging ]]||usage;[[ -n $manifest && -n $secrets && -n $release ]]||usage
[[ $profile != demo-staging || $acknowledge_open_firmware == true ]]||{ echo 'demo-staging requires --acknowledge-open-firmware-acceptance' >&2;exit 78; }
export EDUSCOPE_INSTALL_PROFILE=$profile EDUSCOPE_INSTALL_DRY_RUN=$dry_run
current_stage=preflight;preflight "$manifest" "$secrets" "$release"
on_error(){ readonly exit_status=$?;trap - ERR;rollback_install "$current_stage" "$exit_status";exit "$exit_status";};trap on_error ERR
current_stage=snapshot;snapshot_owned_state
current_stage=packages;install_packages
current_stage=identity;install_identity_and_paths
current_stage=artifacts;install_application_artifacts
current_stage=configuration;install_provisioning_and_secrets;install_platform_configuration
current_stage=services;install_and_verify_units
current_stage=smoke;start_and_smoke
current_stage=success;mark_install_success
trap - ERR

#!/usr/bin/env bash
# shellcheck disable=SC2154
install_packages(){ fail_stage packages;mapfile -t p < <(sed '/^\(#\|[[:space:]]*$\)/d' "$release/deploy/packages.ubuntu-24.04-aarch64.lock");run apt-get install -y --no-install-recommends "${p[@]}"; }

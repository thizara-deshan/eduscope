#!/usr/bin/env bash
# shellcheck disable=SC2154
install_identity_and_paths(){ fail_stage identity;owned_install 0644 "$release/deploy/sysusers/eduscope.conf" /etc/sysusers.d/eduscope.conf;owned_install 0644 "$release/deploy/tmpfiles/eduscope.conf" /etc/tmpfiles.d/eduscope.conf;run systemd-sysusers /etc/sysusers.d/eduscope.conf;run systemd-tmpfiles --create /etc/tmpfiles.d/eduscope.conf; }

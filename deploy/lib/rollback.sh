#!/usr/bin/env bash
# shellcheck disable=SC2154
snapshot_owned_state(){ fail_stage snapshot;[[ $EDUSCOPE_INSTALL_DRY_RUN == false ]]||{ action 'snapshot owned state';return;};install -d -m 0700 "$rollback_dir";[[ ! -L /opt/eduscope/current ]]||readlink /opt/eduscope/current>"$rollback_dir/previous-current"; }
rollback_install(){ local failed_stage=$1 code=$2;[[ ${rollback_done:-false} != true ]]||return "$code";rollback_done=true;[[ ! -f ${rollback_dir:-}/previous-current ]]||ln -sfn "$(<"$rollback_dir/previous-current")" /opt/eduscope/current;systemctl daemon-reload||true;printf 'ROLLBACK COMPLETE stage=%s evidence=%s\n' "$failed_stage" "${rollback_dir:-unavailable}";return "$code"; }

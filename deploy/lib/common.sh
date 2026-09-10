#!/usr/bin/env bash
action(){ printf 'ACTION %s\n' "$*"; }
run(){ if [[ $EDUSCOPE_INSTALL_DRY_RUN == false ]];then "$@";else action "$*";fi; }
absolute_file(){ [[ $1 == /* && -f $1 && ! -L $1 ]]||{ echo "invalid absolute regular input: $1" >&2;return 1;}; }
owned_install(){ local m=$1 s=$2 t=$3;[[ ! -e $t || -f $t ]]||{ echo "refusing foreign admin file: $t" >&2;return 1;};run install -D -m "$m" "$s" "$t"; }
owned_install_as(){ local m=$1 o=$2 g=$3 s=$4 t=$5;[[ ! -e $t || -f $t ]]||{ echo "refusing foreign admin file: $t" >&2;return 1;};run install -D -o "$o" -g "$g" -m "$m" "$s" "$t"; }
fail_stage(){ [[ ${EDUSCOPE_INSTALL_FAIL_STAGE:-} != "$1" ]]||return 97; }

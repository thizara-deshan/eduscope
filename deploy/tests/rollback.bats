#!/usr/bin/env bats
setup(){ R=$(cd "$BATS_TEST_DIRNAME/../.."&&pwd); }
@test "rollback once" { grep -q 'trap - ERR;rollback_install' "$R/deploy/install.sh";grep -q 'rollback_done=true' "$R/deploy/lib/rollback.sh"; }
@test "restore current" { grep -q previous-current "$R/deploy/lib/rollback.sh"; }

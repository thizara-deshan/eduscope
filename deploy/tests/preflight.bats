#!/usr/bin/env bats
setup(){ R=$(cd "$BATS_TEST_DIRNAME/../.."&&pwd); }
@test "root only" { run "$R/deploy/install.sh" --profile production --manifest /x --secrets /y --release /z;[ "$status" -eq 77 ]; }
@test "demo acknowledgement" { run sudo -n "$R/deploy/install.sh" --profile demo-staging --manifest /x --secrets /y --release /z;[ "$status" -eq 78 ]; }
@test "production A/B gate" { grep -q 'production requires accepted updater and A/B layout' "$R/deploy/lib/preflight.sh"; }
@test "root runtime versions are gated before mutation" { grep -q 'requires Node >=22.13' "$R/deploy/lib/preflight.sh";grep -q 'requires pnpm 9.12.3' "$R/deploy/lib/preflight.sh"; }
@test "required local model is gated before mutation" { grep -q 'requires Vosk model artifact' "$R/deploy/lib/preflight.sh"; }

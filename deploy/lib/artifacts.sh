#!/usr/bin/env bash
# shellcheck disable=SC2154

freeze_runtime_requirements() {
  local python=$1 output=$2
  "$python" -m pip freeze --local |
    sed -E '/^-e /d;/^(iniconfig|pluggy|Pygments|pytest|pytest-asyncio|PyGObject|pycairo|zxing-cpp)==/d' >"$output"
}

build_hashed_venv() {
  local source_python=$1 target=$2 name=$3
  shift 3
  local bundle="$release_target/python/$name" requirements="$release_target/python/$name/requirements.lock"
  install -d -m 0755 "$bundle/wheels"
  freeze_runtime_requirements "$source_python" "$requirements"
  "$source_python" -m pip wheel --disable-pip-version-check --wheel-dir "$bundle/wheels" --requirement "$requirements"
  local project
  for project in "$@"; do
    "$source_python" -m pip wheel --disable-pip-version-check --no-deps --wheel-dir "$bundle/wheels" "$project"
  done
  (cd "$bundle/wheels" && sha256sum ./*.whl >SHA256SUMS && sha256sum --check SHA256SUMS)
  python3 -m venv "$target"
  "$target/bin/pip" install --disable-pip-version-check --no-index --find-links "$bundle/wheels" --requirement "$requirements"
  "$target/bin/pip" install --disable-pip-version-check --no-index --no-deps "$bundle"/wheels/eduscope_*.whl
}

install_application_artifacts() {
  fail_stage artifacts
  release_target="/opt/eduscope/releases/$release_id"
  [[ ! -d $release_target ]] || { action 'NO CHANGE artifacts'; return; }
  [[ $EDUSCOPE_INSTALL_DRY_RUN == false ]] || { action "install release $release_id"; return; }

  pnpm --dir "$release" --filter @eduscope/shared build
  pnpm --dir "$release" --filter @eduscope/core-api build
  pnpm --dir "$release" --filter @eduscope/panel build
  pnpm --dir "$release" --filter @eduscope/quiz-service build
  pnpm --dir "$release" --filter @eduscope/quiz build
  local generated
  for generated in \
    "$release/packages/shared/dist" "$release/services/core-api/dist" \
    "$release/apps/panel/dist" "$release/services/quiz-service/dist" \
    "$release/apps/quiz/.next"; do
    chown -R --reference="$release" "$generated"
  done

  install -d -m 0755 "$release_target"
  cp -a "$release/deploy" "$release/packages" "$release/apps" "$release/node_modules" "$release_target/"
  rsync -a --exclude=.venv/ --exclude=dist/ "$release/services/" "$release_target/services/"
  cp -a "$release/services/core-api/dist" "$release_target/services/core-api/dist"
  cp -a "$release/services/quiz-service/dist" "$release_target/services/quiz-service/dist"
  /usr/bin/npm rebuild better-sqlite3 --prefix "$release_target/services/core-api"

  install -d -m 0755 "$release_target/venvs" "$release_target/python"
  build_hashed_venv "$release/services/pipeline-manager/.venv/bin/python" "$release_target/venvs/pipeline" pipeline \
    "$release_target/services/pipeline-manager"
  build_hashed_venv "$release/services/ai/.venv/bin/python" "$release_target/venvs/ai" ai \
    "$release_target/services/ai/common" "$release_target/services/ai/stt-service" \
    "$release_target/services/ai/slide-service" "$release_target/services/ai/question-service"

  install -d -m 0755 "$release_target/python/helper"
  python3 -m venv "$release_target/venvs/helper"
  "$release/services/pipeline-manager/.venv/bin/python" -m pip wheel --disable-pip-version-check --no-deps \
    --wheel-dir "$release_target/python/helper" "$release_target/services/privileged-helper"
  (cd "$release_target/python/helper" && sha256sum ./*.whl >SHA256SUMS && sha256sum --check SHA256SUMS)
  "$release_target/venvs/helper/bin/pip" install --disable-pip-version-check --no-index --no-deps \
    "$release_target"/python/helper/eduscope_privileged_helper-*.whl

  chmod -R a+rX,a-w "$release_target"
}

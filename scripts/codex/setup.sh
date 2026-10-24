#!/usr/bin/env bash
# Run --fresh only during initial Cloud setup. --reuse never installs packages.
set -eo pipefail
unset BASH_ENV
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$repo_dir"
if [ "$#" -ne 1 ] || { [ "$1" != '--fresh' ] && [ "$1" != '--reuse' ]; }; then
  echo 'Usage: bash scripts/codex/setup.sh --fresh|--reuse' >&2; exit 2
fi
mode="$1"
if [ "$mode" = '--fresh' ] && [ "$(id -u)" -ne 0 ]; then
  echo 'Fresh OS provisioning requires the initial root setup phase; no sudo/password fallback.' >&2; exit 2
fi
wanted_node="$(tr -d '[:space:]' < .node-version)"
if ! command -v node >/dev/null || [ "$(node -p process.versions.node)" != "$wanted_node" ]; then
  if [ "$mode" != '--fresh' ]; then echo 'Pinned Node is not ready.' >&2; exit 2; fi
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ ! -s "$nvm_script" ]; then echo 'Cloud nvm is unavailable.' >&2; exit 2; fi
  source "$nvm_script"
  nvm install "$wanted_node"
  nvm alias default "$wanted_node"
  nvm use "$wanted_node"
fi
set -u
node -e 'const fs=require("node:fs");if(process.versions.node!==fs.readFileSync(".node-version","utf8").trim())throw Error("Node version mismatch")'
evidence="$(mktemp -d "${TMPDIR:-/tmp}/ais-codex-setup.XXXXXX")"
trap 'overall_result=$?; printf "%s\n" "$overall_result" > "$evidence/setup.exit-code"' EXIT
date -u +%FT%TZ > "$evidence/started-at-utc"
git rev-parse HEAD > "$evidence/checkout-sha"
id -u > "$evidence/setup-uid"
printf '%s\n' "$mode" > "$evidence/mode"
run_step() {
  local name="$1" result; shift
  if "$@" > "$evidence/$name.log" 2>&1; then result=0; else result=$?; fi
  printf '%s\n' "$result" > "$evidence/$name.exit-code"
  printf 'Setup %s exit=%s evidence=%s\n' "$name" "$result" "$evidence"
  return "$result"
}
if [ "$mode" = '--fresh' ]; then
  npm_cache="$(mktemp -d "${TMPDIR:-/tmp}/ais-codex-npm.XXXXXX")"
  export npm_config_cache="$npm_cache"
  run_step npm-ci npm ci --no-audit --no-fund
  run_step os-deps ./node_modules/.bin/playwright install-deps chromium firefox
  run_step electron env ELECTRON_GET_USE_PROXY=1 node node_modules/electron/install.js
else
  printf '%s\n' 'not-run: existing dependencies reused' > "$evidence/install-status"
fi
run_step ldd ldd node_modules/electron/dist/electron
if grep -q 'not found' "$evidence/ldd.log"; then echo 'Electron runtime libraries are missing.' >&2; exit 1; fi
run_step check npm run check
run_step build npm run build
run_step smoke bash scripts/codex/smoke.sh
git diff --exit-code -- package.json package-lock.json .node-version

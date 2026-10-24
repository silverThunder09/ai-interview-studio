#!/usr/bin/env bash
# Source smoke only. Root launchers delegate to the existing UID 1000 account.
set -euo pipefail
unset BASH_ENV # This explicit check replaces the old implicit startup hook.
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$repo_dir"
if [ "$#" -ne 0 ] || [ -n "${SMOKE_EXECUTABLE:-}" ]; then
  echo 'Source smoke accepts no arguments or executable override.' >&2; exit 2
fi
node_bin="$(command -v node)"
node_bin="$(readlink -f -- "$node_bin")"
"$node_bin" -e 'const fs=require("node:fs");if(process.versions.node!==fs.readFileSync(".node-version","utf8").trim())throw Error("Node version mismatch")'
if [ ! -f out/main/index.js ] || [ ! -f node_modules/@playwright/test/cli.js ]; then
  echo 'Build and locked dependencies must be ready before smoke.' >&2; exit 2
fi
evidence="$(mktemp -d "${TMPDIR:-/tmp}/ais-codex-smoke-evidence.XXXXXX")"
trap 'smoke_result=$?; printf "%s\n" "$smoke_result" > "$evidence/exit-code"' EXIT
git rev-parse HEAD > "$evidence/source-checkout-sha"
id -u > "$evidence/launcher-uid"
specs=(tests/smoke/gemini.spec.ts tests/smoke/avatar.spec.ts tests/smoke/desktop.spec.ts)
runtime=("$node_bin" "$repo_dir/node_modules/@playwright/test/cli.js" test "${specs[@]}")
if [ "$(id -u)" -eq 0 ]; then
  runtime_user="$(getent passwd 1000 | cut -d: -f1 || true)"
  if [ -z "$runtime_user" ] || [ "$(id -u "$runtime_user")" -ne 1000 ]; then
    echo 'Existing UID 1000 account unavailable; Electron root execution is blocked.' >&2; exit 2
  fi
  command -v runuser >/dev/null
  # Only a newly created temporary workspace is writable by the runtime user.
  work_dir="$(runuser -u "$runtime_user" -- mktemp -d "${TMPDIR:-/tmp}/ais-codex-smoke.XXXXXX")"
  runuser -u "$runtime_user" -- mkdir "$work_dir/.runtime"
  install -m 755 -- "$node_bin" "$work_dir/.runtime/node"
  git ls-files -z > "$evidence/tracked-files"
  # Preserve working edits; exclude .git and untracked files rather than cloning HEAD.
  tar -C "$repo_dir" --no-recursion --null -T "$evidence/tracked-files" -cf - | runuser -u "$runtime_user" -- tar -C "$work_dir" -xf -
  tar -C "$repo_dir" -cf - out | runuser -u "$runtime_user" -- tar -C "$work_dir" -xf -
  runuser -u "$runtime_user" -- ln -s "$repo_dir/node_modules" "$work_dir/node_modules"
  runuser -u "$runtime_user" -- test -r "$repo_dir/node_modules/@playwright/test/cli.js"
  runuser -u "$runtime_user" -- id -u > "$evidence/runtime-uid"
  printf '%s\n' "$work_dir" > "$evidence/workspace"
  runtime=(runuser -u "$runtime_user" -- "$work_dir/.runtime/node" "$repo_dir/node_modules/@playwright/test/cli.js" test "${specs[@]}")
  cd "$work_dir"
else
  id -u > "$evidence/runtime-uid"
fi
if [ "$(cat "$evidence/runtime-uid")" -eq 0 ]; then
  echo 'Refusing Electron smoke as root.' >&2; exit 2
fi
if STUDIO_SMOKE_HEADLESS=1 "${runtime[@]}" > "$evidence/smoke.log" 2>&1; then result=0; else result=$?; fi
printf '%s\n' "$result" > "$evidence/exit-code"
printf 'Smoke UID=%s exit=%s evidence=%s\n' "$(cat "$evidence/runtime-uid")" "$result" "$evidence"
exit "$result"

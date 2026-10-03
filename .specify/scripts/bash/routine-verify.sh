#!/usr/bin/env bash
# Run the repo checks that work without platform-native binaries and report
# the rest as skipped, never as failures. node_modules here were installed on
# macOS, so on the Linux VM anything napi/esbuild-shaped is absent: Biome, the
# regex-engine .node, @swc/core (server tests), Vite's rolldown + lightningcss
# (every vitest run), @next/swc (next typegen), sharp (astro). tsc is pure JS.
# Turbo is a native binary too, so workspaces are driven with `npm run -w`.
#
# Usage: routine-verify.sh [workspace-root]   (default: git toplevel of cwd)
# Exit 1 only when a check that actually ran failed. Last stdout line is JSON:
#   {root,node,platform,passed,failed,skipped,checks:[{name,status,note}]}

set -uo pipefail

ROOT_ARG="${1:-}"
[[ -n "$ROOT_ARG" ]] || ROOT_ARG="$(git rev-parse --show-toplevel)" || exit 1
ROOT="$(cd -- "$ROOT_ARG" && pwd -P)"
cd "$ROOT"

SCRIPT_DIR="$(CDPATH="" cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

export NO_COLOR=1
NODE_VERSION="$(node --version)"
PLATFORM="$(node -p 'process.platform + "-" + process.arch')"
echo "node $NODE_VERSION on $PLATFORM in $ROOT"

# loads <specifier>: 0 when the module imports on this platform (resolution
# starts at $ROOT/node_modules).
loads() { node --input-type=module -e "await import('$1')" >/dev/null 2>&1; }
# has_pkg <glob>: 0 when a package matching the glob is installed.
has_pkg() { compgen -G "node_modules/$1" >/dev/null; }

VITE_OK=false; loads rolldown && loads lightningcss && VITE_OK=true
SWC_OK=false; loads @swc/core && SWC_OK=true
# Only a gate when the checkout has the lib at all (older bases predate it).
REGEX_OK=false; { [[ ! -d libs/regex-engine ]] || loads ./libs/regex-engine/index.js; } && REGEX_OK=true
SHARP_OK=false; loads sharp && SHARP_OK=true
BIOME_OK=false; has_pkg "@biomejs/cli-${PLATFORM}*" && BIOME_OK=true
NEXT_SWC_OK=false; has_pkg "@next/swc-${PLATFORM}*" && NEXT_SWC_OK=true
VITE_REASON="vitest needs Vite's native rolldown+lightningcss bindings for $PLATFORM (not in node_modules)"

CHECKS=()
PASSED=0; FAILED=0; SKIPPED=0
LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT

# run_check <name> <note> <cmd...>
run_check() {
    local name="$1" note="$2"; shift 2
    local log="$LOG_DIR/${name//[^A-Za-z0-9]/_}.log"
    echo "==> $name: $*"
    "$@" >"$log" 2>&1
    local rc=$?
    if (( rc == 0 )); then
        echo "    PASS${note:+ ($note)}"
        PASSED=$((PASSED + 1)); CHECKS+=("$name|pass|$note")
    else
        echo "    FAIL exit $rc${note:+ ($note)}"
        tail -n 40 "$log" | sed 's/^/    /'
        FAILED=$((FAILED + 1)); CHECKS+=("$name|fail|exit $rc${note:+; $note}")
    fi
}
skip_check() {
    echo "==> $1: SKIP ($2)"
    SKIPPED=$((SKIPPED + 1)); CHECKS+=("$1|skip|$2")
}

# libs are consumed through dist/ (package main/types), so build them before
# anything imports them. regex-engine is cargo-built and cannot be rebuilt here.
for ws in libs/types libs/utils libs/contracts; do
    run_check "build:$ws" "" npm run build -w "$ws"
done
skip_check "build:libs/regex-engine" "napi build needs cargo; using the checked-in index.d.ts/index.js"

for ws in libs/types libs/utils libs/contracts apps/scanner apps/server; do
    run_check "typecheck:$ws" "" npm run typecheck -w "$ws"
done
if $NEXT_SWC_OK; then
    run_check "typecheck:apps/client" "" npm run typecheck -w apps/client
else
    # `next typegen` downloads its swc binding when missing; run bare tsc instead.
    run_check "typecheck:apps/client" "tsc only; next typegen skipped (@next/swc for $PLATFORM missing)" node_modules/.bin/tsc --noEmit -p apps/client
fi
if $VITE_OK && $SHARP_OK; then
    run_check "typecheck:apps/docs" "" npm run typecheck -w apps/docs
else
    skip_check "typecheck:apps/docs" "astro check needs Vite native bindings and sharp for $PLATFORM"
fi

for ws in libs/utils libs/contracts apps/client; do
    if $VITE_OK; then run_check "test:$ws" "" npm run test -w "$ws"; else skip_check "test:$ws" "$VITE_REASON"; fi
done
if ! $VITE_OK; then skip_check "test:apps/scanner" "$VITE_REASON"
elif ! $REGEX_OK; then skip_check "test:apps/scanner" "needs the napi regex-engine binary for $PLATFORM (cargo build)"
else run_check "test:apps/scanner" "" npm run test -w apps/scanner; fi
if ! $VITE_OK; then skip_check "test:apps/server" "$VITE_REASON"
elif ! $SWC_OK; then skip_check "test:apps/server" "needs @swc/core native binding for $PLATFORM"
else run_check "test:apps/server" "" npm run test -w apps/server; fi
skip_check "test:e2e" "boots built apps; not runnable here"

if $BIOME_OK; then run_check "lint" "" npm run lint; else skip_check "lint" "Biome CLI binary for $PLATFORM not installed"; fi

echo "passed=$PASSED failed=$FAILED skipped=$SKIPPED"
checks_json=""
for entry in "${CHECKS[@]}"; do
    IFS='|' read -r name status note <<< "$entry"
    checks_json+="${checks_json:+,}{\"name\":\"$(json_escape "$name")\",\"status\":\"$status\",\"note\":\"$(json_escape "$note")\"}"
done
printf '{"root":"%s","node":"%s","platform":"%s","passed":%d,"failed":%d,"skipped":%d,"checks":[%s]}\n' \
    "$(json_escape "$ROOT")" "$NODE_VERSION" "$PLATFORM" "$PASSED" "$FAILED" "$SKIPPED" "$checks_json"

(( FAILED == 0 ))

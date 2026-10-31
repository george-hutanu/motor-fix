#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Claude Code Stop hook — the agent may not declare itself done while the
# quality gate is red. Closes the spec-kit failure mode of tasks "marked done
# with only // TODO comments" (spec-kit Discussion #1619).
#
# Ported from speckit-demo (`npm test && npm run lint` on every stop). Running
# the whole Jest suite plus a workspace typecheck at every stop is too slow in
# this monorepo, so the gate is scoped to what actually changed:
#   - `vitest run --changed` on each Angular project (apps/web, libs/ui-cockpit,
#     libs/overlays, libs/i18n, libs/media) with a change, against its own
#     config, and `jest --onlyChanged` when anything else changed — the tests
#     related to uncommitted changes
#   - `biome check` on the changed TS files
# Each half is skipped while its tool is not installed yet (before the Nx
# scaffold lands).
# The full typecheck + lint + test triple runs in lifecycle.mjs check before a push, so
# nothing lands unverified; this hook exists to catch "done" claims earlier.
#
# Loop protection: stop_hook_active means we already blocked once this turn —
# never block twice in a row (Claude Code's own contract).
# ---------------------------------------------------------------------------
set -uo pipefail

# The Vitest config of a path under one of the Angular projects, or nothing for
# a project on Jest (the same table as post-edit-check.sh).
vitest_config() {
  case "$1" in
    apps/web/src/server/*|apps/web/src/app/app.config.spec.ts) echo apps/web/vitest-node.config.ts ;;
    apps/web/*) echo apps/web/vitest.config.ts ;;
    libs/ui-cockpit/*|libs/overlays/*|libs/i18n/*|libs/media/*)
      lib="${1#libs/}"
      echo "libs/${lib%%/*}/vitest.config.ts"
      ;;
  esac
}

payload="$(cat)"
case "$payload" in
  *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;;
esac

repo="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$repo" || exit 0

# Changed TypeScript under the workspaces (staged or not). Nothing → nothing to
# gate. Kept to a newline-delimited string and piped through xargs rather than
# a bash array: macOS ships bash 3.2, which has no `mapfile`.
changed="$(git status --porcelain --untracked-files=all -- apps libs e2e 2>/dev/null \
  | awk '{print $NF}' | grep -E '\.(ts|tsx|mts|cts)$' || true)"
[ -n "$changed" ] || exit 0

if [ -x node_modules/.bin/biome ] && ! printf '%s\n' "$changed" | xargs npx --no-install biome check >&2 2>&1; then
  echo "❌ Stop gate: biome check is red on changed files. Fix them (or revert the breaking edit) before finishing." >&2
  exit 2
fi

# The test runners share the machine with other sessions: each run takes a
# heavy-command slot (scripts/heavy.sh) with two workers and waits at most
# 300 s for one. No slot in time skips the check with a message rather than
# trapping the session.
heavy=""
[ -f scripts/heavy.sh ] && heavy="sh scripts/heavy.sh"
skipped() {
  echo "{\"systemMessage\":\"Stop gate: $1 was skipped, every shared heavy-command slot stayed busy for 300 s. Run it before claiming the work is green.\"}"
}

configs="$(printf '%s\n' "$changed" | while read -r f; do vitest_config "$f"; done | sort -u)"
others="$(printf '%s\n' "$changed" | while read -r f; do [ -n "$(vitest_config "$f")" ] || echo "$f"; done)"

if [ -n "$configs" ] && [ -x node_modules/.bin/vitest ]; then
  for config in $configs; do
    HEAVY_WAIT="${HEAVY_WAIT:-300}" $heavy npx --no-install vitest run --config "$config" --changed --passWithNoTests --maxWorkers=2 >&2 2>&1
    code=$?
    if [ "$code" -eq 124 ] && [ -n "$heavy" ]; then
      skipped "vitest run --config $config --changed"
      exit 0
    fi
    if [ "$code" -ne 0 ]; then
      echo "❌ Stop gate: \`vitest run --config $config --changed\` is red with uncommitted changes. Fix the failures (or revert the breaking edit) before finishing." >&2
      exit 2
    fi
  done
fi

[ -n "$others" ] || exit 0
[ -x node_modules/.bin/jest ] || exit 0
HEAVY_WAIT="${HEAVY_WAIT:-300}" $heavy npx --no-install jest --onlyChanged --passWithNoTests --maxWorkers=2 >&2 2>&1
code=$?
if [ "$code" -eq 124 ] && [ -n "$heavy" ]; then
  skipped "jest --onlyChanged"
  exit 0
fi
if [ "$code" -ne 0 ]; then
  echo "❌ Stop gate: \`jest --onlyChanged\` is red with uncommitted changes. Fix the failures (or revert the breaking edit) before finishing." >&2
  exit 2
fi
exit 0

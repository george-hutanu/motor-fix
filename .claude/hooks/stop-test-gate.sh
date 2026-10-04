#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Claude Code Stop hook — the agent may not declare itself done while the
# quality gate is red. Closes the spec-kit failure mode of tasks "marked done
# with only // TODO comments" (spec-kit Discussion #1619).
#
# Ported from speckit-demo (`npm test && npm run lint` on every stop). Running
# the whole Jest suite plus a workspace typecheck at every stop is too slow in
# this monorepo, so the gate is scoped to what actually changed:
#   - `jest --onlyChanged` — the tests related to uncommitted changes
#   - `biome check` on the changed TS files
# Each half is skipped while its tool is not installed yet (before the Nx
# scaffold lands).
# The full typecheck + lint + test triple still runs in .husky/pre-commit, so
# nothing lands unverified; this hook exists to catch "done" claims earlier.
#
# Loop protection: stop_hook_active means we already blocked once this turn —
# never block twice in a row (Claude Code's own contract).
# ---------------------------------------------------------------------------
set -uo pipefail

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

[ -x node_modules/.bin/jest ] || exit 0
# Jest shares the machine with other sessions: it takes a heavy-command slot
# (scripts/heavy.sh) with two workers and waits at most 300 s for one. No slot
# in time skips the check with a message rather than trapping the session.
heavy=""
[ -f scripts/heavy.sh ] && heavy="sh scripts/heavy.sh"
HEAVY_WAIT="${HEAVY_WAIT:-300}" $heavy npx --no-install jest --onlyChanged --passWithNoTests --maxWorkers=2 >&2 2>&1
code=$?
if [ "$code" -eq 124 ] && [ -n "$heavy" ]; then
  echo '{"systemMessage":"Stop gate: jest --onlyChanged was skipped, every shared heavy-command slot stayed busy for 300 s. Run it before claiming the work is green."}'
  exit 0
fi
if [ "$code" -ne 0 ]; then
  echo "❌ Stop gate: \`jest --onlyChanged\` is red with uncommitted changes. Fix the failures (or revert the breaking edit) before finishing." >&2
  exit 2
fi
exit 0

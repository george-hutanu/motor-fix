#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Claude Code PreToolUse hook (matcher: Bash) — the commit gate for agent
# sessions. Wired in .claude/settings.json; the harness pipes a JSON event on
# stdin describing the Bash command about to run. Acts only on `git commit`.
#
# Division of labour with .husky/pre-commit — the reason this does NOT run the
# test suite: husky already runs `npm run typecheck && npm run lint && npm run
# test` on every real commit, for every contributor. Duplicating that here
# would double the slowest part of the loop (turbo typecheck + full vitest) on
# a monorepo. What husky CANNOT do is judge spec-kit state, because specs/,
# .specify/ and .claude/ are git-excluded and invisible to a shared hook. So
# this layer runs exactly the checks husky cannot:
#   commit-msg-policy  — one-line Conventional Commit, no metadata trailers
#   trace-matrix       — implemented features need a tagged test per FR
#   spec-drift         — behavior commits must move the active feature's spec
# Exit 2 blocks the call and feeds stderr back to the model.
# ---------------------------------------------------------------------------
set -euo pipefail

payload="$(cat)"

case "$payload" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

repo="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# --- Commit-message policy -------------------------------------------------
# On success it prints the validated message, which the drift gate needs (the
# conventional-commit type decides whether drift applies).
if ! commit_msg="$(node "$repo/.claude/hooks/commit-msg-policy.js" <<<"$payload")"; then
  echo "❌ Commit blocked by message policy: one-line Conventional Commit, no metadata, no tool mentions." >&2
  exit 2
fi

echo "▶ spec-kit gates: spec-drift (tests+lint+typecheck run in .husky/pre-commit)" >&2

# The traceability gate is retired: the `// @traces NNN-FR-XXX` markers it
# matched were removed from the test suite deliberately, so the check could
# only ever fail. `node .claude/scripts/trace-matrix.mjs` still reports the
# FR -> test matrix on demand; it just no longer blocks a commit.

if ! node "$repo/.claude/scripts/spec-drift.mjs" --staged "$commit_msg" >&2; then
  echo "❌ Commit blocked: spec drift — behavior change without a spec update alongside it." >&2
  exit 2
fi

exit 0

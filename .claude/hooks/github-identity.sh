#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Claude Code SessionStart hook — pin this session's GitHub identity to
# george-hutanu. gh's active account on this machine is the work one and must
# stay that way for ~/code, so nothing global is switched; instead:
#   - GH_TOKEN is exported through CLAUDE_ENV_FILE, resolved per command from
#     gh's keyring by account name. No token is written to disk, and a login
#     made mid-session takes effect. An unresolvable token becomes a sentinel
#     that fails loudly: gh reads an empty GH_TOKEN as unset and would fall
#     back to the active (work) account.
#   - git drift (author, committer, credential pinning) and a missing gh login
#     are reported into context. Advisory: .husky/pre-commit is the gate.
#   - a checkout with no clone of the private motor-fix-specs at
#     .motor-fix-specs, or no specs link into it (an old clone at specs/),
#     gets one (.claude/scripts/specs-repo.mjs ensure --soft, which never
#     fails); one that already has both is left alone, so no network here.
# In a Claude Code cloud session (CLAUDE_CODE_REMOTE=true) a proxy injects the
# GitHub credentials and GH_TOKEN holds its placeholder: neither the export nor
# the gh login check applies, and identity.sh check skips credential pinning.
# ---------------------------------------------------------------------------
set -uo pipefail
cat >/dev/null

account=george-hutanu
repo="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$repo" || exit 0
gh_bin="$(command -v gh || echo "$HOME/.local/bin/gh")"

cloud=false
[ "${CLAUDE_CODE_REMOTE:-}" = true ] && cloud=true

if [ "$cloud" = false ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  printf 'export GH_TOKEN="$(%s auth token --hostname github.com --user %s 2>/dev/null || echo %s-is-not-logged-in-to-gh)"\n' \
    "$gh_bin" "$account" "$account" >> "$CLAUDE_ENV_FILE"
fi

echo "GitHub identity for this repo: george-hutanu <hutanugeorge40@gmail.com>, account $account — never the work account. gh here runs as $account via GH_TOKEN; never run \`gh auth switch\`."

if ! drift="$(sh .husky/identity.sh check 2>&1)"; then
  echo "$drift"
fi
if [ "$cloud" = false ] && ! "$gh_bin" auth token --hostname github.com --user "$account" >/dev/null 2>&1; then
  echo "gh has no login for $account: gh commands and pushes here will fail until the user runs \`gh auth login --hostname github.com\` as $account, then \`gh auth switch --hostname github.com --user <work account>\` so ~/code keeps the work account. Do not push or call gh until then."
fi
if { [ ! -e .motor-fix-specs/.git ] || [ ! -L specs ]; } && [ -f .claude/scripts/specs-repo.mjs ]; then
  echo "specs (the private motor-fix-specs clone at .motor-fix-specs): $(node .claude/scripts/specs-repo.mjs ensure --soft 2>&1 | tail -n 1)"
fi
exit 0

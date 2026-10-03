#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Claude Code SessionStart hook — pin this session's GitHub identity to
# george-hutanu. gh's active account on this machine is the QLOG one and must
# stay that way for ~/code, so nothing global is switched; instead:
#   - GH_TOKEN is exported through CLAUDE_ENV_FILE, resolved per command from
#     gh's keyring by account name. No token is written to disk, and a login
#     made mid-session takes effect. An unresolvable token becomes a sentinel
#     that fails loudly: gh reads an empty GH_TOKEN as unset and would fall
#     back to the active (QLOG) account.
#   - git drift (author, committer, credential pinning) and a missing gh login
#     are reported into context. Advisory: .husky/pre-commit is the gate.
# ---------------------------------------------------------------------------
set -uo pipefail
cat >/dev/null

account=george-hutanu
repo="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$repo" || exit 0
gh_bin="$(command -v gh || echo "$HOME/.local/bin/gh")"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  printf 'export GH_TOKEN="$(%s auth token --hostname github.com --user %s 2>/dev/null || echo %s-is-not-logged-in-to-gh)"\n' \
    "$gh_bin" "$account" "$account" >> "$CLAUDE_ENV_FILE"
fi

echo "GitHub identity for this repo: george-hutanu <hutanugeorge40@gmail.com>, account $account — never the QLOG account. gh here runs as $account via GH_TOKEN; never run \`gh auth switch\`."

if ! drift="$(sh .husky/identity.sh check 2>&1)"; then
  echo "$drift"
fi
if ! "$gh_bin" auth token --hostname github.com --user "$account" >/dev/null 2>&1; then
  echo "gh has no login for $account: gh commands and pushes here will fail until the user runs \`gh auth login --hostname github.com\` as $account, then \`gh auth switch --hostname github.com --user george-hutanu-qlog\` so ~/code keeps the QLOG account. Do not push or call gh until then."
fi
exit 0

#!/usr/bin/env sh
# motor-fix is a personal repo: every commit and push is george-hutanu
# <hutanugeorge40@gmail.com> on GitHub account george-hutanu — never the QLOG
# identity that ~/.gitconfig and gh's active account default to on this machine.
# Everything here is repo-local; ~/.gitconfig and gh's active account stay as
# they are, so ~/code keeps the QLOG setup.
#
#   sh .husky/identity.sh apply   write the repo-local git config (npm prepare runs this)
#   sh .husky/identity.sh check   exit 1 naming what drifted (.husky/pre-commit runs this)
set -eu

name=george-hutanu
email=hutanugeorge40@gmail.com
account=george-hutanu
key=credential.https://github.com.helper

case "${1:-}" in
  apply)
    gh_bin="$(command -v gh || echo "$HOME/.local/bin/gh")"
    git config user.name "$name"
    git config user.email "$email"
    # The empty helper drops the global gh helper, which hands out the active
    # (QLOG) account's token. This one asks gh for george-hutanu's token by
    # name and gives git nothing when that account is not logged in.
    git config --unset-all "$key" 2>/dev/null || true
    git config --add "$key" ""
    git config --add "$key" "!f() { test \"\$1\" = get || exit 0; t=\$($gh_bin auth token --hostname github.com --user $account 2>/dev/null) || exit 0; echo username=$account; echo \"password=\$t\"; }; f"
    git config credential.https://github.com.username "$account"
    echo "motor-fix: git identity pinned to $name <$email>, GitHub account $account"
    ;;
  check)
    problems=""
    ident="$(git var GIT_AUTHOR_IDENT)"
    case "$ident" in
      "$name <$email> "*) ;;
      *) problems="$problems
  - commit author is '${ident%>*}>', not '$name <$email>'" ;;
    esac
    committer="$(git var GIT_COMMITTER_IDENT)"
    case "$committer" in
      "$name <$email> "*) ;;
      *) problems="$problems
  - committer is '${committer%>*}>', not '$name <$email>'" ;;
    esac
    case "$(git config --get-all "$key" 2>/dev/null)" in
      *"--user $account"*) ;;
      *) problems="$problems
  - GitHub credentials are not pinned to $account (pushes would use gh's active, QLOG, account)" ;;
    esac
    if [ -n "$problems" ]; then
      echo "motor-fix identity check failed:$problems" >&2
      echo "Fix: sh .husky/identity.sh apply (and unset any GIT_AUTHOR_*/GIT_COMMITTER_* overrides)" >&2
      exit 1
    fi
    ;;
  *)
    echo "usage: sh .husky/identity.sh apply|check" >&2
    exit 2
    ;;
esac

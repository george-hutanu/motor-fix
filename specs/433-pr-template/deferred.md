# Deferred — 433-pr-template

- `.claude/scripts/artifact-lint.spec.mjs` › diff-audit "does not run the lane under --check" and "accepts --no-jev…" time out at 5 s locally: `diff-audit.mjs` diffs against the local `main` branch, which on this machine is stale (202c88e, 124 changed files), under load average 9–13. Not touched by this change; CI's test:harness passed on PR #17. Later: diff against `origin/main` when it exists, or raise those two tests' timeout.

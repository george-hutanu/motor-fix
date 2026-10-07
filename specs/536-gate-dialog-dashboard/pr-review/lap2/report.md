**Agent review: failure** — PR #186 at `bc5b89c`, lap 1

Blocking: 1 (blocker 0, high 1) · medium 0 · low 1. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions (https://github.com/george-hutanu/motor-fix/actions/runs/37582103359): PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- No API operation changed.
- Unit and end-to-end tests left to CI (Unit and integration tests, E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | flow not run: the gate dialog over the dashboard keeps the account shown, and lets it go on close and at sign-out |  | .specify/.cache/qa-flows-186.mjs: missing in the worktree; run 37582103359 was pull_request-triggered and drove no flows (FR-001 checked only by unit tests) |
| 2 | low | lapsed account survives a cancelled gate, so a later gate shows it again |  | apps/web/src/app/dashboard/session.ts:420: if (!this.current() && this.lapsed) this.kept.set(this.lapsed); |

### Reproduction
1. Sign in as the garage owner and open /app/garage/team → Let the session renewal fail so the next call is refused and the sign-in gate dialog opens → Check the name, role chips, menu items and invite button stay on screen behind the dialog → Close the dialog without signing in: the account is no longer shown; repeat and sign in as another account: that account is shown
2. Renewal fails, gate opens, close it without signing in → Another refused call opens the gate again: keepShownWhile re-reads this.lapsed and shows the forgotten account once more

Screenshots: 32, one per route × viewport × scheme × language.

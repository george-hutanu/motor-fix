**Agent review: failure** — PR #136 at `46c2335`, lap 4

Blocking: 2 (blocker 0, high 2) · medium 0 · low 0. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions (https://github.com/george-hutanu/motor-fix/actions/runs/37421988422): PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- Called the changed operations: GET /api/v1/auth/providers → 200; GET /api/v1/auth/oauth/pending → 404; POST /api/v1/auth/oauth/complete → 400; GET /api/v1/auth/oauth/google → 404; GET /api/v1/auth/oauth/apple → 404; GET /api/v1/auth/oauth/google/callback → 404; POST /api/v1/auth/oauth/apple/callback → 404.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | sign-in dialog, providers {"apple":true,"google":true}, ro: provider buttons 0/0, expected 1 each |  | /home/runner/work/_temp/pr-qa/shots/flow-buttons-true-ro.png |
| 2 | high | sign-in dialog, providers {"apple":true,"google":true}, en: provider buttons 0/0, expected 1 each |  | /home/runner/work/_temp/pr-qa/shots/flow-buttons-true-en.png |

### Reproduction
1. sign-in dialog, providers {"apple":true,"google":true}, ro
2. sign-in dialog, providers {"apple":true,"google":true}, en

Screenshots: 48, one per route × viewport × scheme × language.

### Tail triage
Both findings were in the flows file, not the product: it counted the provider buttons as soon as the dialog's panel attached, before the dialog's async `GET /auth/providers` answer had drawn them (the E2E spec `apps/web-e2e/src/sign-in-providers.spec.ts` clicks the same button with auto-wait and passes in CI). `.specify/.cache/qa-flows-136.mjs` now waits for the mocked answer and the buttons before counting. The branch also merged `origin/main` (conflicts in `.specify/capabilities/accounts.md` and `CLAUDE.local.md`, both kept).

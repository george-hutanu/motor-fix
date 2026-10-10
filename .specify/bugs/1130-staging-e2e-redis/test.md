# Bug Test: 1130-staging-e2e-redis

Result: partial (verified locally; the staging release can only be proven after the merge).

## Failing first

- `libs/domain/src/seed.integration.spec.ts` (the worktree's own PostgreSQL): 1 of 32 failed, 21 extra requests left after the second seed.
- `apps/web-e2e/src/rate-counts.spec.ts`: 2 of 6 failed, the setup "went on" with Redis and PostgreSQL unreachable.

## After the fix

- seed.integration.spec: 32 of 32 passed.
- rate-counts.spec: 6 of 6 passed (`--retries 0`).
- motion.spec dialog test against staging (`BASE_URL` set to the staging web app), `--repeat-each 8 --retries 0`: 8 of 8 passed.

## Merge-time check

The two releases after the merge must pass "End to end on staging" (FR-006). Recorded in the PR and in `specs/1130-staging-e2e-redis/handoff.md`.

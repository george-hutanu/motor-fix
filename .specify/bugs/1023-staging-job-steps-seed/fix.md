# Bug Fix: staging's seeded job was never started, so the mechanic's tick is refused

- **Slug**: 1023-staging-job-steps-seed
- **Fixed**: 2026-10-10
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The seed now starts a seeded job left in the shape the ST-220 seed wrote
(`to_do`, never started, no history), as `book()` starts a new one, so the
release's seed-only run brings staging's job to `in_work` and the mechanic can
tick its steps. A job with any history is left as it is.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `libs/domain/src/seed.ts` | modified | `startOlderJob()` after `requests()`; the start history moved into `recordStart()`, shared with `book()` |
| `libs/domain/src/seed.integration.spec.ts` | modified | two specs: the old-shape job is started with its history; a job with history is untouched |

## Verification

- Red first: the new spec failed (`status: "to_do"`, `startedAt: null`) before the change.
- `seed.integration.spec.ts`: 29 passed against the worktree's PostgreSQL.
- On staging: the tail checks two release runs in a row after the merge (Done when).

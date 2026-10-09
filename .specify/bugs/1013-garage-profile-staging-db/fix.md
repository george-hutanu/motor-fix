# Bug Fix: the suspended mobile mechanic E2E describe needs PostgreSQL, and staging has none

- **Slug**: 1013-garage-profile-staging-db
- **Fixed**: 2026-10-09
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

'a mobile mechanic, then suspended @seeded' now skips itself, with a reason,
when `DATABASE_URL` is unset, as `pwa.spec.ts` skips itself without
`BASE_URL`. Where PostgreSQL is reachable (CI's E2E job, a local run) it runs
unchanged, every assertion kept.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web-e2e/src/garage-profile.spec.ts` | modified | `test.skip(!process.env['DATABASE_URL'], …)` at the top of the describe; its comment says why |

## Why not the API

- No route suspends a garage: nothing in `apps/api`, `apps/worker` or
  `libs/domain` sets `garage.status = 'suspended'` or emits
  `garage.suspended` (only the live hub relays it and the public profile
  reads it). The test's second half cannot be set up without PostgreSQL.
- Creating an approved mobile mechanic through the API is the listing-draft
  flow plus an admin verification, and nothing could remove it from staging
  afterwards.
- The seeded `mecanic-mobil-cluj` has brand rows, a 20 km area and no
  "known for" line: using it would change the first test's assertions, and
  suspending it would change what other specs see.

## Tests Added or Updated

- `apps/web-e2e/src/garage-profile.spec.ts` › 'a mobile mechanic, then
  suspended @seeded' — the guard itself; both tests unchanged.

## Local Verification

Local stack: this worktree's PostgreSQL and Redis (compose project
`mf-test-1013-garage-profile-staging-db-b8d525`, migrated and seeded), api on
3000, worker on 3011 (3001 is another project's), web on 4200. Runs in
deployed mode (`BASE_URL=http://localhost:4200 E2E_PASSWORD=x`, as the staging
job), under `scripts/heavy.sh`, `--retries 0`:

- Red before the fix, without `DATABASE_URL`: `-g "a mobile mechanic"` →
  1 failed (`connect ECONNREFUSED 127.0.0.1:5432`), 1 did not run, the
  staging failure exactly.
- After, without `DATABASE_URL`: 2 skipped with the reason; the whole file
  → 9 passed, 2 skipped.
- After, with `DATABASE_URL`: the whole file `--repeat-each 3` → 33 passed.
- `biome check` on the file: clean.

## Deviations from Assessment

None.

## Follow-ups

- When an admin route suspends a garage, set the mobile mechanic's
  suspension up through it so staging covers the no-longer-available view.

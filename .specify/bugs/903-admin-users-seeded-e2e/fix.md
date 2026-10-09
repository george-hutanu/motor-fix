# Bug Fix: the admin accounts E2E cannot find the seeded rows on staging

- **Slug**: 903-admin-users-seeded-e2e
- **Fixed**: 2026-10-09
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The `@seeded` tests no longer look for seeded accounts at a place in the newest-first list. Each test signs up a driver of its own just before opening the view and finds that row. The look-up pages until the row appears or the list has truly ended. The suspended, garage-owner and mechanic rows the old test read are now checked on served rows.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web-e2e/src/admin-users.spec.ts` | modified | `findRow` scrolls the sentinel and waits for each page until the row is found or no sentinel is left (no fixed tries); `freshDriver` signs up through `POST /api/v1/auth/sign-up` with its own TEST-NET-3 address; the `@seeded` tests assert that row (detail, lamp, state) plus the totals, growth and no sideways scroll; `stubAccounts` takes an optional one-page list |

## Tests Added or Updated

- `the accounts view @seeded › shows the seeded admin the totals, a new account and the growth` (320 px phone, desktop; Romanian): the real API's newest row reads `șofer · fără mașină`, green, `activ · din <month> <year>`.
- `the accounts view @seeded › reads a new account and the growth in English` (390 px phone, desktop): `driver · no car`, `active · since <month> <year>`.
- `the accounts view › reads a suspended account, a garage owner and a mechanic` (320 px phone, desktop; ro, en): the texts the old seeded test checked, on served rows.

## Local Verification

- Worktree stack (`scripts/test-services.ts`), seeded, then 400 newer accounts inserted; API on :3100, web on :4300; `BASE_URL=http://localhost:4300 E2E_PASSWORD=parola-de-test npx playwright test … admin-users.spec.ts --retries=0` → 13 passed (the old spec: 2 failed at `findRow`, see `test.md`).
- `npx biome check`, `tsc -p apps/web-e2e` → clean.

## Deviations from Assessment

None.

## Follow-ups

- None. Staging keeps accumulating E2E accounts; the tests no longer depend on how many there are.

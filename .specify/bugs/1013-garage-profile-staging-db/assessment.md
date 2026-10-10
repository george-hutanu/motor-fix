# Bug Assessment: the suspended mobile mechanic E2E describe needs PostgreSQL, and staging has none

- **Slug**: 1013-garage-profile-staging-db (ST-1013)
- **Created**: 2026-10-09
- **Source**: pasted text (release.yml run 37877012434, main 49a9137)
- **Verdict**: valid
- **Severity**: high (the release stops at staging; nothing reaches production)

## Report (summarized)

Staging E2E: 535 passed, 1 failed, 5 did not run. The failing describe is
'a mobile mechanic, then suspended @seeded' in
`apps/web-e2e/src/garage-profile.spec.ts`, added by ST-307 (#297). Its
`beforeAll` connects a `pg` Client to `DATABASE_URL`; the staging job sets
`BASE_URL`, `RELEASE_SHA` and `E2E_PASSWORD` only, so `pg` falls back to
127.0.0.1:5432 and fails with ECONNREFUSED.

## Root cause

The describe writes its own fixture straight to PostgreSQL: it inserts an
approved mobile garage, and later suspends it and inserts the
`garage.suspended` outbox event in one transaction. The suite's other
database use (`global-setup.ts`) already treats an unset `DATABASE_URL` as
"not reachable" and goes on; this describe does not.

## Can the setup go through the API instead?

No, within this fix:

- **Suspension**: no route suspends a garage. Nothing in `apps/api`,
  `apps/worker` or `libs/domain` writes `garage.status = 'suspended'` or emits
  `garage.suspended`; only the live hub relays it and the public profile reads
  it. The admin action is not built yet.
- **Creating the mobile mechanic**: a garage reaches `approved` only through
  the listing-draft flow plus an admin verification, several routes and
  accounts deep, and it would then exist on staging until the next reset with
  no route to remove it.
- **A seeded mobile mechanic** (`mecanic-mobil-cluj`) exists, but it has
  brand rows, a 20 km area and no "known for" line, so the first test's
  assertions would have to change, and suspending it would change what every
  other spec sees.

## Proposed remediation

Guard the describe as `pwa.spec.ts` guards itself: `test.skip` with a
reason when `DATABASE_URL` is unset. No assertion changes; CI's E2E job and a
local run (both set `DATABASE_URL`) still run both tests.

## Files likely to change

- `apps/web-e2e/src/garage-profile.spec.ts`

## Tests to add or update

The describe itself is the test: run it with `DATABASE_URL` (2 passed) and
without (2 skipped, reason shown).

## Risks & Considerations

- Staging no longer covers the suspended view. It is covered in CI's E2E job
  on every PR and by the api's integration specs.
- Follow-up: once an admin route suspends a garage, set the suspension up
  through it so staging covers it too.

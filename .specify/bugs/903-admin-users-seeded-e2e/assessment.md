# Bug Assessment: the admin accounts E2E cannot find the seeded rows on staging

- **Slug**: 903-admin-users-seeded-e2e (story ST-1003; the gates read a three-digit folder number)
- **Created**: 2026-10-09
- **Source**: Notion story ST-1003, https://app.notion.com/p/3f3607bff0d28127be2fe56d7585fd70 (connector read, not a web fetch), and release run 37853741188's log
- **Verdict**: valid
- **Severity**: high (the release's End to end on staging is red on every merge since 3907a87, so nothing reaches production)

## Report (summarized)

Release run 37853741188 (main 3907a87, merge of #299 / ST-1) failed at "End to end on staging": the four `@seeded` tests of `apps/web-e2e/src/admin-users.spec.ts` (line 53, 320 px phone and desktop; line 93, 390 px phone and desktop), each on three attempts, with `expect(locator).toHaveCount(1)` receiving 0 at `findRow` (line 28), called for "Radu Suspendat" (lines 64 and 115). 496 other tests passed. CI's E2E job on the same commit passed.

## Symptom

On staging, Recent accounts never shows the seeded rows within the test's 15 scroll tries; expected: the test finds the seeded suspended driver, the driver who owns Service Dobre and the mechanic of Atelier Test.

## Reproduction

1. A local stack (the worktree's PostgreSQL and Redis), migrated and seeded (`nx run domain:seed`).
2. 400 extra driver accounts inserted with `created_at` after the seed's, as earlier E2E runs leave them on staging (they are never removed there).
3. API and web served locally; `web-e2e` run against them with `BASE_URL` and `E2E_PASSWORD` (the deployed-address mode the release uses), `--grep "accounts view @seeded"`: the old spec fails at `findRow` exactly as on staging; without step 2 it passes, as in CI. Results in `test.md`.

## Suspected Code Paths

- `apps/web-e2e/src/admin-users.spec.ts:22-30`: the look-up assumes a seeded account is within 15 pages' reach:
  `for (let tries = 0; tries < 15 && (await found.count()) === 0; tries++) { await recent(page).locator('li.row').last().scrollIntoViewIfNeeded(); await page.waitForTimeout(300); }`
  Each try waits 300 ms whether or not a page arrived, and scrolling to a last row already in view loads nothing, so a slower page answer wastes tries too.
- `libs/domain/src/admin/admin-accounts/admin-accounts.service.ts` `page()`: `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`, `take: PAGE + 1` with `PAGE = 20`: newest first, twenty a page. Working as specified.
- `apps/web/src/app/dashboard/admin-users/admin-users.ts` `readMore()` / `lookAgain()`: the sentinel after the last row loads the next page, and pages chain while it stays in view. The view reaches every account; it has no search or filter.
- `libs/domain/src/seed.ts` `add()`: `ON CONFLICT (email) DO NOTHING`; seeded accounts keep the `created_at` of the run that first made them, so on staging they sit under every account E2E runs created since (sign-up, add-car, confirm-email, live, listing-draft, photos-step, sign-out, sign-up-consent, sign-in-providers, receptionist-live create fresh `@example.test` accounts on every release).

## Root Cause Hypothesis

The test depends on where the seeded accounts sit in a newest-first list, and on staging that position only grows: every release's E2E run adds accounts above them, and nothing removes them. CI starts from an empty database, so the seeded rows are on the first pages there and the test passes. Confidence: high (reproduced locally with staging-like data). Not a product bug: the view loads every page as it scrolls; there is just no way to jump to an old account, which the story does not ask for.

## Proposed Remediation

**Preferred**: stop asserting real seeded rows at a position. The `@seeded` tests sign up an account of their own through the API just before opening the view; the newest-first list puts it on the first page whatever staging holds, which checks the real API end to end (row, detail, lamp, count, totals, growth) in both languages. The look-up scrolls until the row appears or the list has truly ended (no sentinel left), waiting for each page instead of a fixed 300 ms, with no fixed number of tries. How a suspended account, a driver who owns a garage and a mechanic read (the texts the old test checked) moves to served rows in the stubbed describe, where the position is the test's own; the API side of those rows (suspension date from the activity log, garage names by role) is already covered by `admin-accounts.service.integration.spec.ts` ("dates a suspension from its latest recorded change", "gives an owner their garage", "gives a mechanic the garage of their card", "orders a driver and owner as driver first").

**Alternatives**:
- Keep the seeded rows and scroll to the list's end: correct, but the cost grows with every release (thousands of rows, a page at a time, four tests, three attempts each) until it times out again.
- Add a search to the view: a product change no story asks for.
- Remove E2E-created accounts from staging after each run: touches staging data and the release workflow, and other flows rely on accounts persisting.

**Files likely to change**:
- `apps/web-e2e/src/admin-users.spec.ts`

**Tests to add or update**:
- `@seeded`: a fresh account of the test's own, found on the real list, Romanian and English, phone and desktop.
- stubbed: suspended, driver + garage and mechanic rows, Romanian and English.

## Risks & Considerations

- The fresh account is created through `POST /api/v1/auth/sign-up`, limited per address per hour; the test sends its own `x-forwarded-for` from TEST-NET-3, as `live.spec.ts` and `sign-up.spec.ts` do.
- Each release now adds four more accounts to staging; harmless, and the new tests do not depend on how many there are.
- Other `@seeded` specs were checked for the same assumption: none looks an account or garage up by its place in a growing list (admin-dashboard reads totals, bell reads the notification it sent, the rest read the signed-in account's own data).

## Open Questions

None.

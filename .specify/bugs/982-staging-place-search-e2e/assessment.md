# Bug Assessment: Home's address-search E2E tests expect the test-only stand-in on staging

- **Slug**: 982-staging-place-search-e2e (auto-generated; ST-982)
- **Created**: 2026-10-08
- **Source**: pasted text (release.yml run 37817123813, job 113455837425; run 37817447795, job 113461655406)
- **Verdict**: valid
- **Severity**: high (every release since main 0a965a6 stops at staging; nothing reaches production)

## Report (summarized)

The release for main 0a965a6 (PR #282, ST-229 "Share my location or type an
address") failed at "End to end on staging". The next release, ced0328
(run 37817447795), failed the same way: 3 failed, 4 skipped, 484 passed.
All three retries of each test were red:

- `home.spec.ts:173` "hints at the address when the location is refused, and
  finds the address typed": `locator.click` timed out waiting for
  `getByRole('dialog', { name: 'Alege locul' }).getByRole('option', { name: 'Strada Exemplu 2, Cluj-Napoca' })`.
- `home.spec.ts:203` "says when no address was found": `getByText('Nu am găsit adresa')` not found.
- `home.spec.ts:238` "keeps the place after a reload and in the other language": the same click timed out.

Also logged: `global-setup: accounts not reset: connect ECONNREFUSED 127.0.0.1:1`.

## Symptom

On staging the place dialog never lists "Strada Exemplu 2, Cluj-Napoca" for
"Cluj" and never says "Nu am găsit adresa" for "nicaieri". In CI's E2E job
both appear.

## Reproduction

1. Point the suite at staging: `BASE_URL=<staging web URL> E2E_PASSWORD=x npx playwright test -c apps/web-e2e/playwright.config.mts home.spec.ts -g "the place on Home"`
   (`E2E_PASSWORD` only keeps the `@seeded` tests in; these three never sign in).
2. The three tests above fail; "says when addresses cannot be searched"
   (which answers `/api/v1/places` itself with a 503) passes.

## Suspected Code Paths

- `apps/web-e2e/src/home.spec.ts:189-192`, `:207-211`, `:243-246` — the tests send
  the typed text through the real api and expect fixed answers:
  `.getByRole('option', { name: 'Strada Exemplu 2, Cluj-Napoca' })`,
  `await field(page).fill('nicaieri');`.
- `libs/domain/src/places/providers/fake-places.provider.ts` — the only source
  of those answers: `{ label: 'Strada Exemplu 2, Cluj-Napoca', lat: 46.7712, lng: 23.6236 }`
  and `const NOWHERE = 'nicaieri';`.
- `libs/domain/src/places/places.module.ts:26-28` — the stand-in is chosen only for tests:
  `if (apiKey) return { apiKey, provider: 'geoapify' };`
  `return appEnv === 'test' ? { provider: 'fake' } : { provider: 'none' };`
- CI's E2E job boots the api with `APP_ENV=test` (stand-in); staging's api runs
  `APP_ENV=staging` and its Railway variables (names read, no values) have no
  `GEOAPIFY_API_KEY`, so the look-up answers `not_configured` there.
- `apps/web-e2e/src/place-step.spec.ts:43` already answers the look-up in the
  browser (`page.route('**/api/v1/places?*', …)`) and passes on staging.

## Root Cause Hypothesis

The three tests were written against CI's boot, where the api's address
look-up is the test stand-in; they assume its fixed list and its "nicaieri"
word. A deployed api never has the stand-in: staging without a key answers
"cannot search" (what ran), and with a key would answer real Geoapify
results, which contain neither the made-up street nor a guaranteed empty
answer for "nicaieri". So the tests can never pass against a deployed address,
whatever its configuration. Confidence: high (two runs, same three tests;
the 503-stubbed sibling passes).

The `ECONNREFUSED 127.0.0.1:1` lines are expected: global-setup's account
reset and count clearing need the local Redis and PostgreSQL, which a
deployed run does not have (`global-setup.ts:50-51` lets the run go on). They
appeared in earlier green releases too and are not part of this failure.

## Proposed Remediation

**Preferred**: in `home.spec.ts`, answer `/api/v1/places` in the browser for
the three tests with the answers they assert (Strada Exemplu 2 for "Cluj",
an empty list for "nicaieri"), the way `place-step.spec.ts` does. The flow
under test is the web dialog (field, list, chosen place, near count, kept
place, language switch); the api's look-up and its stand-in keep their own
integration tests. The "near" read still goes to the real api, so the count
check keeps its value on staging.

**Alternatives**:
- Tag the three tests to skip on a deployed address: loses the dialog's only
  staging check.
- Set `GEOAPIFY_API_KEY` on staging: does not fix the tests (real answers
  differ), and needs the owner.

**Files likely to change**:
- `apps/web-e2e/src/home.spec.ts`

**Tests to add or update**:
- The three tests above answer the look-up themselves and still assert the
  request text (`texts` equals `['Cluj']`).

## Risks & Considerations

- CI no longer drives the stand-in through the browser; the api look-up is
  covered by `places.controller.integration.spec.ts` and its adversary spec.
- Separate product gap, not this fix: no api in staging or production has
  `GEOAPIFY_API_KEY`, so real visitors see "Nu putem căuta adrese acum" on
  Home and in the listing form. The owner sets it; recorded on ST-982.

## Open Questions

- None blocking.

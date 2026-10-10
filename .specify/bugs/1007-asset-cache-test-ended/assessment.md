# Bug Assessment: staging E2E fails the release with errors outside any test

- **Slug**: 1007-asset-cache-test-ended
- **Story**: ST-1007 (Bug)
- **Verdict**: valid

## Evidence

Release run 37862261522 (b07dc55), staging E2E: 504 passed, 0 failed, then 5 errors "not a part of any test": `route.fetch: Test ended` at `apps/web-e2e/src/asset-cache/asset-cache.ts:18` (`serveFromCache`). Playwright exits non-zero and production is not promoted. Introduced by ST-884 (ff386d8f).

## Root cause

`serveFromCache` awaits `route.fetch()` and `route.fulfill()` unguarded. When a test ends, or its page or context closes, while a hashed asset is still loading, those calls reject. Playwright's route dispatcher (`_onRoute`, fired from a channel event) has no catch, so the rejection is unhandled and is reported as an error outside any test. `cacheAssets` is installed only when `BASE_URL` is set (`apps/web-e2e/src/fixtures.ts`), so PR CI never runs it.

## Proposed Remediation

- `serveFromCache`: catch a failed fetch or fulfil and abort the route, ignoring a failure to abort.
- `context` fixture: `await context.unrouteAll({ behavior: 'ignoreErrors' })` after `use(context)`.

## Files likely to change

- `apps/web-e2e/src/asset-cache/asset-cache.ts`, `apps/web-e2e/src/fixtures.ts`

## Tests to add or update

- `apps/web-e2e/src/asset-cache/asset-cache.spec.ts`: close a cached context while its asset fetch is held in flight; expect no unhandled rejection.

## Risks & Considerations

- A real network failure of a hashed asset is now an aborted request (as a lost connection) rather than an unhandled error; the page sees the same failure.

# Bug Fix: staging E2E fails the release with errors outside any test

- **Slug**: 1007-asset-cache-test-ended
- **Fixed**: 2026-10-09
- **Assessment**: ./assessment.md
- **Status**: applied

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web-e2e/src/asset-cache/asset-cache.ts` | modified | `serveFromCache` wraps the answer in try/catch and aborts the route; abort failure ignored; a failure other than a closed context or ended test is logged (QA lap 1) |
| `apps/web-e2e/src/fixtures.ts` | modified | `unrouteAll({ behavior: 'ignoreErrors' })` after `use(context)`, in the exported `routedContext` |
| `apps/web-e2e/src/fixtures.spec.ts` | added test | FR-002: `routedContext` removes every handler after `use` (QA lap 1) |
| `apps/web-e2e/src/asset-cache/asset-cache.spec.ts` | added test | "lets its context close while a fetch is still in flight"; test server split into `servePage`/`serveScript` (Biome complexity) |

## Local Verification

- Red first: the new test failed on the old code with `route.fetch: Request context disposed ... while running route callback` escaping as an unhandled rejection.
- `BASE_URL=http://localhost:1 scripts/heavy.sh npx playwright test -c apps/web-e2e/playwright.config.mts src/asset-cache/asset-cache.spec.ts --retries 0 --repeat-each 5` → 50 passed.
- `vitest lib/feature.spec.mjs lifecycle` → 178 passed (new case red first). Biome, `tsc -p apps/web-e2e` green.

## Deviations from Assessment

- The branch first carried a two-regex harness change so the lifecycle could resolve a 4-digit feature folder. ST-1009 (#313) landed the same change on `main`, and the merge of `main` made those files equal to it, so the PR no longer changes them.

## Follow-ups

- The other harness scripts still assume 3-digit feature numbers (deferred.md).

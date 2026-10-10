# Bug Assessment: three end-to-end specs bypass the asset-cache fixtures

- **Slug**: 927-e2e-fixtures-imports
- **Assessed**: 2026-10-08
- **Source**: release run 37714584571 (E2E job), ST-927
- **Verdict**: valid

## Symptom

The release on `main` fails `apps/web-e2e/src/asset-cache/asset-cache.spec.ts:180`,
"every end-to-end spec takes its test from the fixtures".

## Root Cause

`add-car.spec.ts`, `details-prices-mechanics.spec.ts` and `garage-only.spec.ts`
import `test` from `@playwright/test`. Only the `test` exported by
`apps/web-e2e/src/fixtures.ts` routes hashed assets through the cache, so these
specs download every asset again on staging, and the guard rejects them. They
merged after the guard landed. The guard's regex over all 50 specs on `main`
lists exactly these three.

## Proposed Remediation

Import `test` from `./fixtures.js` in the three specs and keep `expect`, `Page`
and `Locator` from `@playwright/test`, as `account-language.spec.ts` does.

### Files likely to change

- `apps/web-e2e/src/add-car.spec.ts`
- `apps/web-e2e/src/details-prices-mechanics.spec.ts`
- `apps/web-e2e/src/garage-only.spec.ts`

### Tests to add or update

None: the guard already pins this down and fails on `main`.

## Risks & Considerations

The fixture `test` extends Playwright's own, so the specs' bodies and their
`test.describe`/`test.beforeEach` calls keep working unchanged.

# Bug Fix: three end-to-end specs bypass the asset-cache fixtures

- **Slug**: 927-e2e-fixtures-imports
- **Fixed**: 2026-10-08
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The three specs now take `test` from `./fixtures.js`, so their runs go through
the asset cache and the guard passes again.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web-e2e/src/add-car.spec.ts` | modified | `test` from `./fixtures.js` |
| `apps/web-e2e/src/details-prices-mechanics.spec.ts` | modified | `test` from `./fixtures.js` |
| `apps/web-e2e/src/garage-only.spec.ts` | modified | `test` from `./fixtures.js` |

## Tests Added or Updated

None. `apps/web-e2e/src/asset-cache/asset-cache.spec.ts` "every end-to-end spec
takes its test from the fixtures" already pins this down; it failed in release
run 37714584571.

## Local Verification

- The guard's regex over the 50 specs: on `main` it lists the three files; on
  the branch it lists none.
- `scripts/heavy.sh npx nx run web-e2e:typecheck` → exit 0.
- `biome check` on the three files → clean.

## Deviations from Assessment

None.

## Follow-ups

- None.

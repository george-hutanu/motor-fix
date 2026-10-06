# Bug Fix: Release fails at the staging end-to-end step

- **Slug**: 663-release-staging-e2e
- **Fixed**: 2026-10-05
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The release seeds staging (seed only) before its end-to-end run, the cockpit
route loads its texts before it matches so hydration never shows keys, and
the motion spec waits for the replayed click to open the dialog.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/reset-staging.sh` | modified | `SEED_ONLY=1` skips the reset |
| `.github/workflows/release.yml` | modified | Railway CLI, one-off SSH key, seed step, key removal (`if: always()`) |
| `apps/web/src/app/addresses.ts` | modified | `cockpitTexts` canMatch |
| `apps/web/src/app/app.routes.ts` | modified | cockpit route uses it |
| `libs/ui-cockpit/src/lib/sample-page.ts` | modified | constructor load removed |
| `apps/web-e2e/src/motion.spec.ts` | modified | `openDialog` waits for the dialog |
| `scripts/release-workflow.spec.ts` | added tests | seed step order, masking, key removal |
| `scripts/reset-staging.spec.ts` | added tests | seed-only mode |
| `apps/web-e2e/src/cockpit.spec.ts` | added test | no raw key while JS is slow |

## Tests Added or Updated

- `release-workflow.spec.ts` › seeds staging after the deploy and before the end-to-end run
- `release-workflow.spec.ts` › removes the seed run's SSH key even when the seed fails
- `reset-staging.spec.ts` › with SEED_ONLY=1, only seeds / still refuses outside staging
- `cockpit.spec.ts` › never shows a text key while the page wakes up, however slow the scripts

## Local Verification

- `npx jest scripts/release-workflow.spec.ts scripts/reset-staging.spec.ts` → 3 red before, 26/26 green after
- cockpit e2e against staging (`BASE_URL`) → red, 40 raw keys recorded
- `npx jest apps/web/src/app/addresses.adversary.spec.ts libs/ui-cockpit/src/lib/sample-page.spec.ts` → 40/40

## Deviations from Assessment

None.

## Follow-ups

- The next Release run must pass "End to end on staging".

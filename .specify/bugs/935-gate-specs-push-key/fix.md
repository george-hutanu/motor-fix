# Bug Fix: the sign-in gate specs open the gate on load on staging

- **Slug**: 935-gate-specs-push-key
- **Fixed**: 2026-10-08
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Both sign-in gate specs now answer the push key read a production build makes
on load (`{ publicKey: null }`), so on staging the only refused call is the
language save again.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web-e2e/src/sign-in-gate.spec.ts` | modified | stub `**/api/v1/push-subscriptions/key` |
| `apps/web-e2e/src/sign-in-gate-frame.spec.ts` | modified | the same stub |

## Tests Added or Updated

The two specs are the test. Red before: against staging
(`BASE_URL=https://web-staging-dd20.up.railway.app`, `--retries 0`) 7 of 7
failed with the gate open on load. Green after: the same run, 7 passed.

## Local Verification

- Staging run above: 7 passed (2.8s).
- `scripts/heavy.sh npx nx run web-e2e:typecheck` → exit 0.
- `biome check` on both files → clean.

## Deviations from Assessment

None.

## Follow-ups

- None.

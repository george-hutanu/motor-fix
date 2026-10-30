# Bug Test: main's Integration tests red since #615

- **Slug**: 1396-main-integration-red
- **Verified**: 2026-10-30
- **Result**: resolved

## Evidence

- CI run 40979520329 (workflow_dispatch, every project, head 178a078): Integration tests success, so all five failing specs are green on the merged head. E2E: 1168 passed, sign-in-gate and sign-in-gate-frame included; one flaky test (`results.spec.ts` brand chips, height 43.99997 < 44) failed the job.
- CI run 40985300047 (head b72fcc4, specs `results.spec.ts`, `sign-in-gate.spec.ts`, `sign-in-gate-frame.spec.ts`, `notifications.processor.integration.spec.ts`, repeat 5, no retry): every job success.

## Scope added after the assessment

- `apps/web-e2e/src/results.spec.ts`: the 44 px touch-target check rounds the measured height, since layout measures in 1/64 px. Found on the full E2E run and fixed here (AGENTS.md: adjacent problems are fixed in the PR).

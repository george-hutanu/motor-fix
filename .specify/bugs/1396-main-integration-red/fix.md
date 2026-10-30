# Bug Fix: main's Integration tests red since #615

- **Slug**: 1396-main-integration-red
- **Fixed**: 2026-10-30
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The `notifications.processor` spec brought up to ST-277's `JOB_READY` template; the other four specs were fixed on main by #617. No product code changed.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/maintenance.integration.spec.ts` | modified | refuse route joins `OPEN` (1254-FR-005) |
| `libs/domain/src/auth/assistant-approvals/approval-timers/approval-timers.integration.spec.ts` | modified | worker built with push on; sweep case starts the timers at the sweep's time |
| `libs/domain/src/notifications/notifications.processor.integration.spec.ts` | modified | `JOB_READY` sent with `garage` and `link` (ST-277's template) |
| `apps/web-e2e/src/sign-in-gate.spec.ts`, `sign-in-gate-frame.spec.ts` | modified | stub the approval strip's `/me/assistant/approvals` read |

## Tests Added or Updated

The changed tests are the fix; each was red on main in CI (runs 40959271580, 40965693521).

## Local Verification

- `biome check` on the five files: clean.
- `nx run-many -t typecheck -p api domain web-e2e`: exit 0.
- Integration and E2E need Docker: proven by the on-demand CI runs on the branch (see `test.md`).

## Deviations from Assessment

While this PR was open, #617 (ST-11, 2d6e27c) merged the same fixes for the maintenance, approval-timers and sign-in-gate specs. This PR took main's versions in the merge, so its own change is the `notifications.processor` spec alone; the on-demand run proves all five on the merged head.

## Follow-ups

None.

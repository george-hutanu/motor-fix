# Bug Assessment: main's Integration tests red since #615

- **Slug**: 1396-main-integration-red
- **Created**: 2026-10-30
- **Source**: george-hutanu/motor-fix-specs#1396 (ST-1396); Release runs 40954281723, 40959271580; full CI dispatch 40965693521 on c8fa242
- **Verdict**: valid
- **Severity**: high (Release cannot ship; no production defect found)

## Report (summarized)

Release on main fails at Integration tests since #615 (ST-1254), which skips Docker build, E2E, staging and production. The sign-in-gate E2E specs were also reported failing on a full CI run, and `notifications.processor` "delivers an urgent message within a minute" failed on #622's full run.

## Symptom

Five integration tests and seven E2E tests fail on main. In each case the code does what its feature's spec says; the tests were never updated for it (the PR CI skips Integration and E2E).

## Reproduction

Read from the CI logs of runs 40959271580 (main, 35f3d6c) and 40965693521 (c8fa242, which holds ST-1252, ST-1254, ST-1265, ST-277). Docker is unavailable locally.

## Suspected Code Paths and Root Causes (confidence: high)

1. `apps/api/src/maintenance.integration.spec.ts` `OPEN`: the walk reports `POST /api/v1/me/assistant/approvals/{id}/refuse` as answered in maintenance. `libs/mcp-tools/src/approvals/approvals.controller.ts:173` marks it `@OpenInMaintenance()` ("Writes the decision only, so maintenance does not hold it"), as 1254-FR-005 says: "Refuse is not held by the maintenance switch". **The test is wrong**: the route is missing from `OPEN`.
2. `approval-timers.integration.spec.ts` "goes by push ...": got `email, in_app`. `NotificationsService.hasDevice` returns false when `PUSH_CONFIG` is null (`if (!this.push) return false;`), and the spec's `NotificationsModule.registerWorker` passes no `push`. **The test is wrong**: it must configure push, as other worker specs do.
3. `approval-timers.integration.spec.ts` "expires it from the sweep ...": the second sweep returns 1 again. `ObjectTimers.sweep(now)` lists `overdue(now)` with the given time, but `ApprovalTimers.fire` expires with `this.now()`, which the spec pins to `NIGHT`, before the expiry; so nothing is expired. In production both clocks are the real time. **The test is wrong**: it must start the timers at the sweep's time.
4. `notifications.processor.integration.spec.ts` "delivers an urgent message within a minute": status `failed`. ST-277 (#622) gave `JOB_READY` its own template with required values `garage` and `link` (`templates/job-ready.ts`), so the spec's `notify` without params fails at render (`missing value garage`). **The test is wrong**: it must send the values ST-277's fan-out sends.
5. `apps/web-e2e/src/sign-in-gate.spec.ts`, `sign-in-gate-frame.spec.ts`: the sign-in dialog is already open before the language tap. ST-1254 added `mf-approval-strip` to the dashboard frame (`frame.html:83`), which calls `GET /api/v1/me/assistant/approvals` on load; the specs do not stub it, so the real API refuses the stubbed token with `sign_in_required` and the gate opens early. **The test is wrong**: stub the call with no approvals, as the specs do for every other on-load call.

## Proposed Remediation

Test-only changes in the five spec files above; no product code changes.

## Risks & Considerations

- E2E and Integration are proven only by on-demand CI runs on the branch.
- Other failures may still be hidden behind the ones fixed here; the on-demand run is the proof.

## Open Questions

None.

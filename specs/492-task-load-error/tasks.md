---
description: "Tasks for ST-492: a task that fails to load shows an error and a retry"
---

# Tasks: A task that fails to load shows an error and a retry

**Input**: `specs/492-task-load-error/` (spec.md, plan.md, design.md, context.md, checklists/)
**Tests**: required (Constitution II): failing specs first, then the code.
**Organization**: US1 (error shown, closing works), US2 (retry loads the task), US3 (catalogue sample). No setup or foundational phase: no new file, project or dependency.

## Phase 1: Tests first (red)

- [X] T001 [P] [US1] Add failing specs to `libs/overlays/src/overlays.spec.ts` (its harness has the computer/phone switch and the i18n texts; written there instead of `panel.spec.ts`): a rejected loader, a synchronous throw and a non-component resolution (`reflectComponentType` null) show one `role="alert"` with `shell.form.problem.error` text and a retry button, drop `aria-busy`, remove the skeleton, and log no `console.error` (FR-001, FR-002, FR-008); the retry button is focused on a computer when the focus was on the panel and not when it is on the X, and a phone keeps the focus put (FR-007); a loader failing after close shows nothing (US1-4).
- [X] T002 [P] [US2] Add failing specs to `libs/overlays/src/overlays.spec.ts`: Retry calls the loader once more, shows the skeleton with `aria-busy="true"`, then the task with its first field focused on a computer (FR-004); a loader that fails twice shows the error again each time (FR-005); focus is not lost to the page when Retry is pressed (FR-004); a close during a retry ignores the late answer, resolve and reject (FR-006).
- [X] T003 [P] [US1] Add failing specs to `libs/overlays/src/overlays.spec.ts`: X, Escape and a tap outside close the failed panel with `cancelled` and no discard question (FR-006, SC-004).
- [X] T004 [P] [US1] Rewrite the test pinning a failed loader to `aria-busy="true"` at line 559 of `libs/overlays/src/panel.adversary.spec.ts` and at line 319 of `libs/overlays/src/overlays.adversary.spec.ts` so they assert the failed state (message, button, no busy mark).
- [X] T005 [P] [US1] Add keys to `libs/i18n/src/shell/ro.json` and `libs/i18n/src/shell/en.json`: `overlay.retry` ("Reîncearcă" / "Try again", U+2011 inside Romanian words, FR-003, FR-010); the i18n check (`libs/i18n/src/check.ts`, its spec) must pass for both languages.
- [X] T006 [P] [US3] Add failing specs to `libs/ui-cockpit/src/lib/sample-page.spec.ts`: the new "fails to load" button opens the error panel; Retry shows the sample task (FR-009); and add the keys `cockpit.overlay.openFailing` ("Deschide o sarcină care nu se încarcă" / "Open a task that fails to load") and `cockpit.overlay.failing` ("Sarcină care nu se încarcă" / "Task that fails to load") to `libs/i18n/src/cockpit/ro.json` and `libs/i18n/src/cockpit/en.json`.
- [X] T007 [P] [US3] Add one failing Playwright test to `apps/web-e2e/src/overlays.spec.ts`: on `/cockpit` press the new button, see the alert and `Reîncearcă`, press it, see the task, close with X (SC-002).

## Phase 2: Implementation (green)

- [X] T008 [US1] In `libs/overlays/src/panel.ts` add the `failed` signal, move the loader call into `private load()` (`Promise.resolve().then(() => loader())`, destroyed guard, non-component check, failure sets `failed` and focuses the retry button per FR-007), remove `console.error`, split the template `@else` into the error branch (`.mf-overlay-error` with `role="alert"` text and the secondary retry button) and the skeleton, set `aria-busy` to null while `task() || failed()`, add `retry()` and the `.mf-overlay-error` styles (full-width button on the sheet) (FR-001 to FR-008). Makes T001 to T004 pass.
- [X] T009 [US3] In `libs/ui-cockpit/src/lib/sample-page.ts` add `openFailing()` and the fourth `hlmBtn` secondary button in the overlay row: a dialog titled `cockpit.overlay.failing` whose loader rejects on its first call per press and resolves `CockpitSampleTask` on the second; the result feeds `lastResult` as the other buttons do (FR-009). Makes T006 and T007 pass.

## Phase 3: Proof

- [X] T010 Run `libs/overlays`, `libs/i18n` and `libs/ui-cockpit` tests, typecheck and Biome through `scripts/heavy.sh`, and the new Playwright test against `/cockpit`; confirm no test still pins a permanently busy body (SC-001) and the stryker floors of `libs/overlays` and `libs/ui-cockpit` hold in CI.

## Dependencies

T001 to T007 are independent files (T001 and T002 share `panel.spec.ts`, so write them in order); T008 needs T001 to T005; T009 needs T006, T007 and T005's pattern; T010 last. MVP is US1 plus US2 (T001 to T005, T008); US3 (T006, T007, T009) follows.

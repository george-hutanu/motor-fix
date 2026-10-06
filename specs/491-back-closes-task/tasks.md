# Tasks: Back closes the open task and keeps the page

**Input**: spec.md, plan.md (Design 1-7), quickstart.md
**Tests**: required (Constitution II): every test task is written first and fails before its implementation task. No FR id goes in source; FRs are named here only.

## Format: `[ID] [P?] [Story] Description`

User stories: US1 Back closes the open task (P1), US2 every other close leaves no trace (P1), US3 Back with unsaved changes asks first (P2). All files below exist; no new file.

## Phase 1: Tests first (failing)

- [ ] T001 [P] [US1] In `libs/overlays/src/overlays.spec.ts` add failing Jest specs: Back (`history.back()` then settle) closes only the top of two stacked tasks and hands `cancelled`, address and page unchanged, Forward reopens nothing (FR-001, FR-002, FR-006, SC-001); no entry is pushed or listened to when the document has no window (FR-008).
- [ ] T002 [P] [US2] In `libs/overlays/src/overlays.spec.ts` rewrite "changes neither the address nor the history" (line ~192): address unchanged, no marker left in `history.state`, one `history.back()` after a close reaches the page pushed before the open; cover X, Escape, outside, task `close(result)` and two stacked tasks closed by X (FR-004, SC-002); the opener's result arrives only after the popstate (FR-005); a close with the entry no longer current moves nothing (FR-007).
- [ ] T003 [P] [US1] [US3] In `libs/overlays/src/panel.spec.ts` add failing specs: Back on a sheet closes it; a drag past a third then one Back leaves the page (FR-002, FR-004); with a changed field Back shows the discard question and re-adds the entry so a second Back asks again, "Keep editing" returns, "Discard" closes with `cancelled`; an unchanged task closes at once (FR-003, SC-003).
- [ ] T004 [P] [US1] [US2] [US3] In `apps/web-e2e/src/overlays.spec.ts` add Playwright cases on `/cockpit` reached from `/`: `page.goBack()` closes one task and keeps page, scroll and focus; stacked tasks close top first; each other close then one `goBack()` reaches `/`; `goForward()` reopens nothing; discard question on Back (FR-001..FR-006, SC-001..SC-003); extend the existing "closes with …" cases (line ~119) with `goBack()` to the page before `/cockpit` (SC-005).
- [ ] T005 [P] [US1] [US2] In `apps/web-e2e/src/sheet.spec.ts` add cases at 390x844 and 320x640: Back closes the sheet; the drag then one `goBack()` reaches `/`; extend the "closes with …" case (line ~218) the same way (FR-002, FR-004, SC-001, SC-002).
- [ ] T006 [P] [US2] In `apps/web-e2e/src/sign-in.spec.ts` add: after the real sign-in navigates on its result, one `page.goBack()` returns to the page the dialog was opened from (FR-005, SC-004).

## Phase 2: Implementation

- [ ] T007 [US1] In `libs/overlays/src/overlays.ts` build the service's `BrnDialogService` from a child environment injector providing `DEFAULT_DIALOG_CONFIG` with `closeOnNavigation: false`, `Dialog` and `BrnDialogService`; update the comment that says it closes on navigation (plan Design 1; FR-001, FR-007). Makes the stacking part of T001 pass.
- [ ] T008 [US1] [US2] [US3] In `libs/overlays/src/panel.ts` give each panel a module-counter `entry`, push one same-address `history.pushState({ ...history.state, mfOverlay: entry }, '')` on open, listen to `popstate` (removed via `DestroyRef`): entry gone with a pending result closes with it, else Back runs `dismiss()` and re-pushes the entry if the discard question showed; route `close(result)` through a step back (`history.back()`, close on the popstate) only when `history.state?.mfOverlay === entry`, else close at once; no window means none of this (plan Design 2-5; FR-001..FR-008). Turns T001-T006 green.

## Phase 3: Verify

- [ ] T009 Run `nx test overlays`, `nx run overlays:typecheck`, Biome and the `web-e2e` overlay, sheet, sign-in and catalogue specs through `scripts/heavy.sh`; confirm the existing checks pass unchanged (SC-005).

## Dependencies

T001-T006 are independent files, all before T007-T008. T007 before T008 (T008's stacked Back needs the CDK not closing on popstate). T009 last. MVP: T001, T003, T007, T008 deliver US1 and US3; T002, T005 cover US2.

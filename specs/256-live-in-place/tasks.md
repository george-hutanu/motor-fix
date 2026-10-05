# Tasks: See live updates in place without losing my work

**Input**: `specs/256-live-in-place/spec.md`, `design.md`
**Level**: 1 (one-session). No plan.md: the layout is two files beside `Live` in `apps/web/src/app/dashboard/`, plus the frame, the shell texts and one Cockpit style.

## Phase 1: Tests first (red)

- [X] T001 [P] `apps/web/src/app/dashboard/live-in-place.spec.ts`: `reuse` keeps references (FR-001), `liveDraft` (FR-006), `liveRows` hold-and-release (FR-007), `LiveAnchor` keeps the first visible row (FR-008), `LiveChange` highlight and reduced motion (FR-009) and polite announcement (FR-010)
- [X] T002 [P] `apps/web/src/app/dashboard/live.spec.ts`: `liveResource` collapses a burst into one re-read (FR-002), keeps the value on a failed re-read and retries on the next event or after 60 s (FR-003), marks 404 gone (FR-004), merges by reference (FR-001)
- [X] T003 [P] `apps/web/src/app/dashboard/frame.spec.ts`: the test update changes the status line, raises no toast, and leaves an open dialog with typed text, focus and route as they were (FR-005, FR-011)
- [X] T004 [P] `apps/web-e2e/src/live.spec.ts`: with the dashboard's dialog open, the test update shows the status line in place; the dialog stays open, focus stays in it and the page does not navigate (FR-005, FR-011, SC-001)

## Phase 2: Implementation

- [X] T005 `apps/web/src/app/dashboard/live-in-place.ts`: `reuse`, `liveDraft`, `liveRows`, `LiveAnchor`, `LiveChange`, `LivePill` (the "changed meanwhile" and "no longer available" lines are the `shell.live.changed` and `shell.live.gone` texts each view shows)
- [X] T006 `apps/web/src/app/dashboard/live.ts`: `liveResource` with merge, silent failure and retry, gone, and one re-read at a time
- [X] T007 `apps/web/src/app/dashboard/frame.ts`: the status line for the test update, no toast; `libs/i18n/src/shell/{ro,en}.json`: `shell.live.*` texts; `libs/ui-cockpit/src/styles/cockpit.css`: `.mf-live-changed` highlight and the `--mf-motion-flash` token (the motion specs pin the token set and the keyframe count)

## FR → test

| FR | Test |
| --- | --- |
| FR-001 | live-in-place.spec.ts `reuse`; live.spec.ts liveResource merge |
| FR-002 | live.spec.ts liveResource burst |
| FR-003 | live.spec.ts liveResource failure and retry |
| FR-004 | live.spec.ts liveResource 404 |
| FR-005 | frame.spec.ts; web-e2e live.spec.ts |
| FR-006 | live-in-place.spec.ts `liveDraft` |
| FR-007 | live-in-place.spec.ts `liveRows`, `LivePill` |
| FR-008 | live-in-place.spec.ts `LiveAnchor` |
| FR-009 | live-in-place.spec.ts `LiveChange` |
| FR-010 | live-in-place.spec.ts `LiveChange`; frame.spec.ts status role |
| FR-011 | frame.spec.ts; web-e2e live.spec.ts |

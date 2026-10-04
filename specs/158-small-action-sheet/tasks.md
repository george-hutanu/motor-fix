# Tasks: Open small actions as a bottom sheet on a phone

**Input**: plan.md, spec.md, design.md, context.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/overlays/src/{overlays,task,panel}.ts`, `libs/ui-cockpit/src/styles/cockpit.css`, `libs/ui-cockpit/src/motion.adversary.spec.ts`, `apps/web-e2e/src/overlays.spec.ts`.

## Phase 1: Tests (red first)

- [X] T001 [P] [US1] Test: `libs/overlays/src/panel.spec.ts` (new) — with `(min-width: 768px)` not matching, `open()` of `dialog`, `drawer` and `drawer-wide` renders the panel with `data-side="bottom"`, the classes `spartan-sheet-content mf-overlay-sheet`, no `mf-overlay-dialog`/`mf-overlay-drawer*`, and an `aria-hidden` grip; matching, each keeps its own shape and no grip; a match change while open keeps the shape (FR-001, FR-002, FR-003)
- [X] T002 [P] [US2] Test: in `panel.spec.ts` — a grip drag of 100 px on a 300 px sheet sets the drag offset, its release leaves the task open and clears the offset; 101 px closes it with `cancelled`; a drag up keeps the offset at 0; `pointercancel` after 200 px leaves it open; with a changed field a long release shows the discard question and leaves the task open (FR-004)
- [X] T003 [P] [US3] Test: in `panel.spec.ts` — with a faked `visualViewport` (height 500, offsetTop 0, `innerHeight` 844) a `resize` sets `--mf-keyboard: 344px` and `--mf-visible-height: 500px` on the host and calls `scrollIntoView({ block: 'nearest' })` on the focused field inside the body; back to 844 sets `--mf-keyboard: 0px`; a dialog on a computer adds no listener; the listeners go when the task closes (FR-005)
- [X] T004 [P] [US3][US4] Test: in `panel.spec.ts` — the panel's styles cap the sheet at `calc(0.92 * var(--mf-visible-height, 100dvh))`, place it at `var(--mf-keyboard, 0px)` from the bottom, pad the body with `--mf-safe-bottom` and the sides with `--mf-safe-left`/`--mf-safe-right`, and add `--mf-safe-top` only for the right-hand drawer; the sheet focuses its dialog container, not the field (FR-006, FR-007)
- [X] T005 [P] [US1] Test: `libs/ui-cockpit/src/motion.adversary.spec.ts` — the kit pops `data-side="bottom"` sheets from `center bottom`; `phone.adversary.spec.ts` or a new kit spec — `.spartan-sheet-content[data-side="bottom"]` sits on the bottom edge, full width, top border and top radius only (FR-002, FR-008)
- [X] T006 [P] [US1–US4] Test: `apps/web-e2e/src/sheet.spec.ts` (new) — at 320 × 640 and 390 × 844: dialog, drawer and wide drawer open as a full-width sheet on the bottom edge, ≤ 92 % tall, grip 36 × 4 px in a 44 px row, no sideways scroll, X ≥ 44 px; at 767 px a sheet, at 768, 1024 and 1280 px the dialog and the drawers; X, outside and Escape close with `cancelled`, scroll kept, focus back on the opener; the page behind does not scroll; drag 25 % springs back, 40 % closes, a changed field asks; focus stays inside for 20 Tabs; a faked `visualViewport` of 500 px moves the sheet up and keeps the focused field in view; a 34 px bottom safe area keeps the last button above it; RO and EN; light and dark axe; reduced motion: no animations; the sample form task's validation and 409 message in a sheet (FR-001…FR-009)
- [X] T007 [US1] `apps/web-e2e/src/overlays.spec.ts` — the phone test ("the dialog keeps a 16 px gutter, drawers fill the width") is replaced by the sheet spec; the computer tests set a computer viewport where they assumed one (FR-010, FR-011)

## Phase 2: Implementation

- [X] T008 [US1] `libs/overlays/src/task.ts`: `PanelContext.sheet`; `libs/overlays/src/overlays.ts`: match `TABLET` at open, bottom-edge pane (FR-001)
- [X] T009 [US1] `libs/ui-cockpit/src/styles/cockpit.css`: `.spartan-sheet-content[data-side="bottom"]` geometry and its `mf-pop` origin (FR-002, FR-008)
- [X] T010 [US1][US3][US4] `libs/overlays/src/panel.ts`: sheet host bindings and styles (92 % cap, keyboard offset, safe areas, header without the top safe area), grip row (FR-002, FR-003, FR-006, FR-009)
- [X] T011 [US2] `libs/overlays/src/panel.ts`: grip drag — pointer capture, offset, spring, threshold → `dismiss()` (FR-004, FR-008)
- [X] T012 [US3] `libs/overlays/src/panel.ts`: `visualViewport` follow and focused field into view (FR-005)
- [X] T013 [US4] `libs/overlays/src/index.ts`: the usage note says a phone gets the sheet (FR-007)

## Phase 3: Review fixes

- [X] T014 [US2] Tests then code: a drag follows one pointer (a second `pointerdown` or another pointer id is ignored, `lostpointercapture` ends it); a long drag while the discard question shows only springs back, so Keep returns to the field; two stacked sheets — a drag closes only the top; the focused field is scrolled into view on a viewport resize, not on every pan (FR-004, FR-005, FR-007) — `libs/overlays/src/panel.spec.ts`, `libs/overlays/src/panel.adversary.spec.ts` (new), `libs/overlays/src/panel.ts`

- [X] T015 [US1][US3] PR tester lap 2: tests then code — the sheet fits an already-shrunk visible area when it opens; the sheet's own rule outranks the kit's bottom edge whatever the load order; the specs colocate as `panel.spec.ts` / `panel.adversary.spec.ts`; the close tests let a wheel scroll end before closing (the desktop dialog's intermittent scroll miss) (FR-005, FR-007) — `libs/overlays/src/panel.ts`, `apps/web-e2e/src/{overlays,sheet}.spec.ts`

- [X] T016 [US1] After ST-82 merged: the sign-in dialog is a sheet on a phone — `apps/web-e2e/src/sign-in.spec.ts` asserts it at 320 and 390 px; `accounts.ts`, `sign-in.spec.ts` and `tab-bar.spec.ts` wait for the panel, since the dialog container has no box around a fixed sheet (FR-001, FR-002)

- [X] T017 [US2] PR tester lap 3: the sheet's `[data-side]` rule had outranked the dragging rule, so a dragged sheet trailed the finger by the spring; a mid-drag e2e (no transition, the sheet at rest + pull) and the rule check came first, then the dragging rule matched the sheet rule's weight; the sign-in sheet check also taps outside and finds the page where it was (FR-004, FR-001)

## FR → test

| FR | Tests |
| --- | --- |
| FR-001 | T001, T006, T016 |
| FR-002 | T001, T005, T006, T016 |
| FR-003 | T001, T006 |
| FR-004 | T002, T006, T014 |
| FR-005 | T003, T006, T014 |
| FR-006 | T004, T006 |
| FR-007 | T004, T006, T014 |
| FR-008 | T005, T006 |
| FR-009 | T006 |
| FR-010 | T001, T007 (overlays.spec.ts dialog tests at 1280 px) |
| FR-011 | T001, T007 (overlays.spec.ts drawer tests at 1280 px) |

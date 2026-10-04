# Tasks: The shared dialog and right-hand drawer

**Input**: plan.md, spec.md, design.md, context.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `tsconfig.base.json`, `libs/i18n/src/shell/{ro,en}.json`, `libs/i18n/src/cockpit/{ro,en}.json`, `libs/ui-cockpit/src/lib/sample-page.ts`, `libs/ui-cockpit/src/lib/sample-page.spec.ts`.

## Phase 1: Setup

- [X] T001 `libs/overlays/` (new) Nx library: `project.json`, `jest.config.cts`, `tsconfig{,.lib,.spec}.json`, `stryker.config.json`, `src/test-setup.ts`, `src/index.ts`; path `@motor-fix/overlays` in `tsconfig.base.json`
- [X] T002 [P] `libs/i18n/src/shell/{ro,en}.json` — `overlay.close`, `overlay.discard.{question,discard,keep}` (FR-009, FR-010, FR-014)

## Phase 2: US1 + US2 — open, close, focus, shapes (P1)

**Independent test**: a task opens in each shape, closes three ways with `cancelled`, closes itself with a result, takes the first field's focus on a computer, gives it back to the opener, locks the page's scroll, is a modal dialog named by its title, and never touches the address.

- [X] T003 [US1] Test: `libs/overlays/src/overlays.spec.ts` (new) — X, Escape and a backdrop click each close with `cancelled`; the task's `close('saved')` hands `saved`; the opener gets the focus back; with a computer the first field has the focus, otherwise the dialog container; the html element is scroll-blocked while open and not after; `role="dialog"`, `aria-modal="true"`, `aria-labelledby` naming the title; the X is named by `shell.overlay.close`; `location.href` and `history.length` unchanged (FR-001, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-014)
- [X] T004 [US2] Test: in `overlays.spec.ts` — `dialog` uses the dialog surface, `drawer` and `drawer-wide` the right-hand sheet surface with `data-side="right"` and their width classes; the body is the scroll container (FR-002, FR-003)
- [X] T005 [US1] `libs/overlays/src/task.ts` (new): `OVERLAY_TASK`, `injectOverlayTask()`, `OverlayTask` (FR-006)
- [X] T006 [US1] `libs/overlays/src/panel.ts` (new): header, X, body, focus, closes, shape classes and styles (FR-002, FR-003, FR-005, FR-007, FR-008, FR-009, FR-013, FR-014)
- [X] T007 [US1] `libs/overlays/src/overlays.ts` (new): `Overlays.open` → Brn options per shape, result promise; exports in `index.ts` (FR-001, FR-004, FR-006, FR-016)

## Phase 3: US3 — the discard question (P2)

- [X] T008 [US3] Test: in `overlays.spec.ts` — after an `input` event, X/Escape/backdrop show the question (`role="alertdialog"`, the three shell texts) with the body hidden; keep and Escape return with the text kept; discard closes with `cancelled`; a backdrop click while asking does nothing; no question without a change, after `markUnchanged()`, with `confirmDiscard: false`, or on `close(result)` (FR-010)
- [X] T009 [US3] `libs/overlays/src/panel.ts`: the question (FR-010)

## Phase 4: US4 + US5 — stacking and loading (P3)

- [X] T010 [US4] Test: in `overlays.spec.ts` — a task opened from a task stacks; Escape and a backdrop click close only the top one; the focus returns inside the first (FR-011)
- [X] T011 [US5] Test: in `overlays.spec.ts` — a loader task shows the title, the X and a skeleton in an `aria-busy="true"` body at once; the task replaces it when the loader resolves, and its first field gets the focus on a computer (FR-012)
- [X] T012 [US4][US5] `libs/overlays/src/panel.ts`, `overlays.ts`: loader source and skeleton (FR-011, FR-012)

## Phase 5: The catalogue (FR-015)

- [X] T013 Test: `libs/ui-cockpit/src/lib/sample-page.spec.ts` — three buttons open the sample task as a dialog, a drawer and a wide drawer; the sample task has a labelled field, a done button that closes with a result shown in the last-result line, and a button that opens a second task (FR-015)
- [X] T014 `libs/ui-cockpit/src/lib/sample-task.ts` (new), `sample-page.ts`, `libs/i18n/src/cockpit/{ro,en}.json` `overlay.*` (FR-015)

## Phase 6: End to end

- [X] T015 Test: `apps/web-e2e/src/overlays.spec.ts` (new) — on `/cockpit` scrolled halfway: open the dialog, close by Escape, outside and X: address and scroll unchanged, the page does not scroll while open, focus back on the opener; 20 Tabs stay inside; first field focused; drawer from the right 480 px and wide 720 px at 1280 px; 320 px and 390 px: no sideways scroll, the dialog keeps its gutter, drawers fill the width; the discard question; stacking with Escape closing the top only; ARIA roles and names; RO and EN texts; axe clean in light and dark; reduced motion: no running animation (FR-001, FR-002, FR-003, FR-004, FR-005, FR-007, FR-008, FR-009, FR-010, FR-011, FR-013, FR-014, FR-015, SC-001, SC-002, SC-003, SC-004)

## Dependencies

T001 first. T003, T004, T008, T010, T011, T013 before T005–T007, T009, T012, T014. T015 after T014.

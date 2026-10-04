# Tasks: Shared saving, validation and errors for small actions

**Input**: plan.md, spec.md, design.md, context.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/contracts/src/index.ts`, `apps/api/src/problem.filter.ts`, `apps/api/src/problem.filter.spec.ts`, `libs/overlays/src/index.ts`, `libs/i18n/src/shell/{ro,en}.json`, `libs/i18n/src/cockpit/{ro,en}.json`, `libs/ui-cockpit/src/lib/sample-page.ts`, `libs/ui-cockpit/src/lib/sample-page.spec.ts`.

## Phase 1: Setup

- [X] T001 [P] `libs/i18n/src/shell/ro.json`, `libs/i18n/src/shell/en.json` — `form.field.{required,email,minlength,maxlength,pattern,invalid}`, `form.problem.{error,network,offline,validation_failed,not_found,conflict,internal_error,service_unavailable,maintenance,sign_in_required}`, `form.sending`, `form.close` (FR-010)

## Phase 2: US4 — the problem shape (P2, foundational)

**Independent test**: an exception with a code and field errors leaves the filter as a problem with the same `errors`; a malformed list is dropped.

- [X] T002 [US4] Test: `libs/contracts/src/problem.spec.ts` (new) — `fieldProblems()` keeps a list of `{ field, code }` strings and returns `undefined` for anything else (non-array, an item missing a string); `codeForStatus()` gives 400 `validation_failed`, 404 `not_found`, 409 `conflict`, 503 `service_unavailable`, other 5xx `internal_error`, else `error` (FR-008, FR-011)
- [X] T003 [US4] Test: `apps/api/src/problem.filter.spec.ts` — an `HttpException` whose body has `code` and `errors` sends both; without `errors` or with a malformed list the problem has no `errors` member (FR-011)
- [X] T004 [US4] `libs/contracts/src/problem.ts` (new), `index.ts` export; `apps/api/src/problem.filter.ts` passes `errors` and reads `codeForStatus()` (FR-008, FR-011)

## Phase 3: US1 + US2 — send once, validate (P1)

**Independent test**: nothing sent before the press; an invalid press shows messages, marks and focuses the first invalid field and sends nothing; a valid press sends once with a key, busy while it runs; success closes or confirms.

- [X] T005 [US1] Test: `libs/overlays/src/form.spec.ts` (new) — typing sends nothing; a valid press calls `send` once with the value and a UUID key; while pending, `state()` is `sending`, the `mfTaskSubmit` button has `aria-busy="true"` and `aria-disabled="true"` and further submits send nothing; on success `done` gets the result and the overlay task is marked unchanged; without `done`, `mf-task-done` shows its message with `role="status"` and its Close button closes the task with the result; an answer after the task is destroyed changes nothing (FR-001, FR-004, FR-005)
- [X] T006 [US2] Test: in `form.spec.ts` — an invalid press sends nothing, state `invalid`, `mf-field-error` shows the translated message for `required`/`email`/`minlength` (with the length) in RO and EN, the field is `aria-invalid` and the focus is on the first invalid input in DOM order; a revealed field hides its message once valid without a press; a field valid at the press shows nothing when it turns invalid until the next press (FR-002, FR-003, FR-010)
- [X] T007 [US1][US2] `libs/overlays/src/form.ts` (new): `taskSave()`, `TaskSave`; `libs/overlays/src/form-parts.ts` (new): `FieldError`, `TaskSubmit`, `TaskDone`; exports in `index.ts` (FR-001, FR-002, FR-003, FR-004, FR-005, FR-012, FR-014)

## Phase 4: US3 — failures keep the text (P1)

**Independent test**: each failure keeps the values, shows its message next to the button, field errors under their fields; a retry sends with the right key.

- [X] T008 [US3] Test: in `form.spec.ts` — `toProblem()`: a problem body is kept (with its `errors`), status 0 is `network`, or `offline` while `navigator.onLine` is false, a non-problem body is `error` with its status, a non-HTTP error is `error`; `mf-task-error` (`role="alert"`) shows the code's message (`conflict`, `internal_error`, `maintenance`), the general message for an unknown code, and the field message for a field error naming no control; field errors show under their fields, mark them invalid and focus the first, and clear when the field changes; the values are unchanged after every failure; a second press after a failure sends again with the same key for the same value and a new key for a changed value; after a success a new press uses a new key (FR-006, FR-007, FR-008, FR-009)
- [X] T009 [US3] `libs/overlays/src/form.ts`: `toProblem()`, failure handling, server field errors, key reuse; `form-parts.ts`: `TaskError` (FR-006, FR-007, FR-008, FR-009)

## Phase 5: The catalogue (FR-013)

- [X] T010 Test: `libs/ui-cockpit/src/lib/sample-page.spec.ts` — a button opens the sample form task as a dialog; the task has a required registration field, a server-answer choice (success, field error, conflict, server error, network) and an ending choice (close, confirm); a successful close shows the saved value in the page's line (FR-013)
- [X] T011 `libs/ui-cockpit/src/lib/sample-form-task.ts` (new), `sample-page.ts`, `libs/i18n/src/cockpit/ro.json`, `libs/i18n/src/cockpit/en.json` `form.*` (FR-013)

## Phase 6: End to end

- [X] T012 Test: `apps/web-e2e/src/task-form.spec.ts` (new) — on `/cockpit`: empty press shows the message under the field with the focus in it and no request; a valid press with a slow answer: the button is busy and ten more presses change nothing; success closes and the page line already shows the value; the confirmation ending shows Close; each failing answer (field error, 409, 500, network) shows its message next to or under the field with the text kept; retry with success saves; RO and EN; 320 and 390 px without sideways scroll; axe clean in the invalid and failed states, light and dark; reduced motion: the spinner does not move (FR-002, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-012, FR-013, SC-001, SC-002, SC-003, SC-004)

## Phase 7: Hardening

- [X] T013 Test: `libs/overlays/src/form.adversary.spec.ts`, `libs/contracts/src/problem.adversary.spec.ts`, `apps/api/src/problem.filter.adversary.spec.ts` (new, test-adversary) — Observable and throwing sends, nested and disabled controls, empty codes, inherited keys as statuses; `form.ts`: a server error for a disabled field shows next to the button, an empty code reads as none; `problem.ts`: own keys only (FR-004, FR-007, FR-008, FR-011)
- [X] T014 review fixes: a filter case for an object body without a message; the usage note names `hlmInput` for `aria-invalid`; design.md records `--mf-red-ink`; the catalogue's one-second unit wait removed (the e2e covers the saved line) (FR-002, FR-011, FR-013)

## Dependencies

T001 first. T002–T003 before T004. T005, T006 before T007; T008 before T009. T010 before T011. T012 after T011.

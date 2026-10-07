# Tasks: Typed-text step in the live end-to-end test

**Input**: Design documents from `/specs/586-live-e2e-typed-text/`

**Prerequisites**: plan.md, spec.md, quickstart.md (no research, data model or contracts: test-only change)

**Tests**: The change is the test. No setup or foundational phase: everything the test needs exists in `apps/web-e2e/src/live.spec.ts` and `apps/web-e2e/src/accounts.ts`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Include exact file paths in descriptions

## Phase 1: User Story 1 - A live update leaves a half-filled dialog alone (Priority: P1) MVP

**Goal**: one end-to-end check proving that the live test update lands on the garage dashboard while the open "Invită în echipă" dialog, its typed "Nume" text and the focus stay, with no reload and no invite sent.

**Independent Test**: the live describe passes in CI's `e2e` job (quickstart.md); each of the four FR-002 assertions is a separate expectation that would fail on its own.

- [ ] T001 [US1] Add the test "a test update changes the dashboard in place while a half-filled form dialog keeps its text and focus" to `apps/web-e2e/src/live.spec.ts` after the confirm-dialog test: open the garage dashboard with `openDashboard(page, ACCOUNTS.garage, '/app/garage')`, count `page.on('load')` from then, record `POST …/garages/:garageId/invites` requests, click "Invită în echipă", click into the dialog's "Nume" and `pressSequentially` a plain name, send the admin test update as the siblings do (`accessToken`, `accountId`, `POST /api/v1/admin/live/test`, status 202), then expect the `[role="status"]` line "Actualizare de test în direct" within 2 000 ms, the dialog visible, "Nume" with the typed value and focused, zero reloads and no invite request; close the context at the end.
- [ ] T002 [US1] Verify the file statically: `npx nx run web-e2e:typecheck` and `npx biome check apps/web-e2e/src/live.spec.ts` green (nodenext: a relative import carries `.js`).
- [ ] T003 [US1] Green proof: push the branch and read CI's `e2e` job (`.github/workflows/ci.yml`) for the live describe, or run quickstart.md's Playwright command locally under `scripts/heavy.sh`; the existing live checks (two dashboards, confirm dialog, driver isolation) still pass unchanged.

**Checkpoint**: SC-001 (suite one check larger and green), SC-002 (2 s bound), SC-004 (the ST-256 deferred bullet can be ticked).

---

## Dependencies & Execution Order

- T001 → T002 → T003, one file, no parallel opportunity.
- No other user story; no polish phase (nothing beyond FR-001..004 is owed).

## Notes

- FR → test mapping: FR-001 (dialog open, text typed and focused, admin update, status line within 2 s) and FR-002 (dialog still open, value exact, same field focused, zero document loads) are the T001 test's assertions; FR-003 (no submit, no invite POST) is its recorded-requests assertion and the closing of the context; FR-004 (test-only, siblings unchanged) is the diff itself, checked by T003.
- The test is the "failing test first" of Principle II: it fails whenever a live update closes the dialog, clears the field, moves focus or reloads (SC-003).

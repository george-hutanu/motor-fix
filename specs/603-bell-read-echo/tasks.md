# Tasks: Keep the bell's loaded rows when a read comes back live

**Input**: `specs/603-bell-read-echo/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `apps/web/src/app/dashboard/bell.spec.ts` — with two pages loaded, this tab reads a row on the second page and its `notification.read` echo arrives: both pages stay, in order, and the row stays read (FR-001, FR-002)
- [X] T002 [US1] Test: same file — another tab reads a row this tab shows on its second page: it is marked read with the event's time and both pages stay (FR-002)
- [X] T003 [US1] Test: same file — the reloaded first page is merged in front of the rows below it, and "Mai multe" still asks for the page after the last row shown (FR-001)
- [X] T004 [US1] Test: same file — a "mark all" elsewhere with the reloaded count 0 shows every row on every page as read (FR-003)
- [X] T005 [US1] Test: same file — the first-page reload fails: the rows stay and the event's row is still marked read (FR-001, FR-002)
- [X] T006 [US1] Same file: replace "starts the list again from the top on a read elsewhere", which encodes the reset this story removes (SC-002)

## Phase 2: Implementation

- [X] T007 [US1] `apps/web/src/app/dashboard/bell.ts`: on `notification.read`, `BellStore` marks the event's row read, reloads the count and, when the list is ready, merges the first page with `merge()` instead of replacing the list and its cursor; with the count at 0 it marks every row read (FR-001, FR-002, FR-003)

## Phase 3: Proof

- [X] T008 `npx nx run web:test`, `npm run typecheck` and `npm run lint` green (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `bell.spec.ts` › T001, T003, T005 |
| FR-002 | `bell.spec.ts` › T001, T002, T005 |
| FR-003 | `bell.spec.ts` › T004 |

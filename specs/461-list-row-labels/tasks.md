# Tasks: Phone list rows keep their column names

**Input**: `specs/461-list-row-labels/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [ ] T001 [US1] Test: `libs/ui-cockpit/src/lib/helm/table.spec.ts` — every table element carries its explicit role, and each cell of a row maps to its column's header by role (FR-001)
- [ ] T002 [US1] Test: `libs/ui-cockpit/src/styles/cockpit.css.spec.ts` — on a phone the header row is visually hidden (clipped, absolute) and never `display: none`; the other phone rules unchanged (FR-002)

## Phase 2: Implementation

- [ ] T003 [US1] `libs/ui-cockpit/src/lib/helm/table.ts` — explicit role on each directive's host (FR-001)
- [ ] T004 [US1] `libs/ui-cockpit/src/styles/cockpit.css` — phone header row visually hidden instead of removed (FR-002)

## Phase 3: Proof

- [ ] T005 `ui-cockpit` typecheck, lint and test green (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | table.spec.ts |
| FR-002 | cockpit.css.spec.ts, phone.adversary.spec.ts |

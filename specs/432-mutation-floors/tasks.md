# Tasks: Measured mutation floors for every project

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

Mutation runs happen only in the Mutation workflow on GitHub
(`gh workflow run mutation.yml --ref 432-mutation-floors -f projects=<p> -f full=true`).

## Phase 1: Setup

- [X] T001 Record the baseline: run 37215034382 scores and survivor lists in auto-run.md

## Phase 2: Tests first (red)

- [X] T002 [P] [US1] `scripts/mutation-setup.spec.ts`: every project `jest.config.cts` that Stryker reads names its `testEnvironment` without its preset (FR-001)
- [X] T003 [P] [US1] `scripts/mutation-setup.spec.ts`: no spec under `apps/` or `libs/` picks a bare `node` or `jsdom` environment in a docblock (FR-002)
- [X] T004 [P] [US1] `scripts/mutation-setup.spec.ts`: no component decorator in a mutated project reads a module constant for `styles` or `template` unless its line is silenced with a reason (FR-003)
- [X] T005 [P] [US3] `scripts/mutation-setup.spec.ts`: the Mutation workflow has a `full` dispatch input that skips the restored results and `--incremental` (FR-012), and its `timeout-minutes` carries its derivation (FR-009)
- [X] T006 [P] [US3] `scripts/mutation.spec.ts`: the summary row carries the project's duration in minutes (FR-009); entry points (`src/main.ts`) stay mutated and are tested with mocked dependencies (auto-run.md, phase 7–8 decision)
- [X] T007 [P] [US3] `scripts/mutation-setup.spec.ts`: `api` and `domain` keep `concurrency: 1`, and every floor is a number no lower than the last recorded floor (FR-007, FR-008)
- [X] T008 [P] [US2] `libs/contracts/src/problem.spec.ts`: `fieldProblems` answers undefined for a non-list value (kills problem.ts:25 ConditionalExpression)
- [X] T009 [P] [US2] `libs/contracts/src/audit-history.dto.spec.ts`: the instant pattern accepts zoned instants and refuses dates, zoneless times and short fields (FR-005, FR-006)
- [X] T010 [P] [US2] `apps/api/src/problem.filter.spec.ts`: an unknown error is logged; a list message is joined with "; " (FR-005)
- [X] T011 [P] [US2] `apps/api/src/bootstrap.integration.spec.ts`: the OpenAPI document is titled "MotorFix API", version "1" (FR-005)

## Phase 3: User Story 1 — every project gets a score

- [X] T012 [US1] `testEnvironment: 'jsdom'` in `apps/web`, `libs/ui-cockpit`, `libs/i18n`, `libs/overlays`, `libs/media` jest configs
- [X] T013 [US1] `apps/web/src/server/*.spec.ts`: docblock `@jest-environment @stryker-mutator/jest-runner/jest-env/node`
- [X] T014 [US1] `libs/overlays/src/form-parts.ts`: silence `ERROR_TEXT` (StringLiteral, compile-time metadata)
- [X] T015 [US1] Confirm `worker` is skipped with its line (FR-004, existing `hasSpecs` behaviour)

## Phase 4: User Story 3 — workflow

- [X] T016 [US3] `scripts/mutation.ts`: duration column; `apps/api/src/main.spec.ts`, `apps/mcp/src/main.spec.ts` cover the entry points
- [X] T017 [US3] `.github/workflows/mutation.yml`: `full` input
- [ ] T018 [US3] Commit, push, dispatch a full run of every project; record scores, survivors and durations (FR-010)

## Phase 5: User Story 2 — survivors of contracts, mcp, api

- [ ] T019 [US2] Kill or silence every survivor the full run lists for `contracts`, `mcp`, `api`; re-run those three in full until none is left (FR-005, FR-006)

## Phase 6: User Story 3 — floors and limit

- [ ] T020 [US3] Set each `thresholds.break` to `max(current, floor(score) - 5)` from the full run (FR-007)
- [ ] T021 [US3] Set `timeout-minutes` from the full run's job wall time (FR-009)
- [ ] T022 [US2] File one follow-up per project left with survivors in `deferred.md` (FR-011)

## FR → task map

| FR | Tasks |
|---|---|
| FR-001 | T002, T012, T018 |
| FR-002 | T003, T013 |
| FR-003 | T004, T014 |
| FR-004 | T015 (existing `hasSpecs` tests) |
| FR-005 | T008–T011, T019 |
| FR-006 | T009, T019 |
| FR-007 | T007, T020 |
| FR-008 | T007 |
| FR-009 | T005, T006, T021 |
| FR-010 | T018 |
| FR-011 | T022 |
| FR-012 | T005, T017 |

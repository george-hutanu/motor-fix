# Tasks: Removing a page or renaming a folder, workflow or script is never level 0

**Input**: `specs/675-size-not-trivial/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `.claude/scripts/level.spec.mjs` `classifyLevel` — the six story descriptions are `unsure`, not level 0 (FR-001, FR-002, FR-003)

## Phase 2: Implementation

- [X] T002 [US1] `.claude/scripts/level.mjs`: add remove, delete, drop, disable, page, screen, folder, directory, workflow, deploy to `NOT_TRIVIAL`; narrow `CODE_NAME` to helper, variable, function, method, constant, const, class (FR-001, FR-002)

## Phase 3: Proof

- [X] T003 `npm run test:harness` green; `node .claude/scripts/harness-eval.mjs --check` (SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001, FR-002, FR-003 | `level.spec.mjs` classifyLevel (six story phrases; existing expectations) |

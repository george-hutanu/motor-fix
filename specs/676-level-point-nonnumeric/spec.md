# Feature Specification: `level.mjs point` never crashes on a level that is not a number

**Feature Branch**: `676-level-point-nonnumeric`

**Created**: 2026-10-07

**Status**: Archived (2026-10-07)

**Input**: ST-676. With `{level: "abc", level_for: <target>}` in `.specify/feature.json`, `level.mjs point <target>` writes the file and then throws a TypeError (exit 1) while printing its one line.

Notion: ST-676 https://app.notion.com/p/3f0607bff0d28150b4c0f3bb24b6cc22 (Tech debt, Low, epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Deferred from ST-662, PR #134 lap 2, finding 9.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A hand-edited level does not crash `point` (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a feature.json whose `level` is `"abc"` (or `true`, or `""`, or `7`) for the target, **When** `level.mjs point <target>` runs, **Then** it exits 0 and prints `feature <target>, level 2 (default)`.
2. **Given** a valid level for the target, **When** `point` runs, **Then** it prints that level and its name, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `point` MUST print the level line only when `parseLevel(state.level)` is not null, and MUST print the default-level line otherwise, exiting 0. This is how `resolveLevel` already reads the level.
- **FR-002**: A valid level written as a numeric string (`"1"`) MUST print as that level, the same way `resolveLevel` reads it.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: A `level.spec.mjs` test for a non-numeric level fails before the change and passes after it.
- **SC-002**: `npm run test:harness` passes.

## Assumptions

- Level 1, because the story states the whole change (autonomous default).

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

The capability covers how `point` carries a level (678 and earlier). It did not cover a level that is not one of 0–3.

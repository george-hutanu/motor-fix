# Feature Specification: Removing a page or renaming a folder, workflow or script is never level 0

**Feature Branch**: `675-size-not-trivial`

**Created**: 2026-10-06

**Status**: Draft

**Input**: ST-675 — `level.mjs suggest` answers level 0 at 0.85 for "remove the documentation page from the app", "delete the changelog page", "rename the web app folder", "rename the assets folder", "rename the ci workflow file", "rename the deploy script".

Notion: ST-675 https://app.notion.com/p/3f0607bff0d28158acb2de7a594cc938 (Tech debt, Medium, epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Deferred from ST-662, PR #134 QA lap 2 (findings 2–8).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A change something outside the code reads is not called trivial (Priority: P1)

**Acceptance Scenarios**:

1. **Given** each of the six descriptions above, **When** `classifyLevel` reads it, **Then** it answers `unsure`, never level 0.
2. **Given** a rename of a name only the code reads ("rename the helper in the garage card"), **When** `classifyLevel` reads it, **Then** it still answers level 0.

### Edge Cases

- "remove the unused garages" and the other existing never-trivial phrases keep their answers.
- A risky word still outranks everything (level 2), as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `NOT_TRIVIAL` in `.claude/scripts/level.mjs` MUST include remove, delete, drop, disable, page, screen, folder, directory, workflow and deploy, so a description with a trivial word and one of them is `unsure`.
- **FR-002**: The rename rule's `CODE_NAME` MUST name only what the code alone reads: helper, variable, function, method, constant (`const`), class.
- **FR-003**: The six descriptions from the story MUST classify as `unsure`; every existing `classifyLevel` expectation MUST hold.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: `level.spec.mjs` asserts the six descriptions are not level 0; it fails before the change.
- **SC-002**: `npm run test:harness` passes.

## Assumptions

- Level 1: the story states the whole change (autonomous default; the Notion "boards" fact is the epic's rollup).
- `const` stays beside `constant` in `CODE_NAME` as its abbreviation (autonomous default).

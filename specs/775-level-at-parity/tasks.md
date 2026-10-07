---
description: "Tasks for ST-775 level_at parity between the two readers"
---

# Tasks: level_at parity between the two readers

**Input**: `specs/775-level-at-parity/` (plan.md, spec.md)

**Tests**: Required (Constitution II): the new stamps are added and proved red before the regex change.

## Phase 1: User Story 1 - One answer for a waiting level (P1)

**Goal**: an hour-24 `level_at` is no waiting level in both readers; accepted shapes and already-refused stamps keep their answers.

**Independent Test**: `npm run test:harness` passes; with only the tests applied, the hour-24 cases fail on the JS reader.

- [ ] T001 [US1] Add the nine refused stamps of scenarios 1 and 3 (`2026-10-06T24:00Z`, `T24:00:00Z`, `T24:00:00.000Z`, no zone, minute 60, second 60, offset `+24:00`, offset `+23:60`, trailing newline) to the parity block "a level_at without a zone is no waiting level, in both readers" in `.claude/scripts/level.adversary.spec.mjs` (both `jsPoint` and `pyPoint` drop the level), and the accepted shapes of scenario 2 (`Z`/`±hh:mm`, with and without seconds, 3- and 6-digit fraction, hour 23:59) asserted to keep the level in both readers (FR-002, SC-001, SC-002).
- [ ] T002 [P] [US1] Add hour-24 (refused) and hour-23 (accepted) rows to `cases` in "keeps the pointer and the level in step in the Python helper too" in `.claude/scripts/level.spec.mjs`, compared against `pointTo` like the existing rows (FR-002).
- [ ] T003 [US1] Run `npm run test:harness` on T001-T002 and record that the hour-24 cases fail red on main's regexes (SC-003).
- [ ] T004 [US1] Change the hour group of `LEVEL_AT` in `.claude/scripts/lib/feature.mjs` (line 146) from `\d\d` to `([01]\d|2[0-3])` and of `_LEVEL_AT` in `.specify/scripts/python/common.py` (line 154) to `([01][0-9]|2[0-3])`; other groups unchanged (FR-001).
- [ ] T005 [US1] Run `npm run test:harness` and `npx biome check` on the touched files; all green (SC-003).

## Dependencies

T001, T002 (parallel) -> T003 -> T004 -> T005. MVP is the whole story.

# Tasks: Zone-less level_at is no waiting level

**Input**: specs/677-zoneless-level-at/spec.md (level 1, no plan.md). One story, three files.

## Phase 1: User Story 1 - A waiting level without a zone is dropped by both readers (P1)

**Independent Test**: `npm run test:harness` runs the zone-less state through `pendingLevel` and through the Python-vs-`pointTo` parity test.

- [X] T001 [US1] Red first: in `.claude/scripts/level.spec.mjs`, in the test "lets a level sized for the next feature expire, and uses it once", assert `pendingLevel` is null for a fresh `level_at` with no zone (`2026-10-06T20:18:13` one minute old, and date-only `2026-10-06`) and still returns the level for a `Z` stamp and a `+02:00` offset stamp (FR-001, FR-003); add a fresh zone-less case `{ feature_directory: 'specs/001-old', level: 1, level_for: 'next', level_at: <fresh stamp with the trailing Z removed> }` to `cases` in "keeps the pointer and the level in step in the Python helper too", expecting `{ feature_directory: 'specs/002-new' }` from both helpers (FR-004, FR-002). Run it and see it fail.
- [X] T002 [US1] In `.claude/scripts/lib/feature.mjs` `pendingLevel`, return null when `level_at` does not end in `Z` or a `±hh:mm` offset, before `Date.parse` (FR-001, FR-003).
- [X] T003 [US1] In `.specify/scripts/python/common.py` `_pending_level`, return None under the same rule and drop the `tzinfo is None` fallback to UTC that becomes unreachable (FR-002, FR-003).

## Dependencies

T001 -> T002, T003 (T002 and T003 touch different files and can run in either order). Done when `npm run test:harness` is green (SC-001, SC-002).

---
description: "Tasks for ST-784 an impossible day in level_at is no waiting level in both readers"
---

# Tasks: an impossible day in level_at is no waiting level in both readers

**Input**: `specs/784-impossible-level-date/` (plan.md, spec.md)

**Tests**: Required (Constitution II): the new stamps are added and proved red before the `pendingLevel` change.

## Phase 1: User Story 1 - One answer for a waiting level stamped on a day the month does not have (P1)

**Goal**: a stamp on a day its written month does not have is no waiting level in both readers; last-of-month stamps in every accepted shape and already-refused stamps keep their answers.

**Independent Test**: `npm run test:harness` passes; with only the tests applied, scenario 1's cases fail on the JS reader, alone and in parity.

- [ ] T001 [US1] In the parity block "a level_at only one reader would accept…" of `.claude/scripts/level.adversary.spec.mjs`, add scenario 1's five impossible stamps (`2026-02-30T00:00Z`, `2026-04-31T00:00Z`, `2025-02-29T00:00Z`, `2026-02-31T00:00:00.000Z`, `2026-02-30T00:00+02:00`) each dropped at a fixed `now` one minute after the rolled instant (FR-001, SC-001); scenario 2's generated table of 4 dates (`2024-02-29`, `2026-02-28`, `2026-04-30`, `2026-01-31`) × 8 shapes (`HH:MM`, `HH:MM:SS`, `.sss`, `.ssssss` × `Z`, `+02:00`) each kept at stamp + 1 minute (SC-002); scenario 3's regressions (month `00`/`13`, day `00`/`32`, hour `24`, no zone, trailing newline) dropped (FR-003). Each case asserted in JS alone (`it`) and against Python (`pyIt`) (FR-002).
- [ ] T002 [US1] Run `npm run test:harness` on T001 and record that scenario 1's JS-alone and parity cases fail red on main while scenario 2 and 3 cases pass (SC-003).
- [ ] T003 [US1] In `.claude/scripts/lib/feature.mjs`, capture the year, month and day in `LEVEL_AT` (line 147: `(\d{4})-(\d\d)-(\d\d)`) and make `pendingLevel` return no level unless `new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d`; other groups, `_pending_level` in `common.py` and `level.spec.mjs` unchanged (FR-001, FR-003).
- [ ] T004 [US1] Run `npm run test:harness` and `npx biome check` on the touched files; all green (SC-003).

## Dependencies

T001 -> T002 -> T003 -> T004. MVP is the whole story.

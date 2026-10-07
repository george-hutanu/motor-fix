# Implementation Plan: an impossible day in level_at is no waiting level in both readers

**Branch**: `784-impossible-level-date` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/784-impossible-level-date/spec.md`

## Summary

A `level_at` whose day the month does not have (`2026-02-30T00:00Z`,
`2026-04-31T…`, `2025-02-29T…`) fits `LEVEL_AT`
(`.claude/scripts/lib/feature.mjs:147`), and `Date.parse` rolls it forward
(30 February reads as 2 March) while `datetime.fromisoformat`
(`.specify/scripts/python/common.py:167`) raises, so the JavaScript reader
sees a waiting level and the Python reader does not (FR-001). The fix is in
`pendingLevel` alone: the regex captures the written year, month and day, and
the stamp is no waiting level unless
`new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d` (a rolled day lands in
the next month, so the day-of-month differs; probed on this machine for the
three refused and two accepted dates). The written fields decide, so an
offset never moves the day (FR-003). `_pending_level` is unchanged: it
already refuses every impossible day. The harness parity block
(`level.adversary.spec.mjs`, "a level_at only one reader would accept…")
gains scenario 1's five stamps at a `now` one minute after the rolled
instant, scenario 2's 4 dates × 8 shapes at a `now` one minute after the
stamp, and scenario 3's regressions, each asserted in JS alone and in
Python (FR-002). No research, data model or contract: no unknowns, the one
entity is in spec.md "Key Entities", no interface.

## Technical Context

**Language/Version**: JavaScript, Node `>=24.0.0` (`package.json` `engines`), plain ESM with no build step (`.claude/vitest.config.ts`); Python 3, whatever `python3` is on PATH (the parity specs skip the Python side when `python3 --version` fails, `level.adversary.spec.mjs:549`). This machine: Python 3.9.6.

**Primary Dependencies**: none beyond the standard libraries (`RegExp`, `Date.UTC`, `Date.parse`; `re`, `datetime.fromisoformat`).

**Storage**: `.specify/feature.json` (a file; read, never written by this change).

**Testing**: vitest `^5.0.3` (`package.json` devDependencies), harness project `.claude/vitest.config.ts` (`include: **/*.spec.mjs`), run as `npm run test:harness` (`package.json` scripts). The Python reader is exercised from the same spec through `spawnSync('python3', …)` against `common.persist_feature_json` (`level.adversary.spec.mjs:555`).

**Target Platform**: the developer machine and CI's Checks job (Harness step).

**Project Type**: harness scripts (`.claude/scripts/`).

**Performance Goals**: N/A, one regex test and one `Date.UTC` per read.

**Constraints**: the change is in `feature.mjs` `pendingLevel` only, Python unchanged (context.md, Constraints); new parity cases sit at a fixed `now` in `level.adversary.spec.mjs`, since `level.spec.mjs`'s Python table stamps from `Date.now()` (context.md, Constraints; spec Clarifications); the stamp `/speckit-size` writes (`toISOString()`) stays accepted; the written fields decide, never the parsed instant (spec, Edge Cases).

**Scale/Scope**: one regex gains three capture groups, `pendingLevel` gains one line, and new cases join one existing describe block.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: the smallest design is three captures and one comparison in the function that already parses the stamp. No days-in-month table, no helper, no parser change, no Python change, no new dependency. Re-checked after design: unchanged.
- [x] **II. Test Discipline**: `/speckit-tests` adds the stamps to the parity block first; they fail on main (JS keeps the level for `2026-02-30T00:00Z` at `2026-03-02T00:01Z`) and pass after. Specs sit beside the scripts they cover (`.claude/scripts/*.spec.mjs`). No PostgreSQL, Redis or Playwright: nothing in the product changes.
- [x] **III. The Given Stack**: not touched (harness only).
- [x] **IV. One Repository, One Toolchain**: harness files in their existing places; Biome formats the `.mjs`.
- [x] **V. Rules Live in One Place**: the calendar rule lives once per language by necessity (`fromisoformat` already holds it for Python); the comment on `LEVEL_AT` names the other reader, and the parity spec keeps them in step.
- [x] **VI. PostgreSQL Is the Truth**: not touched.
- [x] **Notion choices**: none relied on; the task is a Tech debt item under Foundations with no architecture choice.

## Project Structure

### Documentation (this feature)

```text
specs/784-impossible-level-date/
├── plan.md              # This file
├── quickstart.md        # How to prove the parity
└── tasks.md             # /speckit-tasks output (not created here)
```

No `research.md` (no NEEDS CLARIFICATION), no `data-model.md` (the one entity,
the waiting level, is fully described in spec.md "Key Entities") and no
`contracts/` (no external interface).

### Source Code (repository root)

```text
.claude/scripts/
├── lib/feature.mjs                 # LEVEL_AT (line 147): capture (\d{4})-(\d\d)-(\d\d); pendingLevel: the day must survive Date.UTC
└── level.adversary.spec.mjs        # parity block (line 547): scenario 1, 2 and 3 stamps, JS alone and JS vs Python
                                    # (level.spec.mjs is untouched: its Python table stamps from Date.now(), so no fixed date fits there)
```

**Structure Decision**: no new file. The check joins the function that
already reads the stamp and the cases join the describe block that already
runs both readers, so a later divergence fails the suite where the existing
parity cases do.

## Design

- **Where the day is checked**: after the shape test, in `pendingLevel`, on
  the regex's captures, with `Date.UTC(y, m - 1, d)`: a day the month does
  not have rolls into the next month, so `getUTCDate()` differs from `d`
  (`2026-02-30` → 2, `2025-02-29` → 1, `2026-04-31` → 1; `2024-02-29`,
  `2026-01-31` keep their day). It knows leap years for free; a days-in-month
  table would restate the calendar. The captured fields are the written ones,
  so an offset neither rescues nor condemns a stamp (`2026-02-30T00:00+02:00`
  refused, `2026-03-01T01:00+02:00` kept).
- **Not in the regex**: a regex cannot know February's length by year, and
  Python's reader already refuses at parse time, so the two readers refuse
  at the same point for the same reason: the calendar.
- **Specs**: the parity block in `level.adversary.spec.mjs` gets, in its
  `jsPoint` / `pyPoint` shape: scenario 1's five stamps, each `dropped` at
  `now` = the rolled instant + 1 minute (`2026-03-02T00:01Z` for
  `2026-02-30T00:00Z`, `2026-05-01T00:01Z`, `2025-03-01T00:01Z`,
  `2026-03-03T00:01Z`, `2026-03-01T22:01Z`); a generated table of
  `2024-02-29`, `2026-02-28`, `2026-04-30`, `2026-01-31` in the eight shapes
  (`HH:MM`, `HH:MM:SS`, `.sss`, `.ssssss` × `Z`, `+02:00`), each `kept` at
  `now` = stamp + 1 minute; scenario 3's regressions (month `00`/`13`, day
  `00`/`32`, hour `24`, no zone, trailing newline) `dropped`. Each case runs
  in JS alone (`it`) and in Python (`pyIt`), as the block does today.
- **Unchanged**: `_pending_level`, what `setLevel` writes, the TTL, the
  one-minute slack, `level.spec.mjs`.

## Complexity Tracking

None: no violation to justify.

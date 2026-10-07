# Implementation Plan: level_at parity between the two readers

**Branch**: `775-level-at-parity` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/775-level-at-parity/spec.md`

## Summary

An hour-`24` `level_at` passes both readers' stamp shape, then `Date.parse`
reads it as the next day's midnight while `datetime.fromisoformat` raises, so
the JavaScript reader sees a waiting level and the Python reader does not
(FR-001). The fix is in the shape, not the parsers: the hour group of
`LEVEL_AT` (`.claude/scripts/lib/feature.mjs:146`) and `_LEVEL_AT`
(`.specify/scripts/python/common.py:154`) becomes `([01]\d|2[0-3])` /
`([01][0-9]|2[0-3])`, so hour 24 is no waiting level in both before either
parser runs, whatever a parser version accepts. The two harness specs that
already run both readers on the same stamps (`level.adversary.spec.mjs`,
"a level_at without a zone is no waiting level, in both readers";
`level.spec.mjs`, "keeps the pointer and the level in step in the Python
helper too") gain the spec's nine refused stamps and the accepted shapes
(FR-002). No research, data model or contract: the task has no unknowns, one
entity already described in the spec, and no interface.

## Technical Context

**Language/Version**: JavaScript, Node `>=24.0.0` (`package.json` `engines`), plain ESM with no build step (`.claude/vitest.config.ts`); Python 3, whatever `python3` is on PATH (`.specify/scripts/python/common.py`; the parity specs skip the Python side when `python3 --version` fails, `level.adversary.spec.mjs:549`). This machine: Python 3.9.6.

**Primary Dependencies**: none beyond the standard libraries (`RegExp`, `Date.parse`; `re`, `datetime.fromisoformat`).

**Storage**: `.specify/feature.json` (a file; read, never written by this change).

**Testing**: vitest `^5.0.3` (`package.json` devDependencies), harness project `.claude/vitest.config.ts` (`include: **/*.spec.mjs`), run as `npm run test:harness` (`package.json` scripts). The Python reader is exercised from the same specs through `spawnSync('python3', …)` against `common.persist_feature_json`.

**Target Platform**: the developer machine and CI's Checks job (Harness step).

**Project Type**: harness scripts (`.claude/scripts/`, `.specify/scripts/python/`).

**Performance Goals**: N/A, one regex test per read.

**Constraints**: both readers change together (context.md, Constraints); the stamp `/speckit-size` writes (`toISOString()`, a `Z` stamp with a 3-digit fraction) stays accepted; the day-of-month rollover is out of scope (spec, Clarifications); `_pending_level` keeps returning no remaining time.

**Scale/Scope**: two one-line regex edits and new cases in two existing describe blocks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: the smallest design is one group in each regex. No helper, no shared stamp list between the two specs beyond what the spec names, no parser change, no new dependency. Re-checked after design: unchanged.
- [x] **II. Test Discipline**: `/speckit-tests` adds the nine refused stamps and the accepted shapes to the two parity blocks first; they fail on main's regexes (JS accepts hour 24) and pass after. Specs sit beside the scripts they cover (`.claude/scripts/*.spec.mjs`). No PostgreSQL, Redis or Playwright: nothing in the product changes.
- [x] **III. The Given Stack**: not touched (harness only).
- [x] **IV. One Repository, One Toolchain**: harness files in their existing places; Biome formats the `.mjs`.
- [x] **V. Rules Live in One Place**: the stamp shape already lives in two places by necessity (one per language) and each comment names the other; this change keeps them identical in meaning and the specs keep them in step.
- [x] **VI. PostgreSQL Is the Truth**: not touched.
- [x] **Notion choices**: none relied on; the task is a Tech debt item under Foundations with no architecture choice.

## Project Structure

### Documentation (this feature)

```text
specs/775-level-at-parity/
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
├── lib/feature.mjs                 # LEVEL_AT (line 146): hour group → ([01]\d|2[0-3])
├── level.spec.mjs                  # "keeps the pointer and the level in step in the Python helper too": new cases
└── level.adversary.spec.mjs        # "a level_at without a zone is no waiting level, in both readers": new stamps
.specify/scripts/python/
└── common.py                       # _LEVEL_AT (line 154): hour group → ([01][0-9]|2[0-3])
```

**Structure Decision**: no new file. Each reader's regex changes in place and
the cases join the describe blocks that already run both readers, so a later
divergence fails the suite where the existing parity cases do.

## Design

- **Where the hour is limited**: in the regex, in both readers, not after
  parsing. `Date.parse` is the side that accepts too much, and refusing in
  the shape means neither reader's parser version decides the answer
  (`fromisoformat`'s accepted forms differ between Python versions, so a
  parser-level check would be the divergence again).
- **The hour group only**: `\d\d` for the hour becomes `([01]\d|2[0-3])` in
  `feature.mjs` and `([01][0-9]|2[0-3])` in `common.py`; minute, second,
  fraction and offset groups are unchanged, since both readers already refuse
  minute 60, second 60 and the offsets `+24:00` / `+23:60` (scenario 3), which
  the new cases assert as regressions.
- **Specs**: `level.adversary.spec.mjs` gets the nine refused stamps asserted
  on both sides (`jsPoint` drops the level, `pyPoint` drops the level) and
  the accepted shapes of scenario 2 asserted equal across readers, in the
  shape its `zoneless` / `zoned` loops already use; `level.spec.mjs` gets
  hour-24 and hour-23 rows in `cases`, compared against `pointTo` as the
  existing rows are. The `\n`-terminated stamp is one of the refused nine.
- **Unchanged**: `pendingLevel`'s and `_pending_level`'s bodies, what
  `setLevel` writes, the TTL and the one-minute slack.

## Complexity Tracking

None: no violation to justify.

# Auto run — 696-lifecycle-script

Description: ST-696 Lifecycle steps as one script call each: open, ready, merge.
Start: origin/main 50cdaaa; start commit 63e9733; draft PR #141.

## Size
Level 1 (set by hand: `level.mjs suggest` said unsure; one coherent harness unit, intent fixed by the brief).

## Specify
spec.md written; FR-001..FR-009; every unclear point answered as an autonomous default (spec Assumptions).

## Baseline measurement
Scratchpad `measure.mjs` over every transcript in ~/.claude/projects/-Users-georgehutanu-projects-motor-fix (326 jsonl files, this session excluded): distinct assistant turns whose tool calls belong to each recipe.
- open: 71 runs, 346 turns, median 5, max 25
- ready: 84 runs, 368 turns, median 3, max 25
- merge: 98 runs, 452 turns, median 2, max 46

## Tasks
tasks.md T001-T005.

## Tests (red)
lifecycle.spec.mjs failed to import (no lifecycle.mjs); lifecycle-wiring.spec.mjs 3 failed.

## Implement
Notion implement via connector (story Implementing, PR label in development). lifecycle.mjs green: 30 specs; full harness 1262 passed. Merged origin/main (ST-688 #140) and resolved speckit-auto Hand-off: kept 688's QA dispatch step, replaced the records/body/ready/qa recipe with one `lifecycle.mjs ready` call; tail step 5-6 now `lifecycle.mjs merge`. tail-handoff-wiring.spec.mjs updated to the new calls.

## Measured skill shrink (vs origin/main 3486742)
- speckit-auto/SKILL.md: 775 → 767 lines, 42492 → 42130 bytes (−8 lines, −362 bytes)
- speckit-git-commit/SKILL.md: 125 → 109 lines, 6959 → 5825 bytes (−16 lines, −1134 bytes)
- total: −24 lines, −1496 bytes

## Harden
artifact-lint clean after the Spec Delta was put in the `### Capability:` form; capabilities validate clean; doctor 16 ok; lint:harness ok. diff-audit findings are all in libs/ code merged from main, none in this change.

## Review
- Lap 1 (opus): code BLOCK (1 CRITICAL temp dirs, 2 HIGH token/decisions, 3 MEDIUM, 1 LOW), spec BLOCK (1 HIGH token, 2 MEDIUM, 1 LOW). All fixed tests-first in b3b7feb, c94ad03; `specs/**/finish-comment.md` git-ignored (the same line #139 adds).
- Lap 2 (opus): spec APPROVE; code BLOCK (comment failure after the log restore, untested temp failure path, ready ST, fixture leak). Fixed in 7871519.
- Lap 3 (opus): code APPROVE; two minor temp-dir leaks fixed in a3f6079. Harness 1270+ passed, doctor 16 ok, no hook script changed (no bless).

## Stop
PR #139 (687) is still open, so per the brief the run stops at review: merge origin/main once #139 lands, then retro, archive, PR body, `lifecycle.mjs ready`, QA dispatch, `NEXT: tail #141`.

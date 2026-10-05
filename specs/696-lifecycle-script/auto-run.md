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

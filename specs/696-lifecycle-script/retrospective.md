---
feature: 696-lifecycle-script
date: 2026-10-05
verdict: accepted
---

# Retrospective: 696-lifecycle-script

## Verdict

Accepted. This is judged against the nine requirements and the brief's measurement ask.

- **FR-001 to FR-008 are each covered by `.claude/scripts/lifecycle.spec.mjs`, with git, gh and Notion stubbed.** The tests cover:
  - the exact order of commands in `open`, `ready` and `merge`;
  - refusals coming from the real gates (the real `runGates` refuses `git push --force`);
  - the stop on Notion exit 3, with the events still left and the `--notion-done` rerun;
  - the stop when there is no gh token.
- **FR-009 is held by `lifecycle-wiring.spec.mjs` and `tail-handoff-wiring.spec.mjs`.**
- **Review took three laps on Opus (`auto-run.md`, Review).**
  - Lap 1: both reviewers blocked, with 1 CRITICAL, 3 HIGH, 5 MEDIUM and 2 LOW findings.
  - Lap 2: spec approved, code blocked. The block was one new HIGH that a lap-1 fix had introduced: a failed finish comment lost its log lines.
  - Lap 3: approved.
  - Every fix was test-first.
- **The harness passes on the merge with main: 1345 tests, and `doctor.mjs` reports 16 ok.**

## Evidence

- `node .claude/scripts/retro-evidence.mjs`: tasks 5 done, 0 open. The Spec Delta for `platform` is +9. Nothing was deferred.
- **Turns per step before the change**, measured over 326 transcripts:

  | Step | Runs | Turns | Median | Max |
  |---|---|---|---|---|
  | open | 71 | 346 | 5 | 25 |
  | ready | 84 | 368 | 3 | 25 |
  | merge | 98 | 452 | 2 | 46 |

  After the change, each step is one call when `NOTION_TOKEN` is set.
- **Skill shrink:** 1496 bytes and 24 lines removed from `speckit-auto` and `speckit-git-commit`.

## What went less well

- The gh-token fallback first trusted an empty `gh auth token`. That would have run gh as the work account. Only the review caught it.
- `run-state.mjs set --blocking` takes only a fixed list of conditions. Waiting on another PR is not one of them, so the wait for #139 is recorded in `auto-run.md` only.

## Open items

None.

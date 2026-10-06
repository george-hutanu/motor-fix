# Implementation Plan: The watcher counts PR QA runs on GitHub Actions

**Branch**: `602-watcher-counts-qa-runs` | **Spec**: [spec.md](./spec.md)

## Summary

`collect` in `.claude/scripts/watch.mjs` gains one injectable reader, `actionsRuns`,
defaulting (only with the real `gh`, as `carry` and `runOf` do) to
`gh run list --workflow pr-qa.yml --limit 50 --json databaseId,displayTitle,status`.
A pure `actionsQaRuns(runs)` keeps the runs not `completed` whose name matches
`^PR QA #(\d+) ` and returns `{ pr, run, status }`. A failed read is `[]`.

## Technical Context

- Node 24 ESM script, no dependencies; tests in vitest (`npm run test:harness`),
  `.claude/scripts/watch.spec.mjs` style with fake `gh` injections.
- Run name source: `.github/workflows/pr-qa.yml:56`.
- Unchanged: `holderOf`, `fixOf`, `dispatchPlan` signatures.

## Design

1. `qaRuns` in the report = laptop runs (`{ pr, pid }`, unchanged) followed by
   Actions runs (`{ pr, run, status }`). The header and `dispatchPlan({ qaLive: qaRuns.length })`
   then count both (FR-003).
2. Per row: `qaLive` = a laptop run for the PR, or an Actions run for it unless
   the row has a hand-off whose recorded run tests the PR's head (keeps ST-688's
   `waiting`) (FR-002). `dispatchPlan`'s `!r.qaLive` dedupe still applies.
3. `actionsRuns` throws or returns a non-array → `[]` (FR-004).

## Constitution Check

- I (simplicity): one reader, one pure parser, two lines in `collect`; no new file.
- II (tests first): scenario tests in `watch.spec.mjs` before the code.
- VII: draft PR #169, lifecycle as usual.

## Project Structure

- `.claude/scripts/watch.mjs` (code), `.claude/scripts/watch.spec.mjs` (tests).

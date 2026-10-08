# Bug Fix: PR QA blocks PRs on main's layout debt the baseline never measured

- **Slug**: 985-qa-layout-preexisting
- **Fixed**: 2026-10-08
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The tester now records which layout rules each sweep measured in full, per route, size, scheme and
language, and trusts a baseline's silence only there and only when the baseline ran the web code the PR
is based on. Everything else is main's: pre-existing, medium at most (FR-011).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `.claude/scripts/pr-test/layout.mjs` | modified | `measureLayout` returns `rules`: the rules run (type-scale only with tokens, tap-target with touch, focus-ring on desktop) minus any past the 20-per-page cap |
| `.claude/scripts/pr-test/sweep.mjs` | modified | `runSweep` returns `coverage`, `route\|viewport\|scheme\|lang` -> rules |
| `.claude/scripts/pr-test/findings.mjs` | modified | `coverageKey`; `markPreExisting` takes `coverage` and `stale`; new `trustBaseline` (options and note) |
| `.claude/scripts/pr-test/run.mjs` | modified | writes `layoutCoverage` to the report; marks the baseline stale when `git diff` from its commit to the PR base touches web code or cannot be read |
| `.claude/scripts/pr-test/baseline.mjs` | modified | `baseRuns` prefers a run of main whose commit the PR head also has; the newest run of main stays the fallback |
| `*.spec.mjs` beside each | added tests | below |

## Tests Added or Updated

- `findings.spec.mjs` "against what the baseline measured (ST-985)": covered combo stays high; an unmeasured rule (the #287 type-scale case), an unmeasured combo, no coverage and a stale baseline cap.
- `findings.spec.mjs` "trustBaseline (ST-985)": coverage passes on, web change and unreadable commit mark stale, the notes.
- `layout.spec.mjs` "rules measured (ST-985)": rules per page and viewport, a capped rule left out.
- `sweep.spec.mjs`: coverage keyed per route, size, scheme and language.
- `baseline.spec.mjs`: a run in the head's history before a newer one the PR lacks.

## Local Verification

- Commands run: the new specs red first (14 failed), then `npm run test:harness` -> 102 files, 2842 tests passed.
- Replayed #287's report (run 37828523124) against its baseline (run 37825345218): 127 high layout findings -> 0, with the note naming the baseline.

## Deviations from Assessment

- `markPreExisting` keeps its old reading when called without `coverage` (its existing callers in specs); `run.mjs`, its only production caller, always passes it through `trustBaseline`, where a report without coverage covers nothing.

## Follow-ups

- None. The first PR QA runs after the merge have no baseline with coverage, so their layout findings cap at medium until one exists.

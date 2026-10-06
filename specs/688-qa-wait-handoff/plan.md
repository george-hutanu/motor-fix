# Implementation Plan: No agent holds its context across the CI and QA wait

**Branch**: `688-qa-wait-handoff` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

Split the PR tester's one blocking call into its two halves. `dispatch.mjs`
gains `--no-wait` (dispatch, find the run, print the hand-off line, exit) and
`--run <id>` (dispatch nothing, read a finished run, download and judge it).
A small shared parser reads the hand-off line back. `watch.mjs` reads the line,
asks GitHub for that run's status only for a handed-off ready PR, and shows the
row `waiting` until CI and the run have finished, then offers `tail` at once.
The skills and AGENTS.md describe the dispatch, end, resume loop.

## Technical Context

**Language/Version**: Node.js ESM scripts (Node 24+, `engines` in package.json; v26 locally), no TypeScript in `.claude/`.
**Primary Dependencies**: Node built-ins and the `gh` CLI only; nothing added.
**Storage**: `specs/<feature>/handoff.md` (git ignored) and `.specify/.cache/qa-flows-<pr>.mjs` (git ignored).
**Testing**: vitest, `npm run test:harness` (`.claude/vitest.config.ts`); a fake `gh` on `PATH` for the dispatcher's two new modes.
**Target Platform**: the owner's macOS laptop and GitHub Actions (`pr-qa.yml` unchanged).
**Project Type**: harness scripts and skill prose.
**Performance Goals**: none beyond the story's: no agent alive across a CI or QA wait.
**Constraints**: `merge-gate.mjs`, `pr-lifecycle-gate.mjs`, `carry.mjs`, `run-state.mjs` and the eval cases unchanged (no `--bless-hooks`); PR #138's tail-dispatch paragraphs left as they are.
**Scale/Scope**: two scripts, their specs, one new tiny module, five Markdown files.

## Constitution Check

- I No bloat: the line parser is one function in `pr-test/qa-run.mjs` because two scripts read it (dispatch writes, watch reads); no class, no options object. `--no-wait` and `--run` reuse `main`'s existing steps. PASS.
- II Tests first, colocated: `dispatch.spec.mjs`, `qa-run.spec.mjs`, `watch.spec.mjs`, `tail-handoff-wiring.spec.mjs` red before code. PASS.
- VII Autonomous lifecycle: steps keep their order; the merge gate's conditions are untouched. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/688-qa-wait-handoff/
├── spec.md  plan.md  tasks.md  design.md  context.md  notion-sync.md  auto-run.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
.claude/scripts/pr-test/qa-run.mjs        # new: qaRunLine(), parseQaRun()
.claude/scripts/pr-test/qa-run.spec.mjs   # new
.claude/scripts/pr-test/dispatch.mjs      # --no-wait, --run <id>; list-then-sleep poll
.claude/scripts/pr-test/dispatch.spec.mjs # args, fake-gh runs of both modes
.claude/scripts/watch.mjs                 # qaRun on the row, runOf dep, waiting verdict
.claude/scripts/watch.spec.mjs            # fixOf rows for each CI × run state
.claude/scripts/tail-handoff-wiring.spec.mjs  # hand-off dispatches, tail resumes
.claude/skills/speckit-auto/SKILL.md      # Hand-off steps 4-5, The tail steps 1-4
.claude/skills/speckit-pr-test/SKILL.md   # RUN input; dispatch and review halves
.claude/agents/pr-tester.md               # RUN input; flows path; flow-not-run
.claude/skills/speckit-watch/SKILL.md     # tail row, waiting verdict
AGENTS.md                                 # lifecycle steps 4-6
```

## Design decisions

- **Line format** `- QA run: <id> · head <40-hex> · lap <n> · <url>`: one Markdown bullet the note already uses; the parser takes the last such line, so a fix lap may append or rewrite.
- **watch.mjs asks GitHub only when it matters**: `runOf(id)` (`gh run view <id> --json status,conclusion`, 30 s timeout, `null` on failure) runs only for a ready PR with a hand-off whose line names the PR's head, and only once its CI has finished. A `gh` failure reads as unfinished (FR-004).
- **The waiting rule sits before the quiet threshold** but after `held`: a live holder still wins, and a finished CI and run offer `tail` without waiting out 30 quiet minutes (FR-005). A PR with no checks past the threshold falls through to today's rule (FR-006).
- **`waiting` is a verdict, not a fix**: `dispatchPlan` already takes only `stale` rows, so nothing is dispatched for it; the board's header counts it.
- **Polling lists first, then sleeps**: a found run returns without a 5 s pause, and the fake-`gh` specs run in milliseconds.

## Complexity Tracking

None.

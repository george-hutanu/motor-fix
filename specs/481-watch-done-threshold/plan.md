# Implementation Plan: A grace period before watch removes a finished worktree

**Branch**: `481-watch-done-threshold` | **Date**: 2026-10-07 | **Spec**: spec.md | **PR**: #183

## Summary

Add `done: 30` to `DEFAULT_THRESHOLDS` in `.claude/scripts/watch.mjs`, and in
`fixOf` give `remove-worktree` only once the row has been quiet past
`thresholds.done`. `collect` already passes `thresholds[phase]` to `holderOf`,
so a `claude agent` lock and a claim on a done worktree become live within the
grace period with no further change; `parseStale` accepts `done` because it
reads the defaults' keys; `--gate` and `applyFixes` read `fix`, so both follow.

## Technical Context

**Language**: Node 24 ESM (`.mjs`), no new dependency.
**Testing**: vitest harness specs, `npm run test:harness` (`.claude/scripts/watch.spec.mjs`).
**Scope**: one script and its spec; no gate script in `.claude/hooks/registry.json` changes (watch.mjs is not a registered gate), so no bless.
**Constraints**: the verdicts of every non-done phase are unchanged (SC-002).

## Constitution Check

- I (simplicity): one key and one comparison; no new flag. Pass.
- Tests first (red-first): T001 before T002. Pass.
- VII lifecycle: draft PR #183 open, Notion Planning. Pass.

## Files

- `.claude/scripts/watch.mjs` — `DEFAULT_THRESHOLDS`, `fixOf` done branch, header usage comment.
- `.claude/scripts/watch.spec.mjs` — new and adjusted cases.
- `.specify/capabilities/platform.md` — at archive, via the Spec Delta.

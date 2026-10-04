---
name: "speckit-pr-test"
description: "Test and review a ready PR like a QA engineer before it merges: run the pr-tester subagent on the PR head in its own worktree, post its review and the agent-review commit status, move the Notion story to QA, and drive the fix-and-retest loop until agent-review is success or the repair cap blocks the run. Mandatory between 'mark ready' and 'merge' (Constitution VII); /speckit-auto and /speckit-review run it."
argument-hint: "<PR number> [--dry-run]"
compatibility: "Requires gh, Node 24, Playwright's Chromium, and Docker or local PostgreSQL/Redis binaries"
metadata:
  author: "george-hutanu"
  source: "project-local — QA step of the PR lifecycle"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

The first number is the PR. `--dry-run` posts nothing to GitHub or Notion: use
it for a PR another session owns.

## Why

CI proves the code compiles and its own tests pass. Nobody has yet booted the
change and used it. This step does, on every PR, before it merges, and its
verdict is a commit status the merge gate (`pre:bash:merge-gate`) and the Stop
gate (`stop:pr-lifecycle`) read. A push after it ran leaves the new head
without a status, so the test runs again.

## Procedure

1. **Notion → QA** (skip on `--dry-run`): `speckit-notion-sync qa`. The story
   and its timeline row stay QA for the whole loop.
2. **Lap**: `node .claude/scripts/run-state.mjs show --json` — the lap is
   `repair_iterations + 1`.
3. **Test**: invoke the `pr-tester` subagent (Agent tool,
   `subagent_type: pr-tester`) with `PR`, `LAP`, and `DRY_RUN` when asked. It
   runs `.claude/scripts/pr-test/run.mjs` (one heavy slot, teardown always),
   reviews the diff, and posts with `post.mjs`. Read its report; check the
   status yourself:

   ```bash
   gh api repos/{owner}/{repo}/commits/<sha>/status --jq '.statuses[] | select(.context=="agent-review") | .state'
   ```

4. **Success**: return to the caller, which merges on green CI
   (`gh pr checks <n> --watch`, then `gh pr merge <n> --merge`, then
   `speckit-notion-sync finish`).
5. **Failure**: the implementing agent fixes every blocking finding — a failing
   test first that reproduces it (`/speckit-tests` rules), then the fix — commits,
   pushes, and counts the lap:

   ```bash
   node .claude/scripts/run-state.mjs repair   # exits 1 past SPECKIT_MAX_REPAIR_ITERATIONS (5)
   ```

   Then go back to step 3 on the new head. Medium and low findings go to
   `specs/<feature>/deferred.md` unless they are one-line fixes, and every
   deferred bullet is filed as a Notion task (`speckit-notion-sync debt`).
   On success, file the lap's deferred findings the same way before merging,
   in the order `/speckit-auto`'s hand-off step 6 gives (commit the task URLs,
   one more lap; the last lap's new findings go to Notion directly).
6. **Cap reached** (`repair` exits 1): the run is blocked with
   `repair-loop-exceeded`. Run `speckit-notion-sync blocked` with the reason
   (open findings, laps used), comment the same on the PR
   (`gh pr comment <n> --body …`), leave `agent-review` at failure, and stop.
   The PR is never merged at the cap.

## Evidence

Copy `report.md`, `report.json` and one screenshot per viewport from the
tester's `--out` directory into `specs/<feature>/pr-review/lap<n>/`.

## Never

- Never post on, push to, or set a status on a PR you were asked to dry-run.
- Never set `agent-review` by hand; only `post.mjs` sets it, from a report.
- Never merge with `agent-review` missing or failing on the head commit.

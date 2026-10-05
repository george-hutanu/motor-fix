---
name: "speckit-pr-test"
description: "Test and review a ready PR like a QA engineer before it merges: run the pr-tester subagent, which tests the PR head on GitHub Actions (the PR QA workflow) and reviews it here, post its review and the agent-review commit status, move the Notion story to QA, and drive the fix-and-retest loop until agent-review is success or the repair cap blocks the run. Mandatory between 'mark ready' and 'merge' (Constitution VII); /speckit-auto and /speckit-review run it."
argument-hint: "<PR number> [--dry-run] [--local]"
compatibility: "Requires gh and Node 24; the boot and sweep run on GitHub Actions. --local also needs Playwright's Chromium and Docker or local PostgreSQL/Redis binaries"
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
it for a PR another session owns. `--local` boots the PR on this machine
instead of GitHub Actions: only when Actions is unavailable, or for a PR whose
tester change cannot yet run there. It waits for a `scripts/heavy.sh` slot.

## Why

CI proves the code compiles and its own tests pass. Nobody has yet booted the
change and used it. This step does, on every PR, before it merges. It starts
as soon as the PR is ready and runs beside CI, not after it: the two check
different things, and the merge gate waits for both. It leaves the unit and
end-to-end suites to CI's jobs rather than running them a second time. Its
verdict is a commit status the merge gate (`pre:bash:merge-gate`) and the Stop
gate (`stop:pr-lifecycle`) read. A push after it ran leaves the new head
without a status, so the test runs again.

## Procedure

1. **Notion → QA** (skip on `--dry-run`): `speckit-notion-sync qa`, which also
   sets the PR's one stage label to `QA`. Marking the PR ready already moved
   both to QA (there is no In review stage), so this normally reports
   `unchanged` and only catches a PR that skipped that step. The story and its
   timeline row stay QA for the whole loop.
2. **Lap**: `node .claude/scripts/run-state.mjs show --json` — the lap is
   `repair_iterations + 1`.
3. **Test**: invoke the `pr-tester` subagent (Agent tool,
   `subagent_type: pr-tester`) with `PR`, `LAP`, `DRY_RUN` when asked and
   `LOCAL` for `--local`. By default it dispatches `.github/workflows/pr-qa.yml`
   through `.claude/scripts/pr-test/dispatch.mjs` (`gh workflow run`, the
   run found by the nonce in its title, then `gh run watch`): a GitHub runner boots the PR head with PostgreSQL, Redis
   and MinIO from the PR's own compose file, sweeps the screens, runs its flows
   and the API calls (the unit and end-to-end suites are CI's), and uploads the
   report and screenshots as an artifact. The
   agent downloads it, reviews the diff against the spec and the constitution
   here, and posts with `post.mjs`; no secret or LLM step runs in CI. With
   `LOCAL` it runs `.claude/scripts/pr-test/run.mjs` on this machine instead
   (`--local`: one heavy slot, teardown always). QA in CI holds no heavy slot,
   so ready PRs are not queued behind the laptop. Read its report; check the
   status yourself:

   ```bash
   gh api repos/{owner}/{repo}/commits/<sha>/status --jq '.statuses[] | select(.context=="agent-review") | .state'
   ```

4. **Success**: return to the caller, which merges on green CI
   (`gh pr checks <n> --watch` with `run_in_background`, then
   `gh pr merge <n> --merge`, then `speckit-notion-sync finish`). The merge
   gate refuses while any check is failing, running or missing.
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

Copy `report.md` and `report.json` from the tester's `--out` directory into
`specs/<feature>/pr-review/lap<n>/`. Never commit the screenshots: they stay in
`--out`, outside the repo, and in the run's `pr-qa-<n>` artifact (kept 7
days); the report names them and gives the run's URL. A lap's images would
otherwise add hundreds of kilobytes to every clone for good, since a merge
keeps them in history; `.gitignore` refuses them under `pr-review/`.

## Never

- Never post on, push to, or set a status on a PR you were asked to dry-run.
- Never set `agent-review` by hand; only `post.mjs` sets it, from a report.
- Never merge with `agent-review` missing or failing on the head commit.

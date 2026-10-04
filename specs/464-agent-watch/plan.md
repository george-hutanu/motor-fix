# Implementation Plan: Watch every running agent and get stale work moving again

**Branch**: `464-agent-watch` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

## Summary

One harness script, `.claude/scripts/watch.mjs`, reads every worktree of the repository (`git worktree list --porcelain`), each one's `.specify/feature.json`, `.specify/run-state.json`, artifacts, lock, claim, last commit and changed files, plus one `gh pr list` for all PRs. It derives a phase, a holder, the last activity, a verdict and one fix per row. It prints a board (text or `--json`), applies the mechanical fixes with `--fix`, writes claims with `claim`, and computes a dispatch plan capped at 4 live QA runs and 2 other live agent fixes. A `/speckit-watch` skill runs it, claims and dispatches one background subagent per planned item, and is repeated with `/loop 15m /speckit-watch`. `scripts/heavy.sh` moves from 3 to 4 slots, and AGENTS.md, CLAUDE.local.md and `/speckit-auto` say how it fits.

## Technical Context

**Language/Version**: Node 24 (`node --version` v24.21.0; plain ESM `.mjs` like every script in `.claude/scripts/`), POSIX `sh` for `scripts/heavy.sh`.
**Primary Dependencies**: none new. Node's `child_process`, `fs`, `path`; `git` and `gh` CLIs (already required by `.claude/scripts/pr-test/post.mjs` and `merge-gate.mjs`); `ps` for liveness. Reuses `readState` from `.claude/scripts/run-state.mjs:61` and `DEFAULT_MAX_REPAIRS` (`run-state.mjs:46`).
**Storage**: none of its own. A claim is `<worktree>/.specify/watch-claim.json`, ignored by git through `.specify/.gitignore`.
**Testing**: harness vitest (`npm run test:harness`, `.claude/vitest.config.ts`, `include: ["**/*.spec.mjs"]`), a colocated `.claude/scripts/watch.spec.mjs` with real temporary git repositories and worktrees, `gh` and liveness injected.
**Target Platform**: the owner's macOS laptop (16 GB, 10 cores), 28 worktrees on 2026-10-04.
**Project Type**: harness CLI and skill.
**Performance Goals**: a pass under 30 s with 28 worktrees (SC-001): one `gh` call, a few `git` calls per worktree, no fetch.
**Constraints**: never force, never delete a branch, never touch the main worktree or a dirty tree; no network beyond one `gh pr list`; nothing written on a pass with nothing to do.
**Scale/Scope**: one script (~300 lines), one spec, one skill, three doc edits, one default in `heavy.sh`.

## Constitution Check

| Principle | Result |
| --- | --- |
| I No bloat | Pass. One script with pure functions for the rules and thin IO around them; no new dependency; no config file (thresholds are flags with defaults); `status.mjs` is not extended because it reads one checkout's `specs/`, not worktrees, PRs or processes. |
| II Tests | Pass. `watch.spec.mjs` is written first and red; one focused test per stated behaviour. |
| III Given stack | Not touched. |
| IV One toolchain | Pass. Harness vitest, Biome. |
| V Rules in one place | Pass. Phase, holder, stale and fix rules live only in `watch.mjs`; the skill calls it and never restates them. |
| VI PostgreSQL is the truth | Not touched. |
| VII Autonomous lifecycle | Supports it: the fixes are the lifecycle's own next steps (resume, QA, fix CI, merge, block). |
| Notion choices | None relied on. |

## Design

- **Worktrees**: `git worktree list --porcelain` from the current checkout; the first record is the main worktree. Records with `prunable` are skipped (pruned by `--fix`). A record whose basename matches `^mf-prtest-(\d+)-[0-9a-f]+-(\d+)$` is a PR-tester scratch worktree: it is a live QA run for PR `$1` when pid `$2` is a running process, and never a row.
- **Liveness**: `locked claude (agent|session) <name> (pid N …)` → `ps -p N -o comm=`; live when it exits 0 and the command contains `claude`. Injected in tests.
- **PRs**: `gh pr list --state all --limit 200 --json number,headRefName,state,isDraft,headRefOid,statusCheckRollup`; per branch the open PR wins, else the highest number. Rollup entries: a `StatusContext` with `context == "agent-review"` gives `agentReview` (`success`, `failure`, `pending`); every other entry gives `checks`: `fail` if any conclusion is FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED or STARTUP_FAILURE or any state is FAILURE or ERROR; else `pending` if any is not completed or PENDING or EXPECTED; else `pass`, or `none` when there are none.
- **Run-state phase → stage**: size, constitution, specify, context, clarify, plan, checklist, tasks, analyze → planning; tests → tests; implement, converge, harden → development; refresh, review, agent-context, retro, archive, hand-off → review; pr-test, qa → qa; merge → merging; anything else falls through to the artifacts.
- **Artifacts**: `feature_directory` from `.specify/feature.json`; else the branch when `specs/<branch>/` exists. Open tasks are lines matching `^\s*- \[ \]`, done ones `^\s*- \[[xX]\]`.
- **Activity**: `git log -1 --format=%cI`, `git status --porcelain -z` (mtime of each path that still exists), run-state `updated`; the newest wins and names its source (`commit`, `file`, `run-state`).
- **Remove-worktree guard**: PR `MERGED`, `git status` empty, holder not live, not main, and the worktree's `HEAD` equals the PR's `headRefOid` (so no commit made after the merge is lost).
- **Fixes applied by `--fix`**: `git worktree unlock <path>` (dead holder), `git worktree remove <path>` (no `--force`, so git itself refuses a dirty tree), `git worktree prune`. Each prints one line; a failing command prints its error and the pass continues.
- **Dispatch plan**: stale rows whose fix is `block`, `merge`, `fix-ci`, `rerun-qa` or `resume`, oldest activity first; `rerun-qa` while live QA runs + live `rerun-qa` claims < 4; the others while live non-QA claims < 2.
- **Claim**: `watch.mjs claim <path> <fix>` writes `{ "fix", "at" }`; read as live while `now - at` < the row's phase threshold.
- **CLI**: `node .claude/scripts/watch.mjs [--json] [--fix] [--stale phase=min[,phase=min]]`, `node .claude/scripts/watch.mjs claim <path> <fix>`. Exit 0 always for the board (it is a report); exit 1 on a usage error.
- **Skill** `/speckit-watch`: run `watch.mjs --fix --json`; for each planned item `claim`, then one background `general-purpose` Agent whose prompt enters the worktree (`EnterWorktree` with `path`) and does the fix's step of the AGENTS.md lifecycle: `resume` re-enters `/speckit-auto` at the run-state phase from `auto-run.md`; `rerun-qa` runs `/speckit-pr-test <n>`; `fix-ci` reads `gh pr checks <n>` and repairs on the branch; `merge` runs lifecycle step 7; `block` records `run-state.mjs set --status blocked --blocking repair-loop-exceeded` and `speckit-notion-sync blocked`. Reports the board in a few lines. A pass with an empty plan and no `--fix` action says so in one line.
- **heavy.sh**: `SLOTS="${HEAVY_SLOTS:-4}"` and its header comment; AGENTS.md "4 slots machine-wide", plus a short "Watching parallel work" paragraph with the QA rule; CLAUDE.local.md one command line and the skill in the maintenance list (context ratchet: the file stays within its baseline by tightening an existing line); `/speckit-auto` Run state section names the watcher as the reader of run-state.

## Project Structure

### Documentation (this feature)

```text
specs/464-agent-watch/
├── spec.md  plan.md  tasks.md  design.md  context.md  notion-sync.md  auto-run.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
.claude/scripts/watch.mjs          # new
.claude/scripts/watch.spec.mjs     # new
.claude/skills/speckit-watch/SKILL.md   # new
.claude/skills/speckit-auto/SKILL.md    # one paragraph
.specify/.gitignore                # watch-claim.json
scripts/heavy.sh                   # 4 slots
AGENTS.md, CLAUDE.local.md         # docs
```

**Structure Decision**: a single script beside `run-state.mjs` and `status.mjs`, which it reads from, like every other harness check.

## Complexity Tracking

None.

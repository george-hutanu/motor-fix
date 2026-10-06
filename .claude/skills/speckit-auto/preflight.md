# speckit-auto: preflight

Read before phase 1. The run order, contract and Hard Stops are in `SKILL.md`.

## Preflight

Run these before phase 1, in one batch:

- `git status --porcelain` — the tree MUST be clean. Uncommitted work is a hard
  stop: a run that spans phases cannot tell your changes from its own, and
  this repo is frequently mid-WIP on a ticket branch. **Unless** the user's
  invocation says `worktree`: then call `EnterWorktree` with the feature's
  short name first and run the whole pipeline there. The user's checkout stays
  untouched, a dirty tree stops being Hard Stop 2, and `ExitWorktree` at the
  end leaves the branch for them to inspect. This is the recommended way to
  run auto on a machine that is also being used.
- `git rev-parse --abbrev-ref HEAD` and `git rev-parse HEAD` — record the
  starting branch and commit.
- Read the card, `.specify/memory/constitution-card.md` (each
  principle and the gate that will fire at you), not the full constitution;
  the reviewers and the PR tester read that.
- `sh scripts/heavy.sh sh -c 'npm run typecheck && npm run lint && npm run test' > <scratchpad>/preflight.log 2>&1; echo "exit $?"; tail -n 40 <scratchpad>/preflight.log`
  — the repo MUST start green (on a failure, `grep -nE '✕|●|FAIL|Error'` the log
  rather than reading all of it). Through Nx, whose cache every worktree shares
  (`~/.nx/<workspace hash>`), a project unchanged since another worktree
  checked it is a cache hit, not a rerun. A red start is a hard stop; the run has no way to tell a pre-existing
  failure from one it caused. This is the one time the full suite runs; after
  this, verification is scoped to what changed.
- `node .claude/scripts/spec-drift.mjs --status` — know the drift baseline
  before you start moving code.

**Parallel runs.** The orchestrating session (the main checkout, which
dispatches the runs) keeps the watch scheduled as soon as two or more tasks or
worktrees are active at once: `CronList` first, so it never doubles up; if no
job runs `/speckit-watch`, schedule it every 15 minutes on off-minutes
(`4,19,34,49 * * * *`) and run one pass right away (speckit-watch, "Keeping
it scheduled"). A run isolated in a worktree never schedules it. The
orchestrating session sends each story's run as `subagent_type: task-runner`,
`run_in_background: true`, on the definition's model (Opus): it carries only
the tools a run uses, and
AGENTS.md and CLAUDE.local.md are already in its context, so the prompt names
the task, the worktree and "run `/speckit-auto` to its hand-off", never a
re-read of those files.

Then create the run log `specs/<feature>/auto-run.md` as soon as the feature
directory exists (phase 2 creates it), with the description, the start commit,
and one section per phase to append to.

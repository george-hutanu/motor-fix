# Tasks: Watch every running agent and get stale work moving again

**Input**: `specs/464-agent-watch/spec.md`, `plan.md` (level 2)

## Phase 1: Tests first

- [X] T001 Test: `.claude/scripts/watch.spec.mjs` — the pure rules: worktree records and PR-tester scratch worktrees parsed from porcelain output; holder from lock, pid liveness, claim age and the main worktree; PR summary from a status rollup (checks and `agent-review`); phase order (an open ready PR before run-state `done`); holder from a running PR-tester run and from a lock with no pid; stale against default and overridden thresholds; one fix per row in the stated order (an `agent-review` failure resumes); remove-worktree only when merged, clean, not live and at the PR head; dispatch plan within 4 QA and 2 other agent fixes (FR-002, FR-003, FR-005, FR-006, FR-008)
- [X] T002 Test: `.claude/scripts/watch.spec.mjs` — against temporary git repositories with worktrees: every row listed with its fields and the scratch worktree counted not listed; activity from commit, changed file and run-state; `--json` shape; `gh` failing leaves PR state unknown and the dispatch plan empty; `--fix` unlocks a dead lock, removes a merged clean worktree, prunes a deleted one, and leaves a dirty one, the main worktree and every branch alone; a pass with nothing to do writes nothing; `claim` writes an ignored claim that makes the holder live (FR-001, FR-004, FR-007, FR-009, FR-010)
- [X] T003 Test: `.claude/scripts/heavy.spec.mjs` — four commands hold four slots by default and a fifth waits (FR-012)

## Phase 2: Implementation

- [X] T004 `.claude/scripts/watch.mjs`: parsing, liveness, PR summary, phase, holder, activity, stale, fix, dispatch plan, board text and `--json` (FR-001–FR-006, FR-008, FR-010)
- [X] T005 `.claude/scripts/watch.mjs`: `--fix` and `claim` (`.specify/.cache/watch-claim.json`, already ignored) (FR-007, FR-009)
- [X] T006 `scripts/heavy.sh`: 4 slots by default (FR-012)
- [X] T007 `.claude/skills/speckit-watch/SKILL.md`: run, claim, dispatch one subagent per planned item with the fix's instructions, report, repeat with `/loop` (FR-011)
- [X] T008 Docs: AGENTS.md (4 slots, 4 QA runs at once, the watcher and `/loop`), CLAUDE.local.md (command and skill; one line of growth recorded with `context-audit.mjs --bless --allow-growth`), `/speckit-auto` Run state paragraph (FR-011, FR-012)

## Phase 3: Proof

- [X] T009 One real pass on this machine: `node .claude/scripts/watch.mjs` lists every worktree in under 30 s (SC-001)

## FR → test

| FR | Proof |
|---|---|
| FR-001, FR-004, FR-010 | `watch.spec.mjs` (temporary repositories) |
| FR-002, FR-003, FR-005, FR-006, FR-008 | `watch.spec.mjs` (rules) |
| FR-007, FR-009 | `watch.spec.mjs` (`--fix`, `claim`) |
| FR-011 | the skill file and one pass in this session |
| FR-012 | `heavy.spec.mjs`, AGENTS.md diff |

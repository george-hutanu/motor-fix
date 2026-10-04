# /speckit-auto run log — 464-agent-watch

- Description: ST-464 — Watch every running agent and get stale work moving again (owner, 2026-10-04), plus the owner's mid-run rule "4 qa can run in the same time, put this in docs".
- Notion: https://app.notion.com/p/3ef607bff0d281c89794da24167062c8 (ST-464, created In progress by this run, epic Foundations EP-1)
- Worktree: .claude/worktrees/agent-watchdog (EnterWorktree, base origin/main 0dfde6c); the main checkout (stack-spartan-ui, dirty) is untouched.
- Start commit: 0dfde6ced895204c611214192934b6a70083dc38, branch 464-agent-watch

## Preflight
- Tree clean (fresh worktree). `npm ci` under heavy.sh: exit 0.
- `npm run typecheck`: green. `npm run lint`: green. `npm test` (nx, 10 projects): green.
- `npm run test:harness`: 455 passed, 2 failed — `artifact-lint.spec.mjs` "diff-audit — the same default" both time out at 5000 ms. Re-run alone: same two time out; `diff-audit.mjs --check` alone takes 9.6 s at load average 12.13 on 10 cores. CI's Harness job is green on this same commit (run 37194100493, "checks / Harness: success"). Decision: load-induced timeout, not a red suite; continue and re-check at the end. Evidence: the run ids and timings above.
- spec-drift: no active feature at start.

## 0. Size
- level 2 (feature): the intent needed settling (phase rules, liveness signal, fix set, caps). `level.mjs set 2`.

## 1. Constitution
- v1.5.0, no placeholders. Principle I first; VII lifecycle applies (draft PR, push, ready, QA, merge).

## 2. Specify
- spec.md written; 5 clarifications self-answered (liveness from worktree lock pid + `claude` comm; QA runs from `mf-prtest-*` scratch worktrees; PR state outranks run-state; heavy.sh slots 3 → 4 so 4 QA runs can run; claims stop double dispatch).

## 3. Org context
- The org-researcher subagent got no Notion tools (its allowlist names other connector ids than this session's `828510aa…`), so it wrote `[UNAVAILABLE: notion]`. The run's own session had already read ST-464, ST-434 and EP-1, and context.md was written from those. No contradiction; the owner's "4 QA at once" is newer than the 3-slot limit.

## 4. Clarify
- spec-challenger raised 8 points; 5 answered as clarifications (an open ready PR outranks run-state done; agent-review is not a check, and its failure means resume; a live PR-tester run holds its row; claim at `.specify/.cache/watch-claim.json`, already ignored; no dispatch with the PR state unknown). The other 3 were applied as remediation: `block` dropped (run-state.mjs repair already blocks), phase → stage table written out, a lock with no pid counts as live, the cap of 2 counts only the watcher's claims.

## 5–8. Plan, checklist, tasks, analyze
- plan.md: one script, one skill, docs; no new dependency; no Complexity Tracking. Checklist: 16/16. tasks.md: 9 tasks. `artifact-lint.mjs`: 0 errors, 0 warnings (Jev lane unavailable: no key).
- Draft PR #29 opened at the first commit (792c786).

## 9. Tests (red)
- `watch.spec.mjs` (40 tests) fails to load: `watch.mjs` does not exist. `heavy.spec.mjs` "has four slots by default…": 1 failed (default 3). Red: 41.

## 10–11. Implement, converge
- `watch.mjs`, `speckit-watch` skill, `heavy.sh` 4 slots, AGENTS.md, CLAUDE.local.md (+1 line, recorded with `context-audit --bless --allow-growth`), speckit-auto run-state note. 52/52 green.
- Real pass on this machine: 30 worktrees in 7.1 s, 0 stale, 14 merged clean worktrees with `remove-worktree`, 7 merged worktrees left alone (uncommitted changes or a live holder). No `--fix` run against the real worktrees in this run.
- Commits e18eddf (watcher), db46152 (slots and docs). Converge: every FR implemented; nothing appended.

## 12. Harden
- test-adversary: `watch.adversary.spec.mjs`, 186 tests, 25 failed at first. Every removal and lock safety test passed. Fixed in watch.mjs: heads that are both missing compare as "remove" (now never); the watcher's own worktree read as `none` (now live); gh returning a non-array or null rows threw (now unknown/skipped); `--stale` accepted `a=1=2` and prototype keys; a non-string `feature_directory` threw; files inside untracked directories and symlinks; pid 0; exit 0 outside a repo; `claim` on a missing path. Fixture names renamed off real feature numbers.
- code-reviewer: 1 HIGH (no test that a live or hand lock survives `--fix`) — test added. MEDIUM fixed: failed `git status` read as clean (now null, never clean; vanished paths skipped); `gh --limit` 200 → 1000 with a comment; liveness by `ps -o command=` so an npm install counts; header narrowed to sequential passes. Decisions: dead scratch worktrees stay unshown (comment says why); the `rollup` test helper kept (readability), declined.
- spec-reviewer: 1 HIGH (text board lacked path, feature, activity source) — added. MEDIUM fixed: fixture feature numbers; `--dry-run` dropped from the skill; plan/T008 now say the context baseline was blessed (ST key removed from the reason). LOW fixed: pending agent-review no longer means rerun-qa; dead-lock release keyed on holder; exports dropped; skill cost wording; agent-review matched by context or name.
- Mutation: harness scripts carry no Stryker config and mutation never runs locally (owner rule); not run.
- 227/227 watcher tests; `diff-audit.mjs` 0 errors, 0 warnings; `artifact-lint.mjs` 0/0. Repair laps: 1. Commit 854163c.
- Real pass after the fixes: 20 worktrees in 2.5 s; 1 stale — `archive-050` (chore-archive-050-cockpit-theme), no PR, no agent, quiet 198 min, plan `resume`. Not dispatched from this run (another task's work); reported.

## 13. Ticket refresh
- ST-464: 0 comments. No new evidence.

## 15. Agent context
- The managed CLAUDE.local.md line names the active plan (421). With several features in flight, pointing it at this harness feature would mislead the others; left unchanged.

## 16. Retrospective evidence
- `retro-evidence.mjs --since 0dfde6c --jev`: 9/9 tasks, 12 requirements, 4 commits, 18 files +2981 −8, Spec Delta platform +12, 0 deferred. Jev lane unavailable (no key), so no suggested verdict. `instincts.mjs triggered`: none.

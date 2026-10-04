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

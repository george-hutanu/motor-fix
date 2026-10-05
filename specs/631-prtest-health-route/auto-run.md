# Auto run: 631-prtest-health-route

Description: see spec.md Input. Start commit: c2fb3a3 (origin/main), branch `fix-prtest-health-route`, worktree `.worktrees/fix-prtest-health-route` (EnterWorktree refused; absolute paths). PR #111, Notion ST-631.

## Preflight
- No open PR (#103, #107, #109) touches `.claude/agents/pr-tester.md`, `.claude/skills/speckit-pr-test`, `.claude/scripts/pr-test`.
- Full typecheck/lint/test not rerun: the change is harness-only (`.claude/`), so `npm run test:harness` plus doctor and harness-eval are the scoped verification; CI runs the rest on the merge result.

## Size
- Level 1 (one session): the intent is defined (routes read from the controller), no design choice beyond where the helper lives. Phases: specify, tasks, tests, implement, harden, review, retro evidence.

## Autonomous decisions
- Helpers live in `services.mjs` beside `waitForHttp` (no new module; Principle I).
- Helpers return the Response (flows already use `fetch`).
- Org context, clarify, plan, checklist, analyze skipped by level 1.

## Tests (red first)
- 4 failing before implementation (services.spec.mjs x2, qa-in-ci.spec.mjs x2); the bare-route guard passed already (no source spelled it; the agent doc left the liveness route unnamed).

## Implement
- HEALTH + apiHealth in services.mjs; run.mjs reads HEALTH and passes health/ready to the flows; pr-tester.md §2/§3 and the pr-qa.yml comment name both routes.
- npm run test:harness: 45 files, 953 tests passed. harness-eval --check: 75/75. doctor: 16 ok, 0 failures. No gate script touched, no bless.

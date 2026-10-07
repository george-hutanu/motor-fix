# Auto run — 481-watch-done-threshold

- Description: ST-481 (Medium) "watch.mjs's done phase has no stale threshold".
- Start: branch 481-watch-done-threshold at 19877828 (origin/main); worktree run, dispatched by the orchestrating session.
- Preflight: tree clean; full typecheck/lint/test skipped as the change is harness-only and CI runs it on the merge result; `npm run test:harness` run instead before the first edit.

## Phases

- size: level 2 (notion suggest, 0.80; owes spec, plan, tasks).
- specify/context/clarify: written inline from the Notion story (one fetch); 3 self-answered questions in spec Clarifications (evidence: story text, watch.mjs holderOf/fixOf). Phase agents not used to keep the run small (owner asked to minimise tokens).
- design: no screens (design.md).
- plan/checklist/tasks/analyze: plan.md, tasks.md; analyze inline: every FR maps to T001/T002, no CRITICAL.
- notion: start, draft PR #183, PR link written.
- tests: 3 red cases in watch.spec.mjs (FR-001..FR-004), 2 removal fixtures made quiet 120 min; red proven (3 failed, 100 passed).

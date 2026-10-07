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
- implement: `done: 30` in DEFAULT_THRESHOLDS; fixOf removes a merged worktree only when quiet > done threshold (same `<=` boundary as the other phases); holderOf picks up the threshold through collect unchanged. Adversary spec updated to the new contract (defaults, `done=10` now accepted, boundary test for done); speckit-watch SKILL step 2 names the grace period. Harness 1909/1909, doctor 0 failures, harness-eval 86/86.
- converge: nothing unbuilt (FR-001..FR-004 each covered).
- harden: one comparison and one key; no dead code, no new export.
- review: spec-reviewer APPROVE, code-reviewer APPROVE; 1 MEDIUM (task id in a comment and 4 test titles) fixed in one lap.

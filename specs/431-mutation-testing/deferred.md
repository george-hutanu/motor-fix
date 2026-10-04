# Deferred: 431-mutation-testing

Real findings that are not this change.

- Resolved by `main` (b965391, eval fixture repos; 48/48 after merging it): harness-eval below its floor (42/45 after this branch, 41/46 on `main`): `blocks-deleting-a-requirement-token` still targets `apps/scanner`, and the two `agent-model-router` cases fail — `.claude/evals/cases/config-protection.json`, `.claude/evals/cases/agent-model-router.json`. Pre-existing; none of their gates is touched here. (spec-reviewer #4)
- Stale harness references to the old `apps/server` / `apps/scanner` layout outside the mutation path: `.claude/scripts/diff-audit.mjs:163-173`, `.claude/agents/code-reviewer.md:77`, `.claude/skills/speckit-auto/SKILL.md:248`, `.claude/skills/speckit-implement/SKILL.md:296`, `.claude/skills/speckit-tests/SKILL.md:83` (`npm run test -w …`).
- `org-researcher` subagent cannot reach Notion in this session: its tool list names other connector ids than the session's (`mcp__828510aa-…`).

## Decided, not deferred

- spec-reviewer #1 (no `TS_NODE_COMPILER_OPTIONS` in `test:mutation`): Jest loads `jest.config.cts` natively on Node 24 and ts-jest compiles with each project's `tsconfig.spec.json`, so the ts-node options the inferred `test` target sets are not used; confirmed independently by code-reviewer. The draft PR's CI runs all 8 projects.
- code-reviewer #2 (shared database under parallel runners): `concurrency: 1` for `api` and `domain` now; per-runner databases keyed on `STRYKER_MUTATOR_WORKER` are left to the follow-up task if the serial runs are too slow.

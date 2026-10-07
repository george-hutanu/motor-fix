# Auto run — 784-impossible-level-date

Description: ST-784 (Tech debt from ST-775, Medium) — a level_at whose day the month does not have (2026-02-30T00:00Z) fits LEVEL_AT and Date.parse rolls it forward while Python's fromisoformat refuses it; pendingLevel refuses it so both readers agree. https://app.notion.com/p/3f2607bff0d28171bff8cc31c7d100e8
Start commit: ec74ab0654afa31c0e6bb27e0b56bd7a2c5ea933 (worktree .worktrees/784-impossible-level-date, branch 784-impossible-level-date).

## Phases
- 2 specify: phase agent (fable); before_specify branch hook skipped (branch exists); Notion task fetched, no comments; probed both readers (Python refuses 02-30/04-31/2025-02-29, accepts 2024-02-29; JS parses all four; month 00/13 and day 00/32 refused by both); spec.md + checklists/requirements.md (all pass); 2 FRs; feature.json pointed; level check: see below.
- 2 specify: level check: level 2 unchanged (fr-count 2, clarification clear, contract clear, projects clear). after_specify hooks (notion sync start, design check, git commit) left to the caller: no commit, no PR in this phase.

## Preflight
- Start ec74ab06 (= origin/main). origin/main does not fix it: `LEVEL_AT` in .claude/scripts/lib/feature.mjs:147 checks shape only, Date.parse rolls 2026-02-30 forward.
- Full-suite preflight not rerun: worktree fresh from green main, npm ci done; pre-commit affected run was green (no product project touched).
- Size: level 2 (notion facts: boards rollup, brief not found).
- Notion start: ST-784 → Planning. Draft PR #191 (labels planning, bug, scope: harness); `pr 191` linked.

## Phase 3 — context
- org-researcher: success, 0 contradictions, 0 open decisions.

## Phase 4 — clarify
- spec-challenger: 4 findings, each answered with its recommendation: (1) Spec Delta modifies 677-FR-003 → FR-003; (2) scenario 1 `now` = rolled instant + 1 min, scenario 2 = stamp + 1 min; (3) scenario 2 is a 4×8 generated table; (4) JS reader asserted alone as well as in parity. level check: 2 kept; capabilities validate clean.

## Phase 5 — plan
- plan.md and quickstart.md written (model: 775); fix is in pendingLevel: LEVEL_AT captures y/m/d, refused unless `new Date(Date.UTC(y, m-1, d)).getUTCDate() === d` (probed: 2026-02-30, 2026-04-31, 2025-02-29 false; 2024-02-29, 2026-01-31 true); Python unchanged; cases go to level.adversary.spec.mjs parity block at a fixed now. No research/data-model/contracts. before_plan design check already done (design.md kept); agent-context hook run.

## Phase 6 — checklist
- checklists/parity.md: 10 items, all checked against spec.md and plan.md, no gap found, no spec or plan edit needed.

## Phase 7 — tasks

specs/784-impossible-level-date/tasks.md: 4 tasks, one story (tests first, red proof, pendingLevel day check, green run); analyze left to phase 8.

## Phase 8 — analyze
- artifact-lint --check: 0 errors, 0 warnings; tasks cover FR-001..003; no remediation.

## Phase 9 — tests
- 38 JS + 38 Python cases added to the parity block of level.adversary.spec.mjs; red on main: 5 failed (scenario 1, JS alone) | 221 passed.

## Phase 10 — implement
- LEVEL_AT captures y/m/d; `parseLevelAt` refuses a month outside 1–12 or a day past the month's last (Date.UTC(y, m, 0)). Python unchanged. Harness 2065/2065 green, biome clean, doctor 0 failures.

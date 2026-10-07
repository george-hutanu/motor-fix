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

## Phases 11–14 — converge, harden, review
- Converge: all 4 tasks done, nothing unbuilt. diff-audit and artifact-lint clean.
- test-adversary (opus): 47/48 new cases passed; year `0000` diverged (JS kept, Python refuses year 0) → `parseLevelAt` also requires year ≥ 1; its cases folded into the existing parity block (spec-reviewer flagged the separate file as duplicate helpers), file not committed.
- code-reviewer: APPROVE, 1 MEDIUM (CLAUDE.local.md lost its SPECKIT markers) → markers restored. spec-reviewer: APPROVE, same MEDIUM + the duplicate file → both fixed. No CRITICAL/HIGH; no re-review needed. Repair laps: 1.

## Phases 13, 15–17
- Refresh: ST-784 re-read by spec-reviewer (no comments, scope unchanged) — no new evidence.
- Agent context: CLAUDE.local.md managed block points at this plan; no growth.
- Retro evidence: 9 commits since ec74ab06; jev lane unavailable, no suggested verdict; no retrospective written (verdict stays the owner's).
- Archive: Spec Delta merged into platform (+2, ~677-FR-003); status Archived. Harness 2095/2095 green.

## Final Report
- PR #191 ready at 07105ed; labels QA, bug, scope: harness, EP-1. Notion ST-784 → QA.
- Commits: fix (pendingLevel calendar check + year ≥ 1), specs/archive/qa records. Tests: harness 2095/2095; red-first 5 failing JS cases before the fix.
- Review: spec-reviewer APPROVE, code-reviewer APPROVE; 2 MEDIUM fixed (SPECKIT markers, duplicate adversary file folded in). No deferred items.
- Decisions on the owner's behalf: Spec Delta modifies 677-FR-003; year 0000 refused (Python parity), beyond the story's wording.
- QA run 37592025683 dispatched (lap 1), not awaited. NEXT: tail #191 after QA run 37592025683.

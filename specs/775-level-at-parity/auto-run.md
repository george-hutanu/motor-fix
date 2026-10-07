# Auto run — 775-level-at-parity

Description: ST-775 (Tech debt, harness) — an hour-24 level_at gets different answers from the JS and Python readers. https://app.notion.com/3f1607bff0d281fb915bc842545c4624
Start commit: origin/main (worktree .worktrees/775-level-at-parity). Preflight: tree clean, typecheck+lint+test green (exit 0).

## Phases
- 0 size: level 2 (notion: boards 1, brief not found, 0.80).
- 1 constitution: v1.8.2, card read; Principle I carried.
- confirm on main: `2026-10-06T24:00Z` Date.parse=1791331200000, fromisoformat ValueError; `2026-02-30T00:00Z` Date.parse rolls to 2 March, Python refuses. Divergence present; run continues.
- 2 specify: phase agent (fable), success; 3 FRs; level check unchanged at 2. Ready review: 13 candidates held, none ticked.
- lifecycle open: draft PR #184, Notion start + pr.
- 3 context: org-researcher, partial (epic page not read in full); 1 contradiction: day-of-month check beyond the anchor.
- 4 clarify (inline, spec-challenger 5 findings): Q1 day-of-month in scope? → no, deferred (context.md Scope Authority); Q2 asserted stamps → listed once, scenarios 1–3; Q3 remaining time in parity? → no, level-or-none (common.py `_pending_level` returns int|None); Q4 trailing newline → both refuse, regression; Q5 contradictory Notion assumption → dropped. level check: 2 unchanged.
- 5 plan: phase agent (fable) success, plan.md + quickstart.md. 6 checklist: phase agent (sonnet) success, checklists/parity.md 10/10. 7 tasks: phase agent (sonnet) success, 5 tasks; level 2 unchanged.
- 8 analyze: artifact-lint 0 errors; T004 groups made non-capturing; no CRITICAL.
- 9 tests: 18 cases in level.adversary.spec.mjs (9 refused, 7 accepted, both readers at a fixed now 5 min after midnight); red: exactly the 3 hour-24 JS cases failed (Python 3.9 already refuses). T002 folded into T001 (level.spec's table stamps from Date.now()).
- 10 implement: Notion → Implementing; hour group `(?:[01]\d|2[0-3])` in LEVEL_AT and _LEVEL_AT; test:harness 1939/1939 green. Biome ignores .claude/ paths.
- 11 converge: nothing unbuilt (5/5 tasks [X], FR-001/FR-002 covered by level.adversary.spec.mjs).
- 12 harden: artifact-lint 0; diff-audit: no finding on this diff's files (its 20 errors are libs/* against the stale local `main` base). test-adversary added 23 stamps, no defect; its duplicate describe/helpers folded into the existing parity block (Principle I). code-reviewer APPROVE, 1 LOW (deferred.md attribution) patched.
- 13 refresh: no new evidence (status Planning → Implementing only).
- 15 agent context: CLAUDE.local.md SPECKIT block → specs/775-level-at-parity/plan.md (one line replaced, no growth).
- 16 retro evidence: gathered (jev lane unavailable, no suggested verdict); no instincts triggered.
- 14 review: spec-reviewer APPROVE (2 LOW: offset stamps could not discriminate at the fixed now → moved a day ahead; plan.md still named level.spec.mjs → aligned). code-reviewer APPROVE (1 LOW patched). No CRITICAL/HIGH; no repair lap.
- 17 archive: status Archived (2026-10-07); Spec Delta merged into platform (+2), 775-FR-002 reworded to read on its own (same text in spec.md). Retro not run (speckit-auto phase 16: the verdict stays the owner's).

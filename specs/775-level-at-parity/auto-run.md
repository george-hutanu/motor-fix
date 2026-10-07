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

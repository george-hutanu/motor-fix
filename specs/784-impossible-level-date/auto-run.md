# Auto run — 784-impossible-level-date

Description: ST-784 (Tech debt from ST-775, Medium) — a level_at whose day the month does not have (2026-02-30T00:00Z) fits LEVEL_AT and Date.parse rolls it forward while Python's fromisoformat refuses it; pendingLevel refuses it so both readers agree. https://app.notion.com/p/3f2607bff0d28171bff8cc31c7d100e8
Start commit: ec74ab0654afa31c0e6bb27e0b56bd7a2c5ea933 (worktree .worktrees/784-impossible-level-date, branch 784-impossible-level-date).

## Phases
- 2 specify: phase agent (fable); before_specify branch hook skipped (branch exists); Notion task fetched, no comments; probed both readers (Python refuses 02-30/04-31/2025-02-29, accepts 2024-02-29; JS parses all four; month 00/13 and day 00/32 refused by both); spec.md + checklists/requirements.md (all pass); 2 FRs; feature.json pointed; level check: see below.
- 2 specify: level check: level 2 unchanged (fr-count 2, clarification clear, contract clear, projects clear). after_specify hooks (notion sync start, design check, git commit) left to the caller: no commit, no PR in this phase.

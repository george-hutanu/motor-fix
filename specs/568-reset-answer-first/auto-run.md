# /speckit-auto run — 568-reset-answer-first

Description: ST-568 Answer a password-reset request before issuing the link (tech debt from ST-127 review)
Start commit: be4813dcb3ade4800a2b90e9afe30af8c9ad20b5 (origin/main)
Worktree: .worktrees/568-reset-answer-first

## Preflight
- Rules read on origin/main: AGENTS.md, CLAUDE.local.md, constitution v1.8.1.
- Notion: ST-568 To do, Ready to work, PR empty; no GitHub PR for it.

## 0. Size
- Level 1 (one-session): one service method and its tests (`level.mjs suggest` agreed). Phases: 2, 7, 9, 10, 12, 14, 16.

## 2. Specify
- Spec written from the story body; 4 assumptions marked (autonomous default).
- Branch created by hand (`568-reset-answer-first`) because the worktree had to exist before the run; `.specify/feature.json` points at it.

# Auto run — ST-491 Back closes the task

Description: Tech debt (ST-157): The browser's Back button while a task is open should close the task and keep the page. Notion https://app.notion.com/3ef607bff0d281368c38d78fcc7b10ff (Task, Low, EP-1; from ST-157 PR #40 review).
Start: branch 491-back-closes-task at 282fbcdb (carries `docs(specs): ST-628 log its finish on main`).

## Preflight
- Tree clean; typecheck, lint, test green (exit 0). spec-drift: no active feature yet.
- Constitution card v1.8.2 read.

## Phases
- 0 size: level 2 (notion facts: boards 1, brief not found).
- 1 constitution: verified, not rewritten.

# speckit-auto run — 461-list-row-labels

Description: ST-461 — phone list rows keep their column names (deferred by pr-tester from ST-286, PR #22).
Start: branch 461-list-row-labels from origin/main 0cf285c; worktree .worktrees/461-list-row-labels; cloud session.

## Preflight
- Tree clean; `npm ci` via heavy.sh; typecheck + lint + test:unit green (exit 0). spec-drift: no active feature yet.

## 0. Size
- level.mjs suggest: unsure (no NOTION_TOKEN). Answered: intent is fully stated (what must hold, what must not change), one lib → level 1.

## Lifecycle start
- Notion (connector): ST-461 To do → Planning, Ready to work unticked; no timeline row; EP-1 already In progress.
- Draft PR #165 (template body, planning label; bug, scope: ui-cockpit, EP-1, ui); PR link written on ST-461.

## 2. Specify
- Run inline: this session has no Agent tool, so the fable pin was missed (pin miss).
- Branch already created from origin/main by the caller; the git.feature hook's branch was not created again.
- Decision: roles + visually hidden header, no per-cell data-label (Principle I; names would read twice on wide screens). Logged in spec Assumptions.
- Decision: Jest proof, no Playwright: no app route renders a cockpit table yet.

## 7. Tasks
- Written inline (pin miss as above): T001–T005.

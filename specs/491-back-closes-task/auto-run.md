# Auto run — ST-491 Back closes the task

Description: Tech debt (ST-157): The browser's Back button while a task is open should close the task and keep the page. Notion https://app.notion.com/3ef607bff0d281368c38d78fcc7b10ff (Task, Low, EP-1; from ST-157 PR #40 review).
Start: branch 491-back-closes-task at 282fbcdb (carries `docs(specs): ST-628 log its finish on main`).

## Preflight
- Tree clean; typecheck, lint, test green (exit 0). spec-drift: no active feature yet.
- Constitution card v1.8.2 read.

## Phases
- 0 size: level 2 (notion facts: boards 1, brief not found).
- 1 constitution: verified, not rewritten.
- 2 specify: phase agent (fable) — STATUS success; spec.md 8 FRs, Spec Delta modifies 157-FR-001/005/011. level check: clear. Notion start → Planning; Ready-to-work holds re-recorded (24, as given). Design check: mock not readable (Artifact "not found"), design.md from Notion text + ST-157 design. Draft PR #173 opened (lifecycle open), PR linked in Notion.
- 3 context: org-researcher — STATUS partial (epic page snippet only, decisions page not read); context.md written. Carried: ST-22 overlay routes, Forward, second Back.
- 4 clarify (inline, spec-challenger 6 findings). Q1 close-on-app-navigation → dropped, FR-007 only "no history move" (recommended). Q2 entry identity → state marker; router no-navigation in FR-001 (recommended). Q3 Forward → leave dead entry, NOT the recommended bounce (FR-007 evidence: bounce would skip a navigated page). Q4 race edge → assert SC-002 invariant (recommended). Q5 FR-005 → wait for popstate, no timer, at once when nothing removed (recommended). Challenger 4 (reload) and ST-22 → Assumptions. level check: clear.

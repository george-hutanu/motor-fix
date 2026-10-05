# Auto run — 201-news-consent

- Description: ST-201 Get MotorFix news only with my consent and stop it in one click (https://app.notion.com/p/3ee607bff0d2812eb821e9c31b7f0b23).
- Start commit: b581136 (origin/main); branch `201-news-consent`; draft PR #76.
- Picked as the only EP-1 story that is Ready to work and To do (Medium); ST-254 is held by another agent (Planning), ST-127 skipped by instruction, ST-200 not ticked ready. Every other ready item is a Task.

## Preflight
- Fresh branch from origin/main; `npm ci` in the worktree (the main checkout's node_modules lacks `@angular/cdk`); the start commit's pre-commit hook ran typecheck, lint and test green. Integration tests use a dedicated database `motorfix_201`.

## 0. Size
- Level 2 (feature): a migration, three routes, a worker change and a public page. (autonomous default)

## 1. Constitution
- Read `.specify/memory/constitution.md`; Principles I, II, VII carried.

## 2. Specify
- spec.md written from the Build brief; 5 autonomous answers in Clarifications; 6 assumptions.

## 3. Context
- context.md written from the story and its timeline row (read this session through the Notion connector).

## Design
- design.md: the mock rendered only its loading shell headless; boards taken from the story notes and the brief's Screens. Consent dialog not built (its panel is ST-138).

## 5–8. Plan, tasks
- plan.md, tasks.md.

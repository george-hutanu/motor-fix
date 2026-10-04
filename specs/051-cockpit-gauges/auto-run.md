# Auto run — 051-cockpit-gauges

Description: ST-51 — Build the shared indicator lamp, rating dial and odometer digits in libs/ui-cockpit, on the merged Cockpit theme (ST-50) and showing numbers through the ST-19 locale formats in libs/i18n. Notion story https://app.notion.com/p/3ee607bff0d281e4a0d7e24116a9b9fc.

Start: branch `051-cockpit-gauges` from origin/main 8cb1882 (worktree agent-a68ed8f7bfed1c6f6); resumed and fast-forwarded to origin/main c03d769 (ST-17, ST-431 merged).

## Preflight
- Tree clean. `npm install` re-run under heavy.sh after main changed package.json.
- typecheck green (12 projects), lint green (228 files), test green (10 projects) — through heavy.sh (owner rule: one heavy command at a time).
- `specs/` is tracked here (only `.specify/feature.json` is ignored): artifacts are committed with the slices, as ST-50 and ST-19 did.

## Phase 0 — Size
- Level 2: dial geometry, motion hooks and the catalogue location are design choices.

## Phase 1 — Constitution
- v1.4.0 read; no placeholders. Principle VII (autonomous PR lifecycle) applies; the orchestrator's brief overrides the skill's "never push".

## Phase 2 — Specify
- Read ST-51 (no discussions) and EP-1 (Build plan). 15 FRs, 4 user stories.
- Clarification table: none raised; defaults in Assumptions: catalogue = existing `/cockpit` page (not `/dev/ui`); no motion (ST-53, orchestrator); half-up rounding on the written decimal; grey = secondary text, amber = amber ink; small dial always ≥44 px; dial texts in the shell area; screenshot + axe replaced by rendered assertions (ST-50 precedent, no axe dependency).
- after_specify: notion-sync start (story To do → In progress, timeline Not started → In progress, epic unchanged In progress). design-check wrote design.md from Main, Results and Mechanic boards.

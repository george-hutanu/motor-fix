# Auto run — 050-cockpit-theme

Description: ST-50 Build the Cockpit theme: colours, type and panels (Notion story ST-50, epic Foundations EP-1). PrimeNG with the Cockpit theme for every component, including a light theme derived from the dark one that follows the device setting (decision superseding ST-54, 2026-10-03); smallest text on a phone is 12px.

Start: detached `origin/main` at 3f717c6c11b66f23ded60bc502f94477df02105e (worktree agent-adf2f625affd2d004), branch `050-cockpit-theme` (GIT_BRANCH_NAME fixed by the orchestrator).

## Preflight
- Tree clean. `npm install` (fresh worktree; install scripts skipped, so `prisma generate`, `husky` and `identity.sh apply` were run by hand).
- `npm run typecheck` green, `npm run lint` green, `npm test` green (7 projects).
- spec-drift: no active feature before this run.
- Note: `specs/` and `.specify/` are tracked in this repo (only `.specify/feature.json` is ignored), so artifacts are committed with the slices, contrary to the skill's Commit Protocol text.

## Phase 0 — Size
- Level 2: the token structure and the derivation of the light theme are design choices.

## Phase 1 — Constitution
- Read; versioned, no placeholders.

## Phase 2 — Specify
- Read the ST-50 story (no comments), MF-3 feature page and EP-1. 16 FRs, 6 user stories.
- Clarification table: none raised; two defaults recorded in spec Clarifications (light values as proposed; sample page as one lazy route `/cockpit`).
- Coordination (orchestrator): ST-50 creates `apps/web/src/app/app.routes.ts` (`appRoutes`) + `provideRouter(appRoutes)`, appends `provideCockpitTheme()` to the providers array, adds one styles entry in `apps/web/project.json`. ST-16 appends `provideI18n()`; sample-page text kept in one place for the later switch to translation keys.
- after_specify hooks: notion-sync start (story → In progress, timeline → In progress, epic unchanged); design-check wrote design.md.

## Phase 3 — Org context
- org-researcher wrote context.md: 22 findings (9 decisions, 8 constraints, 3 open, 2 contradictions). Open: owner approval [X26g], ST-249 font/CSS budget (proposed), Michroma Latin Extended coverage.

## Phase 4 — Clarify (spec-challenger + context)
- Q1 contrast pairs → text tokens × surfaces 4.5:1, status + focus 3:1 (recommended). Proposed light values measured: lowest text 4.82:1 (amber text on ECECE8), lowest status 3.56:1 (green on ECECE8) — all pass.
- Q2 44 px → interactive box incl. padding, every width (recommended).
- Q3 colour check scope → front-end .ts/.html/.css/.scss outside ui-cockpit, generated and tests; stays Jest (recommended; Principle IV).
- Q4 type scale → one scale, 12 px floor everywhere, body 13, inputs 16 (recommended).
- Q5 selected state → mock's amber text/border on 10% tint (recommended).
- Orchestrator coordination update: routes file is `export const routes: Routes` (ST-79 shape), `provideRouter(routes)` and `provideCockpitTheme()` as separate lines; `<router-outlet />` added to App (approved; dropped at merge).

## Phase 5 — Plan
- design.md current (before_plan hook skipped it). Deps installed exact: primeng 22.1.2, @primeuix/themes 3.0.1, @angular/cdk 22.2.1, @angular/forms 22.2.1, @fontsource/michroma 5.3.0, @fontsource-variable/hanken-grotesk 5.3.0.
- Finding: PrimeNG 22 requires a PrimeUI licence key (banner without it). Orchestrator decision: optional `license` on provideCockpitTheme, web app reads build-time PRIMEUI_LICENSE define, documented in .env.example; no test asserts a clean console. FR-008 amended.

## Phase 6 — Checklist
- checklists/theme.md: 20 items, all satisfied with justification (requirements.md 16/16).

## Phase 7 — Tasks
- 21 tasks, FR → test table in tasks.md.

## Phase 8 — Analyze
- artifact-lint: 1 ERROR `delta-unknown-capability` (cockpit-theme). Remediation: created `.specify/capabilities/cockpit-theme.md` from the template (new capability, deliberate). Re-run: 0 errors; `capabilities validate` merges cleanly.
- context.md contradiction 2 (screenshots) had no Clarification line → added one. Contradiction 1 closed by Q3. No CRITICAL/HIGH left.

## Phase 9 — Tests (red)
- Library config (project.json, tsconfigs, jest.config.cts, test-setup.ts) + tsconfig.base path. Jest: `transformIgnorePatterns: ['node_modules/']` — Node 24.9+ lets Jest require PrimeNG's `.mjs` natively; transforming it to CJS fails with "module is not defined".
- Wrote 6 suites (cockpit.css, preset, provider, panel, sample page, colour literals) + e2e `apps/web-e2e/src/cockpit.spec.ts`; test-adversary added `adversary.spec.ts` (18 tests). Its "no colour literal anywhere in the preset tree" exceeded FR-006 (Aura primitives and shadows are not surfaces/borders/text/focus) → scoped to the colour leaves of the spec-named semantic groups; `transparent` dropped from its named-colour list (a secondary button's transparent background is not a colour choice).
- Red: `npx jest -c libs/ui-cockpit/jest.config.cts` → Test Suites: 6 failed, 1 passed, 7 total; the passing suite is colour-literals (2 tests, the behaviour already holds on main — kept as a regression guard).
- Forced colours: the CSS-level forced-colors assertion was dropped before running — outlines and borders survive forced colours natively; the e2e test checks the rendered result instead.

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

## Phase 10 — Implement (first pass, PrimeNG)
- Resumed run (2026-10-04): implement had already landed three slices before this log was updated — 55b8b48 (tokens, typefaces, base styles), 21e4077 (PrimeNG preset + panel), 6bd45cb (/cockpit sample page). Kept; nothing rewritten (no force-push).

## Correct course — PrimeNG → Spartan UI (`/speckit-correct-course`)
- Trigger: owner decision 2026-10-04, constitution v1.3.0 Principle III (staged in the main checkout, not yet on `main`): Spartan UI (brain primitives + helm components copied into `libs/ui-cockpit`, Angular CDK) instead of PrimeNG — PrimeNG 22 needs a licence key; front-end deps must be free and open source. Approval of the proposal: the owner's decision itself, relayed by the orchestrator (autonomous gate).
- Was / Is now: FR-006 PrimeNG `CockpitPreset` → helm components painted by `spartan-*` classes in `cockpit.css`; FR-007 preset primary/highlight → default button variant, switch on-state, active tab / selected row; FR-008 PrimeNG dark-mode selector + optional `PRIMEUI_LICENSE` → `provideCockpitTheme()` with CDK overlay defaults only, no key. FRs not merged into any capability → stay `Adds`; correction recorded under spec.md › Spec Delta › Correction.
- Impact: tasks T001, T004, T005, T007, T009, T012–T015, T019, T021 reopened; preset.spec.ts deleted, helm.spec.ts added, provider/adversary/css/sample/e2e specs rewritten. Discarded: preset.ts, primeui-license.ts, the PrimeUI .env line, primeng + @primeuix/themes. Kept: all tokens, typefaces, contrast, panel, colour-literal check, route wiring.
- Decision: no Tailwind — helm copies keep only Spartan 1.5's `spartan-*` hook classes; `cockpit.css` styles them from `--mf-*` (Principles I, IV). Rejected: Tailwind + Spartan's theme variables mapped to ours (second toolchain, second naming layer). `clsx` declared explicitly (brain's sonner imports it at runtime).
- Red: `npx jest -c libs/ui-cockpit/jest.config.cts` → Test Suites: 5 failed, 2 passed; Tests: 10 failed, 21 passed (plus module-not-found for the removed PrimeNG and the missing helm files).
- Green: 7 suites / 63 tests. E2E (`BASE_URL=http://localhost:4250`, own dev server to avoid other worktrees' ports): first 11/11 green, but screenshots showed the switch track covering the page — `brn-switch` copies its `class` onto its host as well as the inner button. Added e2e "draws no control over the content around it" (red on the old CSS, confirmed), scoped the rules to `button.spartan-switch` → 12/12 green.
- Build: `nx run web:build` OK; warning: initial bundle 546 KB > 500 KB warning budget (error at 1 MB). Not from the theme: an empty provider measures the same; it is Angular + router + hydration in the vendor chunk (router arrives with this story's route; ST-79 brings it anyway). Reported, not changed.
- impact.mjs reports "no tests" for every FR — expected: tests carry no FR tokens (project rule); FR → test table is in tasks.md.

## Phase 11 — Converge
- One `unrequested` finding: the `.mf-visually-hidden` rule had no user (close buttons are named by `aria-label`) → T022, removed. Nothing else unbuilt.

## Phase 12 — Harden
- diff-audit (vs origin/main; the script's `main` is the stale local branch): dead-export ERRORs for helm parts reached only through the `*Imports` arrays — unexporting them broke Angular (NG3004: a standalone import must be exported), so they stay exported; `ButtonVariant` unexported. Kept deliberately: `import-extension` ERRORs (libs resolve with `bundler`; same as 421), `new-dependency` ERRORs (the given stack: brain, CDK, forms, the two fonts, clsx). Mutation: no stryker config in ui-cockpit → not run (reported, not waived).
- test-adversary: `helm.adversary.spec.ts` (≈40 tests). Two failed: an empty sheet close label still expecting an accessible name (owner decision: `closeLabel` stays required, dev-mode `console.error` naming the component, no default text in the lib — test rewritten to that contract, plus the dialog equivalent) and the rendered-hook count after `spartan-toaster` was removed (floor adjusted by that one class).
- code-reviewer (BLOCK, 10 findings): fixed all — branch behind main (merged, below), meaningless arity test deleted, dead exports/rule committed, leftover `class: 'contents'` and `spartan-toaster` removed, closeLabel dev-mode check, three duplicate adversary tests deleted, panel ids from CDK `_IdGenerator`, light-set comment made a TODO, e2e tab-stop count derived from a locator.

## Phase 13 — Ticket refresh
- org-researcher appended `## Refresh 2026-10-04` to context.md (Notion A1 amended to Spartan UI).

## Merge with origin/main (bec0eee)
- Merge order ST-79 → ST-422 → ST-16 → (frame fix #7) → ST-50 kept. Conflicts resolved as agreed: app.ts = main's bare `<router-outlet />`; app.routes.ts = main's routes + the `cockpit` entry before `**`; app.config.ts = `provideRouter(routes)`, `provideI18n()`, `provideCockpitTheme()` on their own lines; tsconfig.base keeps every alias; lockfile regenerated from main's; CLAUDE.local.md active plan → this plan.
- ST-16's template check fails on typed interface text, so the sample page moved to `cockpit.*` keys in the merge commit itself (a merge without it would not pass the pre-commit suite). origin/main 202c88e was red on ST-79's frame.ts; held the merge until the coordinator's fix landed (bec0eee).
- Verification: lint OK; typecheck 12/12; `nx run-many -t test --parallel=1` 10/10 projects; web build OK (initial 564.7 KB, warning budget 500 KB — Angular + router + i18n, not the theme); cockpit e2e 12/12 on a dev server at :4250.

## Phase 14 — Review (re-run once)
- Done by the `code-reviewer` subagent (no Workflow tool here, so not the verified `/speckit-review`; spec conformance read by the run itself against spec.md FR-001…FR-016 and the FR → test table). Round 2 verdict BLOCK on one HIGH (vacuous "one dialog" assertion) + MEDIUM/LOW; all fixed: `toHaveLength(1)`; SSR now waits for the cockpit texts through `PendingTasks` (curl of /cockpit shows "Tema Cockpit", no `cockpit.*` keys); dead `HlmTabs*` inputs, toaster `position`/`duration`, unbound popover/trigger aliases and `forceInvalid` removed (trigger `id` kept — static ids need it); `.reading` rule removed; duplicate disabled-button test removed, sheet side asserted by `data-side` only. Decision taken on the panel: input renamed `heading` (option a — removes the native `title` tooltip/double announcement), contract amended.
- Verification: ui-cockpit 97/97, i18n 77/77, typecheck 12/12, cockpit e2e 12/12.

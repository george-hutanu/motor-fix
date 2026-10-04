# Tasks: The Cockpit theme — colours, type and panels

**Input**: `specs/050-cockpit-theme/` — plan.md, spec.md, research.md, data-model.md, contracts/ui-cockpit.md, quickstart.md, context.md, design.md

**Tests**: required (constitution II, red-first gate). Jest specs colocated in `libs/ui-cockpit/src`; Playwright in `apps/web-e2e/src/cockpit.spec.ts`. No test asserts a clean console or inspects the bottom-right corner (PrimeUI licence banner).

## Phase 1: Setup

- [X] T001 Dependencies at the exact versions in plan.md in `package.json` / `package-lock.json`: `primeng`, `@primeuix/themes`, `@angular/cdk`, `@angular/forms`, `@fontsource/michroma`, `@fontsource-variable/hanken-grotesk` (FR-006, FR-011)
- [X] T002 Library `libs/ui-cockpit` (new): `project.json` (name `ui-cockpit`, `typecheck` target like `libs/data-access`), `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.cts` and `src/test-setup.ts` shaped like `apps/web` (jest-preset-angular, zoneless); `"@motor-fix/ui-cockpit": ["./libs/ui-cockpit/src/index.ts"]` as its own line in `tsconfig.base.json` (FR-006)

## Phase 2: Tests first (red)

- [X] T003 [P] `libs/ui-cockpit/src/styles/cockpit.css.spec.ts` (new): reads `cockpit.css`; dark values exactly as US1-1 on `:root` (FR-001); light values as US1-2 under `prefers-color-scheme: light` and the same set under `print` (FR-002); every colour token in both sets, all named `--mf-*` (FR-004); type, spacing (4 px multiples), radius 20/12/10, focus 3 px/3 px, tap 44 px tokens (FR-005); contrast pairs of data-model.md at 4.5:1 / 3:1 in both themes (FR-009); size tokens: label ≥ 12, body ≥ 13, field 16, no size token under 12 (FR-010); font faces imported with `font-display: swap` and a Latin Extended `unicode-range` covering ă â î ș ț, label stack falls back to Hanken Grotesk then system sans (FR-011); `:focus-visible` rule and a `forced-colors` block (FR-012, FR-014); no switch on a class or attribute — the scheme comes only from media queries (FR-003)
- [ ] T004 [P] `libs/ui-cockpit/src/lib/preset.spec.ts` (new): `CockpitPreset` primary colour/contrast/hover = `var(--mf-amber…)`; highlight = amber tint + amber ink; content, overlay, form field, text tokens reference `var(--mf-*)`; focus ring 3 px `var(--mf-focus)` for components and form fields; field font size `var(--mf-size-field)`; `sm` sizes equal the defaults; secondary button not amber; tabs active colour amber ink (FR-006, FR-007, FR-010, FR-012, FR-013)
- [ ] T005 [P] `libs/ui-cockpit/src/lib/provide-cockpit-theme.spec.ts` (new): with `provideCockpitTheme()` the PrimeNG theme is `CockpitPreset` with `darkModeSelector: 'system'`; with `{ license }` the config carries it, without it carries none (FR-008)
- [ ] T006 [P] `libs/ui-cockpit/src/lib/panel.spec.ts` (new): `mf-panel` renders projected content in a section with the `mf-panel` class; a given title renders as an `h2` with the label class and labels the section; no title, no heading (FR-014)
- [ ] T007 [P] `libs/ui-cockpit/src/lib/sample-page.spec.ts` (new): the sample page contains a primary and a secondary button, a labelled text input, a toggle switch, a table, tabs with one selected, a panel, the Romanian sample label, and buttons for dialog, drawer, toast and popover; exactly one primary (amber) button (FR-007, FR-015)
- [X] T008 [P] `libs/ui-cockpit/src/colour-literals.spec.ts` (new): no colour literal in front-end source outside the library, per FR-016's scope and patterns; the matcher catches `#fff`, `#FFB000`, `rgba(` and ignores `#tab-1`, `&#123;` style ids (FR-016)
- [ ] T009 [P] `apps/web-e2e/src/cockpit.spec.ts` (new), all on `/cockpit`: dark emulation → body background, panel surface, hairline, text, primary button fill are the dark values; light emulation → the light values (FR-001, FR-002); type in the input, switch scheme, value kept and colours changed without navigation (FR-003); at 375×812 no visible text node under 12 px, input text 16 px (FR-010); Michroma on labels, Hanken Grotesk on body (FR-011); Tab through every focusable element in both schemes → each shows a non-`none` outline or box-shadow ring (FR-012); buttons, inputs, tabs and toggle hit box ≥ 44 px (FR-013); panel radius 20 px with a visible border, also under `forcedColors: 'active'` (FR-014); dialog, drawer, toast and popover open with themed surfaces (FR-006, FR-015)

## Phase 3: User Story 1 — the look follows the device (P1) 🎯 MVP

- [X] T010 [US1] `libs/ui-cockpit/src/styles/cockpit.css` (new): font imports; `:root` dark tokens + theme-independent tokens and `color-scheme: dark`; `@media (prefers-color-scheme: light)` and `print` light tokens (one shared `@media (prefers-color-scheme: light), print` block) and `color-scheme: light`; `body` background/colour/font/size (FR-001…FR-005, FR-011)
- [X] T011 [US1] `apps/web/project.json`: `"libs/ui-cockpit/src/styles/cockpit.css"` before `apps/web/src/styles.css` in `build.options.styles` (FR-001)

## Phase 4: User Story 2 — PrimeNG takes its look from the theme (P1)

- [ ] T012 [US2] `libs/ui-cockpit/src/lib/preset.ts` (new): `CockpitPreset = definePreset(Aura, …)` per research.md §4–§6 (FR-006, FR-007, FR-013)
- [ ] T013 [US2] `libs/ui-cockpit/src/lib/provide-cockpit-theme.ts` (new) and `libs/ui-cockpit/src/index.ts` (new) exports (FR-008)
- [ ] T014 [US2] `apps/web/src/primeui-license.ts` (new) reading the build-time `PRIMEUI_LICENSE` define (undefined when absent); `apps/web/src/app/app.config.ts`: `provideCockpitTheme({ license: primeuiLicense })` as its own provider line; `.env.example`: `PRIMEUI_LICENSE` under web, build time (FR-008)
- [X] T015 [US2] `cockpit.css`: 44 px minimum on `.p-button`, `.p-inputtext`, `.p-tab`, the toggle switch's input hit box (FR-013)

## Phase 5: User Story 3 — legible text (P1)

- [X] T016 [US3] `cockpit.css`: `.mf-label` (label font, capitals, 12 px, 0.14em) (FR-010, FR-011)

## Phase 6: User Story 4 — visible focus (P1)

- [X] T017 [US4] `cockpit.css`: `:focus-visible` outline from the focus tokens; forced colours need no rule — outlines and borders survive them natively, checked in e2e (FR-012)

## Phase 7: User Story 5 — panels (P2)

- [ ] T018 [US5] `libs/ui-cockpit/src/lib/panel.ts` (new): standalone `mf-panel`, `title` input, styles from tokens, forced-colours border (FR-014)

## Phase 8: User Story 6 — sample page for the owner (P2)

- [ ] T019 [US6] `libs/ui-cockpit/src/lib/sample-text.ts` (new, every visible string in one place for the later switch to `cockpit.*` translation keys) and `libs/ui-cockpit/src/lib/sample-page.ts` (new), exported from its own entry `libs/ui-cockpit/src/sample.ts` (`@motor-fix/ui-cockpit/sample`) so the lazy route keeps it out of the initial bundle (FR-015)
- [ ] T020 [US6] `apps/web/src/app/app.routes.ts` (new) `export const routes: Routes = [{ path: 'cockpit', loadComponent }]`; `provideRouter(routes)` as its own line in `app.config.ts`; `<router-outlet />` + `RouterOutlet` import in `apps/web/src/app/app.ts` (FR-015)

## Phase 9: Polish

- [ ] T021 Run `npm run typecheck`, `npm run lint`, `npx nx run ui-cockpit:test`, `npx nx run web:test`, the e2e spec, and `npx nx run web:build` (CSS and font budget, SC-001…SC-005)

## Dependencies

T001 → T002 → T003–T009 (red) → T010–T011 → T012–T015 → T016–T017 → T018 → T019–T020 → T021. Within Phase 2 all [P].

## FR → test

| FR | Tests |
| --- | --- |
| FR-001, FR-002 | cockpit.css.spec.ts; cockpit.spec.ts (e2e colours per scheme) |
| FR-003 | cockpit.css.spec.ts; cockpit.spec.ts (scheme switch keeps input) |
| FR-004, FR-005 | cockpit.css.spec.ts |
| FR-006 | preset.spec.ts; cockpit.spec.ts (overlays themed) |
| FR-007 | preset.spec.ts; sample-page.spec.ts |
| FR-008 | provide-cockpit-theme.spec.ts |
| FR-009 | cockpit.css.spec.ts |
| FR-010 | cockpit.css.spec.ts; preset.spec.ts; cockpit.spec.ts (375 px) |
| FR-011 | cockpit.css.spec.ts; cockpit.spec.ts (families) |
| FR-012 | cockpit.css.spec.ts; preset.spec.ts; cockpit.spec.ts (tab ring) |
| FR-013 | preset.spec.ts; cockpit.spec.ts (44 px) |
| FR-014 | panel.spec.ts; cockpit.css.spec.ts; cockpit.spec.ts (radius, forced colours) |
| FR-015 | sample-page.spec.ts; cockpit.spec.ts |
| FR-016 | colour-literals.spec.ts |

## Implementation strategy

MVP is US1 (tokens + stylesheet). One commit per slice: (1) library, tokens and stylesheet with their tests; (2) preset + provider + web wiring; (3) panel + sample page + route + e2e.

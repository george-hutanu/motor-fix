# Tasks: The Cockpit theme — colours, type and panels

**Input**: `specs/050-cockpit-theme/` — plan.md, spec.md, research.md, data-model.md, contracts/ui-cockpit.md, quickstart.md, context.md, design.md

**Tests**: required (constitution II, red-first gate). Jest specs colocated in `libs/ui-cockpit/src`; Playwright in `apps/web-e2e/src/cockpit.spec.ts`. Tasks marked *(reopened)* were first built on PrimeNG and are redone on Spartan UI after the 2026-10-04 correction (spec.md, Spec Delta › Correction).

## Phase 1: Setup

- [X] T001 *(reopened)* Dependencies at the exact versions in plan.md in `package.json` / `package-lock.json`: `@spartan-ng/brain`, `clsx` (runtime import of brain's sonner), `@angular/cdk`, `@angular/forms`, `@fontsource/michroma`, `@fontsource-variable/hanken-grotesk`; `primeng` and `@primeuix/themes` removed (FR-006, FR-011)
- [X] T002 Library `libs/ui-cockpit` (new): `project.json` (name `ui-cockpit`, `typecheck` target like `libs/data-access`), `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.cts` and `src/test-setup.ts` shaped like `apps/web` (jest-preset-angular, zoneless); `"@motor-fix/ui-cockpit": ["./libs/ui-cockpit/src/index.ts"]` as its own line in `tsconfig.base.json` (FR-006)

## Phase 2: Tests first (red)

- [X] T003 [P] `libs/ui-cockpit/src/styles/cockpit.css.spec.ts` (new): reads `cockpit.css`; dark values exactly as US1-1 on `:root` (FR-001); light values as US1-2 under `prefers-color-scheme: light` and the same set under `print` (FR-002); every colour token in both sets, all named `--mf-*` (FR-004); type, spacing (4 px multiples), radius 20/12/10, focus 3 px/3 px, tap 44 px tokens (FR-005); contrast pairs of data-model.md at 4.5:1 / 3:1 in both themes (FR-009); size tokens: label ≥ 12, body ≥ 13, field 16, no size token under 12 (FR-010); font faces imported with `font-display: swap` and a Latin Extended `unicode-range` covering ă â î ș ț, label stack falls back to Hanken Grotesk then system sans (FR-011); `:focus-visible` rule and a `forced-colors` block (FR-012, FR-014); no switch on a class or attribute — the scheme comes only from media queries (FR-003)
- [X] T004 [P] *(reopened)* the PrimeNG preset spec deleted; `libs/ui-cockpit/src/lib/helm/helm.spec.ts` (new): each helm directive/component puts its `spartan-*` class and `data-slot` on the host; button variants default/secondary/ghost and no size input; input and label wire `for`/`id`; switch is a `role=switch` button bound through `ngModel` with `data-state`; tabs mark one trigger `aria-selected`; table parts carry their classes. `cockpit.css.spec.ts` gains: every colour in the `spartan-*` rules is `var(--mf-*)`; default button = amber fill + on-amber text; secondary/ghost never amber; active tab and selected row = amber ink on amber tint; switch on = amber; inputs at `--mf-size-field` (FR-006, FR-007, FR-010, FR-013)
- [X] T005 [P] *(reopened)* `libs/ui-cockpit/src/lib/provide-cockpit-theme.spec.ts`: with `provideCockpitTheme()` the CDK overlay default config has `usePopover: false`; it takes no options (FR-008)
- [X] T006 [P] `libs/ui-cockpit/src/lib/panel.spec.ts` (new): `mf-panel` renders projected content in a section with the `mf-panel` class; a given title renders as an `h2` with the label class and labels the section; no title, no heading (FR-014)
- [X] T007 [P] *(reopened: helm selectors)* `libs/ui-cockpit/src/lib/sample-page.spec.ts` (new): the sample page contains a primary and a secondary button, a labelled text input, a toggle switch, a table, tabs with one selected, a panel, the Romanian sample label, and buttons for dialog, drawer, toast and popover; exactly one primary (amber) button (FR-007, FR-015)
- [X] T008 [P] `libs/ui-cockpit/src/colour-literals.spec.ts` (new): no colour literal in front-end source outside the library, per FR-016's scope and patterns; the matcher catches `#fff`, `#FFB000`, `rgba(` and ignores `#tab-1`, `&#123;` style ids (FR-016)
- [X] T009 [P] *(reopened: helm selectors)* `apps/web-e2e/src/cockpit.spec.ts` (new), all on `/cockpit`: dark emulation → body background, panel surface, hairline, text, primary button fill are the dark values; light emulation → the light values (FR-001, FR-002); type in the input, switch scheme, value kept and colours changed without navigation (FR-003); at 375×812 no visible text node under 12 px, input text 16 px (FR-010); Michroma on labels, Hanken Grotesk on body (FR-011); Tab through every focusable element in both schemes → each shows a non-`none` outline or box-shadow ring (FR-012); buttons, inputs, tabs and toggle hit box ≥ 44 px (FR-013); panel radius 20 px with a visible border, also under `forcedColors: 'active'` (FR-014); dialog, drawer, toast and popover open with themed surfaces (FR-006, FR-015)

## Phase 3: User Story 1 — the look follows the device (P1) 🎯 MVP

- [X] T010 [US1] `libs/ui-cockpit/src/styles/cockpit.css` (new): font imports; `:root` dark tokens + theme-independent tokens and `color-scheme: dark`; `@media (prefers-color-scheme: light)` and `print` light tokens (one shared `@media (prefers-color-scheme: light), print` block) and `color-scheme: light`; `body` background/colour/font/size (FR-001…FR-005, FR-011)
- [X] T011 [US1] `apps/web/project.json`: `"libs/ui-cockpit/src/styles/cockpit.css"` before `apps/web/src/styles.css` in `build.options.styles` (FR-001)

## Phase 4: User Story 2 — the helm components take their look from the theme (P1)

- [X] T012 [US2] *(reopened)* the PrimeNG preset deleted; helm components copied from Spartan 1.5 into `libs/ui-cockpit/src/lib/helm/` (button, input, label, switch, tabs, table, dialog, sheet, popover, toaster) with Tailwind utilities stripped to the `spartan-*` hook classes; `cockpit.css` paints those classes from the tokens per research.md §4–§6 (FR-006, FR-007, FR-013)
- [X] T013 [US2] *(reopened)* `libs/ui-cockpit/src/lib/provide-cockpit-theme.ts`: overlay defaults only; `libs/ui-cockpit/src/index.ts` exports the helm parts, `Panel`, `provideCockpitTheme` (FR-008)
- [X] T014 [US2] *(reopened)* the PrimeUI licence reader in `apps/web/src` deleted; `apps/web/src/app/app.config.ts`: `provideCockpitTheme()` as its own provider line; `PRIMEUI_LICENSE` removed from `.env.example` (FR-008)
- [X] T015 [US2] *(reopened)* `cockpit.css`: 44 px minimum on `.spartan-button`, `.spartan-input`, `.spartan-tabs-trigger` and the `.spartan-switch` button (track drawn inside it) (FR-013)

## Phase 5: User Story 3 — legible text (P1)

- [X] T016 [US3] `cockpit.css`: `.mf-label` (label font, capitals, 12 px, 0.14em) (FR-010, FR-011)

## Phase 6: User Story 4 — visible focus (P1)

- [X] T017 [US4] `cockpit.css`: `:focus-visible` outline from the focus tokens; forced colours need no rule — outlines and borders survive them natively, checked in e2e (FR-012)

## Phase 7: User Story 5 — panels (P2)

- [X] T018 [US5] `libs/ui-cockpit/src/lib/panel.ts` (new): standalone `mf-panel`, `title` input, styles from tokens, forced-colours border (FR-014)

## Phase 8: User Story 6 — sample page for the owner (P2)

- [X] T019 [US6] *(reopened: rebuilt on the helm parts)* `libs/ui-cockpit/src/lib/sample-text.ts` (new, every visible string in one place for the later switch to `cockpit.*` translation keys) and `libs/ui-cockpit/src/lib/sample-page.ts` (new), exported from its own entry `libs/ui-cockpit/src/sample.ts` (`@motor-fix/ui-cockpit/sample`) so the lazy route keeps it out of the initial bundle (FR-015)
- [X] T020 [US6] `apps/web/src/app/app.routes.ts` (new) `export const routes: Routes = [{ path: 'cockpit', loadComponent }]`; `provideRouter(routes)` as its own line in `app.config.ts`; `<router-outlet />` + `RouterOutlet` import in `apps/web/src/app/app.ts` (FR-015)

## Phase 9: Polish

- [X] T021 Run `npm run typecheck`, `npm run lint`, `npx nx run ui-cockpit:test`, `npx nx run web:test`, the e2e spec, and `npx nx run web:build` (CSS and font budget, SC-001…SC-005)

## Dependencies

T001 → T002 → T003–T009 (red) → T010–T011 → T012–T015 → T016–T017 → T018 → T019–T020 → T021. Within Phase 2 all [P].

## FR → test

| FR | Tests |
| --- | --- |
| FR-001, FR-002 | cockpit.css.spec.ts; cockpit.spec.ts (e2e colours per scheme) |
| FR-003 | cockpit.css.spec.ts; cockpit.spec.ts (scheme switch keeps input) |
| FR-004, FR-005 | cockpit.css.spec.ts |
| FR-006 | helm.spec.ts; cockpit.css.spec.ts (component rules); adversary.spec.ts; cockpit.spec.ts (overlays themed) |
| FR-007 | cockpit.css.spec.ts (variants, selected state); helm.spec.ts; sample-page.spec.ts; cockpit.spec.ts |
| FR-008 | provide-cockpit-theme.spec.ts; adversary.spec.ts |
| FR-009 | cockpit.css.spec.ts |
| FR-010 | cockpit.css.spec.ts; cockpit.spec.ts (375 px) |
| FR-011 | cockpit.css.spec.ts; cockpit.spec.ts (families) |
| FR-012 | cockpit.css.spec.ts; cockpit.spec.ts (tab ring) |
| FR-013 | cockpit.css.spec.ts; helm.spec.ts (no size variant); cockpit.spec.ts (44 px) |
| FR-014 | panel.spec.ts; cockpit.css.spec.ts; cockpit.spec.ts (radius, forced colours) |
| FR-015 | sample-page.spec.ts; cockpit.spec.ts |
| FR-016 | colour-literals.spec.ts |

## Implementation strategy

MVP is US1 (tokens + stylesheet). One commit per slice: (1) library, tokens and stylesheet with their tests; (2) preset + provider + web wiring (PrimeNG; replaced forward by the correction slice: Spartan deps, helm parts, component rules, provider, sample page, tests — one commit); (3) panel + sample page + route + e2e.

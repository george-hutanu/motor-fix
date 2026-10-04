# Implementation Plan: The Cockpit theme — colours, type and panels

**Branch**: `050-cockpit-theme` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/050-cockpit-theme/spec.md`

## Summary

A new Angular library `libs/ui-cockpit` holds the whole Cockpit look: one stylesheet `cockpit.css` that defines every `--mf-*` token (a dark set on `:root`, the light set under `@media (prefers-color-scheme: light)` and `@media print`), the two self-hosted typefaces, the focus outline, and the `spartan-*` component rules that paint the Spartan helm components from those tokens (44 px minimum heights, amber main action, amber-tint selected state, raised overlays, forced colours); the helm components themselves, copied from Spartan UI 1.5 into `libs/ui-cockpit/src/lib/helm` on top of `@spartan-ng/brain` primitives with their Tailwind utilities stripped; `provideCockpitTheme()` (overlay defaults only); the `mf-panel` component; and `CockpitSamplePage` for the owner's approval of the light theme. *Corrected 2026-10-04: PrimeNG and the `CockpitPreset` were replaced by Spartan UI (constitution v1.3.0, Principle III).* `apps/web` gets the provider, the stylesheet and one lazy route `/cockpit`. The theme follows the device purely in CSS, so a scheme change is instant and touches no component state.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Angular 22.2.1 standalone + signals, zoneless test env (`apps/web/src/test-setup.ts`).

**Primary Dependencies**: added by this feature (exact, `package.json`): `@spartan-ng/brain` 1.5.0 (MIT; peers `@angular/{core,common,cdk,forms} >=21 <23` — hence `@angular/cdk` and `@angular/forms` 22.2.1), `clsx` 2.1.1 (MIT; imported at runtime by `@spartan-ng/brain/sonner`, so declared rather than left to peer auto-install), `@fontsource/michroma` 5.3.0, `@fontsource-variable/hanken-grotesk` 5.3.0. brain also lists `tailwindcss` and `tw-animate-css` as peers; npm installs them, nothing imports them (no Tailwind build step). Notion fixes no version ("current LTS at build start", context.md Constraints); these are the latest releases compatible with Angular 22.2.1. Removed by the correction: `primeng`, `@primeuix/themes`.

**Storage**: N/A — nothing from the server, nothing stored (Build brief, Data).

**Testing**: Jest 30.5.2 with `jest-preset-angular` 17.0.1 for the library (colocated `*.spec.ts`, jsdom, same shape as `apps/web/jest.config.cts`); Playwright 1.63.0 in `apps/web-e2e` (`playwright.config.mts`, chromium) for rendered sizes, colours, focus and scheme emulation.

**Target Platform**: browsers through `apps/web` (Angular SSR, `@angular/build:application`, `apps/web/project.json`).

**Project Type**: web front-end library + one route in the web app.

**Performance Goals**: within the *proposed* ST-249 budget (context.md): CSS 60 KB, fonts ≤ 100 KB per page — Michroma (latin 17.9 KB + latin-ext 14.5 KB woff2) and Hanken Grotesk variable (latin 34.7 KB + latin-ext 19.6 KB) = 86.7 KB when a page uses both subsets (`node_modules/@fontsource*/files`). The "2 font files" count is not met for a Romanian page (up to 4 subset files); recorded as open in research.md.

**Constraints**: `component style` budget 4 KB warn / 8 KB error (`apps/web/project.json`) — the panel's styles are a few lines; no hard-coded colour outside `libs/ui-cockpit` (FR-016); Biome only (`biome.json`); tsconfig paths in `tsconfig.base.json`.

**Scale/Scope**: one library, ~6 source files, one route.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat**: one stylesheet as the single source of every value; the helm components carry only `spartan-*` hook classes and Angular host bindings (no `cva`, `tailwind-merge` or class-manager utility), only the variants used (button: default/secondary/ghost, one size); no theme service, no switch, no storage (the decision is CSS media queries). Runtime packages besides `@spartan-ng/brain` are the two fonts the Build brief requires self-hosted and `clsx`, which brain's toaster imports. The sample page is a requirement (FR-015), not scaffolding.
- [x] **II. Test Discipline**: Jest specs colocated in `libs/ui-cockpit/src`; Playwright `apps/web-e2e/src/cockpit.spec.ts` for rendered behaviour. No API involved.
- [x] **III. The Given Stack**: Angular + Spartan UI on Angular CDK with the Cockpit theme (constitution v1.3.0, owner decision 2026-10-04) — this feature *is* that theme; every added dependency is MIT/OFL, none needs a licence key.
- [x] **IV. One Repository, One Toolchain**: one new lib under `libs/`; the colour-literal check is a Jest test, not a second lint tool.
- [x] **V. Rules Live in One Place**: tokens live once in `cockpit.css`; no server rules involved.
- [x] **VI. PostgreSQL Is the Truth**: N/A, no state.
- [x] **Notion choices**: *proposed* values relied on — light starting values, `--mf-*` names, no in-app switch, `font-display: swap`, 20/12/10 px radii, 4 px spacing, WCAG 2.2 AA, 12 px floor on larger screens — all from ST-50 Build brief (Notion, 2026-10-03/04). No T1–T10 item is touched.

## Project Structure

### Documentation (this feature)

```text
specs/050-cockpit-theme/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/ui-cockpit.md
├── context.md  design.md  notion-sync.md  auto-run.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
libs/ui-cockpit/                         (new)
├── project.json  tsconfig.json  tsconfig.lib.json  tsconfig.spec.json  jest.config.cts
└── src/
    ├── index.ts                         public API
    ├── test-setup.ts
    ├── styles/cockpit.css               tokens (dark, light, print), fonts, base, focus, spartan-* component rules, forced colours
    ├── styles/cockpit.css.spec.ts       token presence, values, contrast, fonts, component rules
    ├── lib/helm/*.ts  helm.spec.ts      button, input, label, switch, tabs, table, dialog, sheet, popover, toaster, close-icon
    ├── lib/provide-cockpit-theme.ts  provide-cockpit-theme.spec.ts
    ├── lib/panel.ts  panel.spec.ts      mf-panel
    ├── lib/sample-page.ts  sample-text.ts  sample-page.spec.ts
    └── colour-literals.spec.ts          no colour literal outside the lib
apps/web/
├── project.json                         + "libs/ui-cockpit/src/styles/cockpit.css" in styles
└── src/app/
    ├── app.config.ts                    + provideRouter(routes), + provideCockpitTheme() (separate lines)
    ├── app.routes.ts                    (new) export const routes: Routes = [{ path: 'cockpit', loadComponent }]
    └── app.ts                           + <router-outlet /> (approved; dropped at merge with ST-79)
apps/web-e2e/src/cockpit.spec.ts         (new)
tsconfig.base.json                       + "@motor-fix/ui-cockpit" path (separate line)
package.json, package-lock.json          + the dependencies above
```

**Structure Decision**: one library under `libs/` as the Build brief and the Front end architecture page name it (`libs/ui-cockpit`); the web app only wires it.

## Complexity Tracking

None.

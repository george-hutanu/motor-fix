# Implementation Plan: Set up the shared phone layout rules

**Branch**: `286-phone-layout` | **Date**: 2026-10-04 | **Spec**: specs/286-phone-layout/spec.md

**Input**: Feature specification from `/specs/286-phone-layout/spec.md`

## Summary

The phone rules live where every screen already gets its look: global rules and
tokens in `libs/ui-cockpit/src/styles/cockpit.css` (targets, text floor, field
size, wrapping, safe areas, the table's list-row collapse as a media query, so the
server-rendered first paint is already right). A small `Layout` service in
`libs/ui-cockpit` gives views the layout as a signal from CDK's
`BreakpointObserver`. Table cells get an optional `column` input (`main` / `key`)
that the CSS reads. The web app gets the viewport meta, a manifest with three
icons, the two `theme-color` tags (added by `provideCockpitTheme()`), and the
Angular service worker registered in production builds.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Angular 22.2.1 (`package.json`)

**Primary Dependencies**: `@angular/cdk` 22.2.1 (layout — already a dependency),
`@angular/service-worker` 22.2.1 (added, same version as `@angular/core`;
`package.json`), `@spartan-ng/brain` helm parts in `libs/ui-cockpit`

**Storage**: N/A (reads and writes nothing on the server)

**Testing**: Jest from the root config (`jest.config.ts`, `libs/ui-cockpit/jest.config.cts`, `apps/web/jest.config.cts`); Playwright in `apps/web-e2e` (`playwright.config.mts`)

**Target Platform**: Angular SSR web app (`apps/web/project.json`, `outputMode: server`), phones from 320 px, iOS Safari and Android Chrome

**Project Type**: web app (Nx app `web`, lib `ui-cockpit`)

**Performance Goals**: no new runtime cost beyond the service worker; the initial bundle stays under its 1 MB error budget (`apps/web/project.json`)

**Constraints**: colour literals only inside `libs/ui-cockpit` (`libs/ui-cockpit/src/colour-literals.spec.ts`); interface text through i18n keys (`libs/i18n/src/check.ts`) — this story adds no interface text; shell edits additive (ST-17's switch in `home.ts` / `frame.ts` is untouched)

**Scale/Scope**: 5 routes today (`apps/web/src/app/app.routes.ts`)

## Constitution Check

- [x] **I. No Bloat**: CSS rules instead of per-component code; one 20-line service the brief requires; one optional input on two existing directives; one dependency the brief names (the Angular service worker), which ST-196 needs for push. No wrapper, no config knob.
- [x] **II. Test Discipline**: red tests first — Jest for the layout service, the table column input, the CSS rules, the manifest and service worker config, the theme-color tags; Playwright for 320 px, 375 px text and targets, the table at both widths, resize without losing input, manifest and service worker.
- [x] **III. The Given Stack**: Angular's own service worker and CDK layout; no new UI library.
- [x] **IV. One Repository, One Toolchain**: no new project; Biome and Jest unchanged.
- [x] **V / VI**: no API, no data.
- [x] **Notion choices**: T4 (PWA or store apps) is decided in Notion — A19, ST-285 Done 2026-10-03 — so not a `[NEEDS CLARIFICATION]`.

## Design decisions

1. **Collapse in CSS, signal in code.** The list-row collapse is a `@media not all and (min-width: 768px)` rule (the exact complement of the signal's tablet query, so fractional widths agree) keyed on `data-column`, scoped with `:has([data-column="main"])` to tables that name a main column. The `Layout` signal reads the same breakpoints (`BREAKPOINTS` exported, and a test ties the CSS value to it). Rejected: hiding cells from the signal — the server has no width, so the first paint would be wrong on one of phone or desktop.
2. **Targets.** A base rule gives `button`, `select`, `textarea`, `summary`, `[role=button|tab|switch]`, text-like `input` and standalone `a` a 44 px minimum height (`--mf-tap`); links inside `p` and `li` stay inline (WCAG 2.5.8 inline exception).
3. **Text.** `input, select, textarea` take `--mf-size-field` (16 px). Every type token is ≥ 12 px already; `body` gets `overflow-wrap: break-word`; on a phone `.spartan-button` wraps (`white-space: normal`).
4. **Safe areas.** Tokens `--mf-safe-top/right/bottom/left: env(safe-area-inset-*, 0px)`; `body` pads left and right; `.spartan-sheet-content` adds top and bottom; a `.mf-bar-top` / `.mf-bar-bottom` pair is not added (no fixed bar exists yet; the tab bar stories add theirs on the tokens).
5. **Theme colour.** `provideCockpitTheme()` adds `<meta name="theme-color" media="(prefers-color-scheme: dark|light)">` through Angular's `Meta` (rendered on the server; `addTag` reuses an identical tag on the browser). The two values are constants beside `cockpit.css` and tested equal to `--mf-bg` in each set.
6. **Manifest.** `apps/web/public/manifest.webmanifest`, icons in `apps/web/public/icons/` (192, 512, maskable 512; PNGs drawn from the tokens), linked from `index.html` with an `apple-touch-icon`.
7. **Service worker.** `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() })` (default registration: when stable or after 30 s) in `app.config.ts`; `apps/web/ngsw-config.json` with the app shell (`/index.csr.html`) prefetched, assets lazy, no `dataGroups` (no API answer is cached), `navigationRequestStrategy: 'freshness'`, and `/api/**`, `/health/**` excluded from navigation. `serviceWorker` is set on the production configuration only.
8. **E2E.** `playwright.config.mts` blocks service workers (so `page.route` stubs keep working); the PWA spec allows them for itself. New spec `apps/web-e2e/src/phone.spec.ts`.

## Project Structure

```text
libs/ui-cockpit/src/
├── index.ts                         # + Layout (BREAKPOINTS stays in layout.ts)
├── lib/layout.ts / layout.spec.ts   # new
├── lib/helm/table.ts                # + optional column input on th/td
├── lib/helm/table.spec.ts           # new
├── lib/provide-cockpit-theme.ts     # + theme-color tags
├── lib/sample-page.ts               # table names its main and key columns
└── styles/cockpit.css (+ spec)      # phone rules
apps/web/
├── ngsw-config.json                 # new
├── project.json                     # production: serviceWorker
├── public/manifest.webmanifest      # new
├── public/icons/*.png               # new
├── src/index.html                   # viewport, manifest, apple-touch-icon
├── src/app/app.config.ts            # + provideServiceWorker
└── src/pwa.spec.ts                  # manifest + ngsw config
apps/web-e2e/
├── playwright.config.mts            # serviceWorkers: 'block'
└── src/phone.spec.ts                # new
```

## Complexity Tracking

| Item | Why it is needed | Simpler alternative rejected because |
| --- | --- | --- |
| `@angular/service-worker` | Brief: "Angular service worker for the app shell"; ST-196 builds push on it | A hand-written worker would reimplement caching, updates and push handling ST-196 needs |

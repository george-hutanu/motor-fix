# Implementation Plan: Move through the six steps with the step list in view

**Branch**: `108-step-list-in-view` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/108-step-list-in-view/spec.md`; `context.md` (Notion, Constraints carried below); `design.md` (boards ListGarage.dc.html and MList.dc.html, read from Notion's text: the mock artifact is not shared with this account).

## Summary

A public, server-rendered page `list-your-garage` under both language prefixes shows the label, heading, introduction and six empty, numbered section shells, with one `nav` "Pași" / "Steps" whose current entry follows the scroll (last heading at or above the bar's bottom edge; step 1 before any; step 6 at the end) and jumps to a section on activation. CSS at the frame's 768 px breakpoint lays the same `nav` out as a sticky side list on a desktop and as a sticky top bar with a disclosure on a phone. One lazy route, one text group, one component file plus a pure-function module, their Jest specs and one Playwright spec; no API, contract or storage change.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:78`); Node `>=24.0.0` (`package.json:85`); `tsconfig.base.json` `target es2023`, `module esnext`, `moduleResolution bundler`, `strict` (`:9-10,37-38`); `apps/web/tsconfig.json` `module preserve`, `target es2022`, `strictTemplates`, `isolatedModules`. `apps/web-e2e/tsconfig.json:3` is `nodenext`, so its relative imports carry a literal `.js`; `apps/web` and the libs do not.

**Primary Dependencies**: `@angular/core`, `router`, `platform-server`, `ssr`, `cdk` 22.2.1 (`package.json:3-12`, lockfile `package-lock.json:454`); `@spartan-ng/brain` 1.5.0 (`:24`, lockfile `:11618`) with the helm components in `libs/ui-cockpit/src/lib/helm/` (`button.ts` gives `hlmBtn` with `spartan-button` classes); `@motor-fix/i18n` (`I18n.t`, `TranslatePipe`, `LanguageSwitch`; `tsconfig.base.json:25`); `@motor-fix/ui-cockpit` (`REDUCED_MOTION`, `libs/ui-cockpit/src/index.ts:19`) and its tokens in `libs/ui-cockpit/src/styles/cockpit.css` (`--mf-space-*`, `--mf-amber-ink`, `--mf-amber-tint`, `--mf-bg`, `--mf-line`, `--mf-text-secondary`, `--mf-size-label: 12px` `:28`, `--mf-size-small: 13px` `:29`, `--mf-tap: 44px` `:48`, `--mf-label-tracking` `:32`, `--mf-radius-control`). No new dependency.

**Storage**: N/A (FR-012: the page reads and writes nothing).

**Testing**: Jest 30.5.2 with `jest-preset-angular` 17.0.1 (`package.json:66,69`) under jsdom through `apps/web/jest.config.cts` and the root `jest.preset.cjs`; Playwright `@playwright/test` 1.63.0 (`package.json:52`) in `apps/web-e2e` (`playwright.config.mts`: one chromium project, `baseURL http://localhost:4200`, servers started by Nx). Nx 23.2.1 (`package.json:72`), `defaultBase main` (`nx.json:3`). Biome 2.5.15 (`package.json:42`).

**Target Platform**: Angular SSR web app (`apps/web`), server render plus browser hydration; phones from 320 px, tablet, desktop; light and dark by the device (`cockpit.css:58`).

**Project Type**: web application, front-end only change in the Nx monorepo.

**Performance Goals**: no measurable budget beyond the page's own: a passive scroll listener reading six rectangles; no network call but the public texts the frame already loads (SC-006).

**Constraints** (from `context.md` Constraints and the spec):
- One address per language. The brief's `/ro/listeaza-service` is marked proposed; the spec's clarification chose one path `list-your-garage` under both prefixes, as the router and `alternates()` already work (`app.routes.ts:50-95`, `addresses.ts:40`); a per-language slug is left to an SEO story.
- Phone breakpoint 768 px (proposed in the brief; the frame's existing breakpoint, `frame.ts:25`); tapping the bar opens the six steps (proposed).
- No completion tick: proposed and not designed; the validation story owns it (FR-010).
- Light theme follows the device; the mock has dark only, light derives from the tokens (`cockpit.css:58`).
- Tests named by the brief: Jest for the scroll spy and the RO/EN labels, Playwright for the desktop tap of each step and the phone bar's jump to step 5.
- The route must tolerate a query string (ST-114's `?draft=<token>`): a path match ignores the query and `publicAddress` strips it (`addresses.ts:162-171`); nothing to build.
- Phone layout rules: no sideways scroll at 320 px, 44 px targets, no text under 12 px (FR-011).

**Scale/Scope**: one page, one `nav`, six section shells, 13 text keys in two languages; about six source files touched, three of them new.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.2, card `.specify/memory/constitution-card.md`) — evaluated in order:

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one component file and one pure-function module; the breakpoint is CSS, not a second template; the scroll spy is a listener and a ten-line function, not `IntersectionObserver` bookkeeping or a CDK service; the disclosure is a button with `aria-expanded`, not a Spartan popover; the title is the route's `title` resolver, not a service. No new dependency. The one piece that is not the spec's rule verbatim, the hold on the tapped step while the jump settles (research R5), exists because the spec's own Independent Test for US3 cannot pass on empty shells without it; the layout alternative was rejected as blank space for the spy's sake.
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing specs first: `steps.spec.ts` and `list-your-garage.spec.ts` colocated in `apps/web/src/app/public/`, the Playwright spec in `apps/web-e2e/src/`, and the sitemap and phone sweep additions in existing specs. No API tests: there is no API change. No FR or task id in source.
- [x] **III. The Given Stack**: Angular standalone component with signals, Spartan's helm `hlmBtn` for the bar and the entries where a button is styled, Cockpit tokens for colour, spacing and type; nothing added.
- [x] **IV. One Repository, One Toolchain**: `apps/web`, `apps/web-e2e` and `libs/i18n` only; Biome and the root Jest.
- [x] **V. Rules Live in One Place**: no API shape, DTO or use case; the step data is the page's own (`steps.ts`), used by the template, the spy and the tests alike.
- [x] **VI. PostgreSQL Is the Truth**: nothing is stored (FR-012).
- [x] **Notion choices**: the proposed items this plan relies on are the breakpoint, the bar's tap behaviour and the address scheme, each cited above from the ST-108 Build brief via `context.md`; no T1–T10 decision is touched.

**Post-design re-check**: unchanged; the design added no file, dependency or layer beyond the structure below.

## Project Structure

### Documentation (this feature)

```text
specs/108-step-list-in-view/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R10, each with evidence
├── data-model.md        # Phase 1: the Step and the page's state
├── quickstart.md        # Phase 1: how to run and verify the page
├── contracts/
│   └── page.md          # Phase 1: addresses, text keys, DOM and accessibility contract
├── spec.md, context.md, design.md, checklists/requirements.md, notion-sync.md, auto-run.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/web/src/app/
├── app.routes.ts                     # add the lazy child `list-your-garage` with its `title` resolver (after `terms`/`privacy`, :83-87)
├── addresses.ts                      # PUBLIC_PATHS gains 'list-your-garage' (:32)
└── public/
    ├── steps.ts                      # (new) STEPS (1–6: text key, mark, fragment ids) and currentStep(tops, line, atEnd)
    ├── steps.spec.ts                 # (new) the rule's edges; the six RO and EN labels through I18n
    ├── list-your-garage.ts           # (new) ListYourGarage: header with <mf-language-switch />, label, h1, intro,
    │                                 #       the nav (bar button + ol), six <section id> shells, scroll spy, jump, disclosure
    └── list-your-garage.spec.ts      # (new) both addresses, nav name, aria-current, bar text, server render, Escape

apps/web/src/server/search.spec.ts    # the sitemap lists /ro/list-your-garage and /en/list-your-garage (:54-62)

libs/i18n/src/public/
├── ro.json                           # group `listing`: label, heading, intro, steps, step1–step6, optional, required, bar
└── en.json                           # the same keys in English

apps/web-e2e/src/
├── list-your-garage.spec.ts          # (new) desktop: each entry jumps, focuses, is current; 390 px: bar text, open, step 5, Escape; reduced motion
└── phone.spec.ts                     # routes gain /ro/list-your-garage and /en/list-your-garage (:5-12)
```

**Structure Decision**: the page is one standalone component in `apps/web/src/app/public/`, where every public page already lives (`legal.ts`, `placeholder.ts`, `invite.ts`), registered as a lazy child of the `:lang` route like `terms` and `privacy`. The step data and the current-step rule sit in `steps.ts` next to it so Jest tests the rule without a DOM and the template, the bar and the tests read one list. Texts go in the existing public catalogue. No lib is created: nothing here is shared with another app.

## Design notes (what the tasks build)

- **Route** (`app.routes.ts`): `{ loadComponent: () => import('./public/list-your-garage').then((m) => m.ListYourGarage), path: 'list-your-garage', title: () => inject(I18n).t('public.listing.heading') }` under `:lang`; `PUBLIC_PATHS` adds the path, which also puts it in the sitemap and gives it canonical and hreflang links (`addresses.ts:40,158-194`, `server/search.ts:41`).
- **Markup**: `<header>` with `<mf-language-switch />` (as `home.ts:29`); `<p class="label">`, `<h1>`, `<p class="intro">`; `<div class="page">` grid holding `<nav [attr.aria-label]="'public.listing.steps' | t" [class.open]="open()">` with `<button type="button" class="bar" [attr.aria-expanded]="open()" (click)="open.set(!open())">{{ 'public.listing.bar' | t: { n: current(), label: … } }}</button>` and `<ol>` of six `<li><button type="button" [attr.aria-current]="current() === step.n ? 'step' : null" (click)="jump(step.n)">` with number, label and the optional/required mark; then six `<section [id]="…">` each with `<h2 tabindex="-1">` "n Label · mark". Ids: `pasul-<n>` in Romanian, `step-<n>` in English (spec Assumptions), from `STEPS` and the language signal.
- **CSS** (component styles, Cockpit tokens): `@media (min-width: 768px)`: `.page { display: grid; grid-template-columns: 1fr minmax(12rem, 16rem); gap }`, `nav { position: sticky; top: var(--mf-space-4); align-self: start }`, `.bar { display: none }`, `ol` always shown. `@media not all and (min-width: 768px)`: `nav { position: sticky; top: 0; z-index; background: var(--mf-bg); border-bottom: 1px solid var(--mf-line) }`, `.bar { min-height: var(--mf-tap); font-size: var(--mf-size-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100% }`, `ol { display: none }`, `nav.open ol { display: block }`, `section { scroll-margin-top: var(--mf-tap) }`. Entries: `min-height: var(--mf-tap)`, `[aria-current="step"] { color: var(--mf-amber-ink); background: var(--mf-amber-tint) }`. Label: `font: var(--mf-font-label)`, `letter-spacing: var(--mf-label-tracking)`, `font-size: var(--mf-size-label)`, uppercase text as written in the catalogue. Headings `overflow-wrap: anywhere` (no sideways scroll at 320 px).
- **Spy** (`afterNextRender`, browser only): `const update = () => current.set(currentStep(tops(), line(), atEnd()))` on `scroll` and `resize` (`{ passive: true }`), removed in `DestroyRef.onDestroy`; `line()` is the `nav`'s bottom edge on a phone (`nav.getBoundingClientRect().bottom`) and the frame's top padding on a desktop (the bar is hidden, so the same `bottom` of the sticky nav's top edge works: use `nav.getBoundingClientRect().top` when the bar is not displayed); `atEnd()` is `innerHeight + scrollY >= document.documentElement.scrollHeight - 1`. Run `update()` once after render, so a `#pasul-4` landing is highlighted.
- **Jump**: `current.set(n)`; `hold` until the jump's scroll events stop (150 ms quiet timer, started at the tap; research R5); `heading.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })`; `heading.focus({ preventScroll: true })`; `open.set(false)`.
- **Disclosure**: `@HostListener('document:click', ['$event'])` closes when `open()` and the target is outside the `nav`; `(keydown.escape)` on the `nav` closes and focuses the bar button. Nothing traps focus.
- **Texts**: see `contracts/page.md`; the English equivalents of the label, heading and introduction are this story's translation (spec Assumptions).

## Complexity Tracking

No constitution violation to justify. The one design choice beyond the spec's literal rule, the hold on the tapped step while the jump settles, is recorded in research R5 with the simpler alternative and why it was rejected.

# Implementation Plan: Move between public screens with a bottom tab bar on a phone

**Branch**: `287-public-tab-bar` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/287-public-tab-bar/spec.md`

## Summary

A public frame wraps every route under the language prefix (Home and four
placeholder screens) and ends with `mf-public-tab-bar`: a sticky `nav` of three
links whose active tab, destinations and labels come from the router URL, the
current language, the last results brand and the session. CSS hides it from
768 px and while a text field has focus. The `public` text area is entered by
the language guard, so the labels are there on the server's first render.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`), Angular 22.2.1 standalone components with signals (`@angular/core`, `@angular/router`).

**Primary Dependencies**: `@angular/router` (routerLink, RouterOutlet), `@motor-fix/i18n` (`I18n`, `LanguageChoice`, `TranslatePipe`), the Cockpit tokens in `libs/ui-cockpit/src/styles/cockpit.css` (`--mf-safe-bottom`, `--mf-size-label`, `--mf-amber-ink`, `--mf-text-secondary`, `--mf-line`, `--mf-bg`). No new dependency.

**Storage**: N/A. The last brand is a signal in a root-provided service (in memory, per browser tab; per request on the server).

**Testing**: Jest 30.5.2 from the root config (`jest.config.ts`, `apps/web` project, jsdom, `RouterTestingHarness` as in `apps/web/src/app/addresses.spec.ts`); Playwright 1.63.0 in `apps/web-e2e`.

**Target Platform**: the web app (`apps/web`, Angular SSR, `outputMode: server`, `apps/web/project.json`).

**Project Type**: web application, front end only.

**Performance Goals**: N/A beyond the component style budget (`anyComponentStyle` error at 8 kB, `apps/web/project.json`).

**Constraints**: the phone query is the complement of `(min-width: 768px)` (`libs/ui-cockpit/src/lib/layout.ts`, `cockpit.css`); targets 44 px and text 12 px (phone-layout capability); the server renders the first page, so texts must be loaded before render.

**Scale/Scope**: 4 new source files in `apps/web/src/app/public/`, routes and the language guard changed, 2 text files filled, one Playwright spec.

## Constitution Check

- [x] **I. No Bloat**: one bar component, one frame, one placeholder component shared by four routes, one guard; the last brand is a one-signal service because it must outlive the frame (leaving the public area and coming back). No shared tab-bar abstraction with ST-288: one caller today.
- [x] **II. Test Discipline**: Jest specs colocated (`tab-bar.spec.ts`), red first; Playwright `apps/web-e2e/src/tab-bar.spec.ts` for the 375/320/768/1024 flows.
- [x] **III. The Given Stack**: Angular, Cockpit tokens; no Spartan primitive fits a link bar (Spartan tabs are tab panels, not navigation), so plain links.
- [x] **IV. One Repository, One Toolchain**: inside `apps/web`; Biome only.
- [x] **V. Rules Live in One Place**: the signed-in landing comes from the session's `/me` answer (`MeDto.landing`); no rule copied to the client.
- [x] **VI. PostgreSQL Is the Truth**: N/A, no state change.
- [x] **Notion choices**: none of T1–T10 touched; the placeholder paths are recorded in the spec's Clarifications.

## Project Structure

### Documentation (this feature)

```text
specs/287-public-tab-bar/
├── spec.md · design.md · context.md · plan.md · tasks.md
├── checklists/requirements.md · checklists/tab-bar.md
└── auto-run.md · notion-sync.md
```

### Source Code

```text
apps/web/src/app/
├── app.routes.ts            # the :lang route gets PublicFrame and the placeholder children
├── addresses.ts             # languageAddress also enters the `public` text area
└── public/
    ├── frame.ts             # PublicFrame: router outlet + tab bar, full-height column
    ├── tab-bar.ts           # mf-public-tab-bar (inline styles, as the dashboard frame), the active-tab rule, LastBrand
    ├── tab-bar.spec.ts
    ├── account.guard.ts     # signedInToDashboard: a signed-in person goes to their dashboard (browser only)
    └── placeholder.ts       # one heading and one line per section, from route data
libs/i18n/src/public/{ro,en}.json   # tabs.* and placeholder.*
apps/web-e2e/src/tab-bar.spec.ts
```

**Structure Decision**: a `public/` folder beside `dashboard/`, mirroring how the dashboards keep their frame. The account guard sits beside the placeholder it guards (`public/account.guard.ts`) and is skipped on the server, which has no session.

## Design notes

- Active tab: the second URL segment after the language (`''` → search,
  `garages` and `mechanics` → garages, `account` → account), read from the
  router URL on every `NavigationEnd`.
- Service-uri: `/<lang>/garages?brand=<b>` when `LastBrand` holds a brand (set
  on `NavigationEnd` of a `garages` results URL with a non-empty `brand`),
  else `/<lang>/garages`.
- Cont: `/<lang>/account`; its `signedInToDashboard` guard (browser only) awaits `Session.load()` and
  redirects to `me.landing` when signed in.
- Typing: the bar listens to `focusin`/`focusout` on the document and hides
  itself (host class) while the focused element takes text.
- Texts: `languageAddress` calls `I18n.enter('public')` before choosing the
  language, so the server and the browser both wait for the area's files.

## Complexity Tracking

None.

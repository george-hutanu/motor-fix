# Implementation Plan: Reach every dashboard view from a bottom tab bar on a phone

**Branch**: `288-dashboard-tab-bar` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/288-dashboard-tab-bar/spec.md`, with `context.md` and `design.md`.

## Summary

Move the dashboard menus out of `frame.ts` into one view list per dashboard
(`views.ts`), give each view a child route under its dashboard with a
`canMatch` that reads the same list, turn the side menu's buttons into links
(`aria-current="page"`), and add `mf-dashboard-tab-bar`, a sticky bottom bar
below 768 px that renders the same filtered list with short labels and scrolls
sideways. On a phone the side menu's nav is hidden by a style rule and the
rest of the aside (logo, name, sign out) stays as a top band.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`).

**Primary Dependencies**: Angular 22.2.1 core/router (`package.json`): `RouterLink`, `RouterLinkActive` with `ariaCurrentWhenActive`, `CanMatchFn`, `RedirectCommand`; `@motor-fix/i18n` (`TranslatePipe`, shell JSON in `libs/i18n/src/shell/{ro,en}.json`); Cockpit tokens in `libs/ui-cockpit/src/styles/cockpit.css` (`--mf-safe-bottom`, `--mf-size-label`, `--mf-amber-ink`, `--mf-line`, `--mf-bg`). No new dependency.

**Storage**: N/A (reads the session only; writes nothing).

**Testing**: Jest 30.5.2 from the root config, `apps/web` project (jsdom, `RouterTestingHarness`/`provideRouter` as in `apps/web/src/app/dashboard/frame.spec.ts`); Playwright 1.63.0 in `apps/web-e2e` with the seeded accounts in `apps/web-e2e/src/accounts.ts`.

**Target Platform**: the web app `apps/web` (Angular SSR).

**Project Type**: web application (front end only).

**Performance Goals**: no added request; the refused view's chunk is never loaded (canMatch).

**Constraints**: 768 px boundary = `BREAKPOINTS.tablet` (`libs/ui-cockpit/src/lib/layout.ts:9`); tabs ≥ 44 px tall, labels ≥ 12 px, no horizontal page scroll at 320 px (`apps/web-e2e/src/phone.spec.ts`); translation keys appear whole in source (`apps/web/src/app/public/placeholder.ts:18`).

**Scale/Scope**: 3 view lists (driver 6, garage 7, admin 6 views), 1 new component, 1 new routes/list file.

## Constitution Check

- [x] **I. No Bloat**: one list per dashboard replaces the inline `MENUS`; no feature-switch field without a producer (deferred.md); the tab bar is one component; no breakpoint listener (CSS only).
- [x] **II. Test Discipline**: Jest specs colocated (`views.spec.ts`, `tab-bar.spec.ts`, `frame.spec.ts` updated) written first; Playwright `dashboard-tab-bar.spec.ts` for the four dashboards at 375 px; no API change, so no API test.
- [x] **III. The Given Stack**: Angular router and Cockpit CSS only.
- [x] **IV. One Repository**: inside `apps/web`.
- [x] **V. Rules Live in One Place**: the view list is the single source for menu, bar and route guard; trust stays on the server (the views are placeholders; capabilities come from `/me`).
- [x] **VI. PostgreSQL Is the Truth**: N/A, no state.
- [x] **Notion choices**: W01 (mechanic limited garage dashboard), W10 (receptionist), [24] (44 px / 12 px / safe area) cited in `context.md`; no T1–T10 item touched.

## Project Structure

### Documentation (this feature)

```text
specs/288-dashboard-tab-bar/
├── plan.md  research.md  data-model.md  quickstart.md  contracts/ui.md
├── spec.md  context.md  design.md  deferred.md  auto-run.md  notion-sync.md
└── tasks.md (next phase)
```

### Source Code (repository root)

```text
apps/web/src/app/
├── app.routes.ts                       # dashboard routes get children from views.ts
└── dashboard/
    ├── views.ts            (new)       # VIEWS per area, allowedViews(), dashboardRoutes(area)
    ├── views.spec.ts       (new)
    ├── view.ts             (new)       # the placeholder body of a view
    ├── tab-bar.ts          (new)       # mf-dashboard-tab-bar
    ├── tab-bar.spec.ts     (new)
    ├── frame.ts                        # menu from views.ts, links, router-outlet, phone rules
    └── frame.spec.ts                   # updated for links and the bar
libs/i18n/src/shell/{ro,en}.json        # short tab labels, the bars' landmark names
apps/web-e2e/src/
├── dashboard-tab-bar.spec.ts (new)
├── dashboards.spec.ts                  # unchanged expectations still hold
└── phone.spec.ts                       # unchanged; covers the new bar's sizes
```

**Structure Decision**: everything stays in `apps/web/src/app/dashboard`, next
to the frame that uses it; nothing else consumes the list yet, so it is not a
library.

## Complexity Tracking

None.

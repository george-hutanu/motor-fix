# Tasks: Reach every dashboard view from a bottom tab bar on a phone

**Input**: `specs/288-dashboard-tab-bar/` — plan.md, spec.md, data-model.md, contracts/ui.md, research.md, design.md
**Tests**: required (Constitution II, red first): Jest colocated in `apps/web`, Playwright in `apps/web-e2e`.

## Phase 1: Setup

- [X] T001 Add the short tab labels (`shell.frame.tab.*`: Panou/Home, Cereri/Requests, Mașini/Cars, Recenzii/Reviews, Salvate/Saved, Setări/Settings, Program/Schedule, Mecanici/Team, Prețuri/Prices, Profil/Profile, Service‑uri/Garages, Utilizatori/Users, Raportate/Reported, Mărci/Brands) and the bars' landmark names (`shell.frame.tabs.driver|garage|admin`: Panou șofer / Panou service / Panou admin; Driver / Garage / Admin dashboard) in `libs/i18n/src/shell/ro.json` and `libs/i18n/src/shell/en.json`

## Phase 2: Foundational

- [X] T002 Write `apps/web/src/app/dashboard/views.spec.ts` (new): the three lists in data-model.md order with `path` (`''` = dashboard view; segments: driver `requests, cars, reviews, saved, settings`; garage `requests, schedule, team, prices, reviews, profile`; admin `garages, users, reviews, catalogue, settings`), `label`, `tab`, optional `capability`; `allowedViews` filters by capability (receptionist: no team, prices, profile; mechanic without permissions: dashboard only; mechanic with canAnswerQuotes and canMoveBookings: + requests, schedule); `dashboardRoutes(area)` redirects a refused view and an unknown path to `/app/<area>` before loading (RouterTestingHarness) — FR-001, FR-002, FR-003
- [X] T003 Implement `apps/web/src/app/dashboard/views.ts` (new) and `apps/web/src/app/dashboard/view.ts` (new, the placeholder body: `shell.frame.empty`) and wire `children: dashboardRoutes(area)` on the three dashboard routes in `apps/web/src/app/app.routes.ts` — FR-001, FR-002, FR-003, FR-013

## Phase 3: User Story 1 — Reach every view with one thumb (P1)

**Independent test**: at 375 px each seeded role sees the bar, taps every tab, the view opens with its tab current.

- [X] T004 [P] [US1] Write `apps/web/src/app/dashboard/tab-bar.spec.ts` (new): one link per view in order with its short label and `/app/<area>/<path>` href; `aria-current="page"` only on the open view's tab (exact for the dashboard view, prefix for others); a `nav` named by the given landmark key; the active tab scrolled into sight with `scrollIntoView({ block: 'nearest', inline: 'nearest' })` after navigation — FR-004, FR-006, FR-010
- [X] T005 [US1] Implement `mf-dashboard-tab-bar` in `apps/web/src/app/dashboard/tab-bar.ts` (new) per design.md: sticky bottom, glass ground (`--mf-bg` 74 %, solid with reduced transparency), `--mf-line` top border, `overflow-x: auto`, padding `6px 8px max(14px, var(--mf-safe-bottom))`, tabs `flex: 1 0 auto; min-width: 66px; min-height: 48px`, 18×3 px marker over a 12 px weight-700 nowrap label, inactive `--mf-text-secondary`, active `--mf-amber-ink`; hidden from 768 px — FR-004, FR-006–FR-010
- [X] T006 [US1] Write `apps/web-e2e/src/dashboard-tab-bar.spec.ts` (new): at 375 px for driver, garage, receptionist, mechanic and admin, the bar (named after the dashboard) lists the expected tabs; tapping each opens its address with that tab `aria-current="page"`; the page never scrolls sideways — US1 scenarios 1–6, SC-001

## Phase 4: User Story 2 — Menu and bar never disagree (P1)

**Independent test**: menu entries at 1024 px equal the bar's tabs at 375 px; a refused address redirects.

- [X] T007 [US2] Update `apps/web/src/app/dashboard/frame.spec.ts`: the side menu renders links from the same allowed list (long labels, same order as the bar), `aria-current="page"` on the open view, the `h1` is the open view's long label, the bar gets the same list; a session change that removes the open view moves to `/app/<area>`; a role change re-renders both lists — FR-004, FR-005, FR-011
- [X] T008 [US2] Rework `apps/web/src/app/dashboard/frame.ts`: drop `MENUS` for `views.ts`, menu buttons → `routerLink` + `routerLinkActive` (`ariaCurrentWhenActive="page"`), `router-outlet` in `main`, `mf-dashboard-tab-bar` at the end, below 768 px hide the aside's nav and keep its logo, name and sign out as a top band — FR-004, FR-005, FR-011, FR-012
- [X] T009 [US2] Extend `apps/web-e2e/src/dashboard-tab-bar.spec.ts`: at 768 px the bar is hidden and the menu shown with the same views; a receptionist opening `/app/garage/team` ends on `/app/garage`; `/app/driver/nope` ends on `/app/driver` — US2 scenarios 1–3, SC-004

## Phase 5: User Story 3 — The bar fits every phone (P2)

**Independent test**: 320 px and 390 px, RO and EN.

- [X] T010 [US3] Extend `apps/web-e2e/src/dashboard-tab-bar.spec.ts`: at 320 px in Romanian the garage bar shows every whole label, scrolls sideways itself, the page has no horizontal scroll; every tab ≥ 44 px tall with a ≥ 12 px label; the bar's bottom padding is at least 14 px — US3 scenarios 1–3, SC-002, SC-003

## Phase 6: Polish

- [X] T011 Run `apps/web-e2e/src/dashboards.spec.ts` and `apps/web-e2e/src/phone.spec.ts` unchanged against the new frame (the "Meniu" nav, "Ieși din cont" and 44 px / 12 px checks still hold) — FR-012, SC-002

## Dependencies

T001 → T002/T003 → (T004 → T005) and (T007 → T008) → T006, T009, T010 → T011. T004 and T007 can be written in parallel.

## FR → test

| FR | Test |
| --- | --- |
| FR-001, FR-002, FR-003 | views.spec.ts; dashboard-tab-bar.spec.ts (refused/unknown address) |
| FR-004, FR-006, FR-010 | tab-bar.spec.ts; dashboard-tab-bar.spec.ts |
| FR-005, FR-011 | frame.spec.ts; dashboard-tab-bar.spec.ts (768 px) |
| FR-007, FR-008, FR-009 | dashboard-tab-bar.spec.ts (320 px); phone.spec.ts |
| FR-012 | frame.spec.ts; dashboards.spec.ts |
| FR-013 | views.spec.ts (placeholder body) |

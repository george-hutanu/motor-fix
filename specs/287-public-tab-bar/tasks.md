# Tasks: Move between public screens with a bottom tab bar on a phone

**Input**: plan.md, spec.md, context.md, design.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `apps/web/src/app/app.routes.ts`, `apps/web/src/app/addresses.ts`, `libs/i18n/src/public/ro.json`, `libs/i18n/src/public/en.json`.

## Phase 1: US1 Reach the three public sections (P1)

**Independent test**: at every public address the bar shows the three tabs, the right one active, each leading where the spec says.

- [X] T001 [US1] Test: `apps/web/src/app/public/tab-bar.spec.ts` — with the app's routes: `/ro` shows a `nav` with links "Caută", "Service-uri", "Cont" in that order, each with an `aria-hidden` icon; "Caută" alone has `aria-current="page"` (FR-001, FR-002, FR-003)
- [X] T002 [US1] Test: same file — `/ro/garages`, `/ro/garages/atelier-dinamo` and `/ro/mechanics/ion-popescu` make "Service-uri" the active tab, `/ro/account` makes "Cont"; each placeholder shows its heading and the "comes later" line; `/ro/no-such-page` and `/app/driver` (signed in) have no public bar (FR-003, FR-011)
- [X] T003 [US1] Test: same file — "Caută" leads to `/ro`; "Service-uri" leads to `/ro/garages` until `/ro/garages?brand=bmw` was opened, then to `/ro/garages?brand=bmw` from any public screen, also after leaving the public screens and coming back; a later `/ro/garages` with no or an empty `brand` keeps `bmw` (FR-004, FR-005)
- [X] T004 [US1] Test: same file — "Cont" leads to `/ro/account`; opening it signed out shows the account placeholder; signed in (session answers an account with landing `/app/driver`) it ends on `/app/driver` (FR-006)
- [X] T005 [US1] `apps/web/src/app/public/tab-bar.ts`, `frame.ts`, `placeholder.ts`; `app.routes.ts` — the `:lang` route gets `PublicFrame` and the `garages`, `garages/:garage`, `mechanics/:mechanic`, `account` children; `addresses.ts` — `languageAddress` enters the `public` text area; `libs/i18n/src/public/ro.json` and `libs/i18n/src/public/en.json` — `tabs.*`, `placeholder.*` (FR-001..FR-006, FR-011, FR-012)

## Phase 2: US2 The bar fits every phone and every person (P1)

**Independent test**: the bar's rules hold at 320 px and 375 px; the landmark and the current tab are announced.

- [X] T006 [US2] Test: `tab-bar.spec.ts` — the component's styles pad the bottom with `max(…, var(--mf-safe-bottom))`, give each link `min-height` ≥ 44 px and labels `var(--mf-size-label)`, colour the active link `var(--mf-amber-ink)`, and keep the bar `position: sticky; bottom: 0` (FR-007, FR-010)
- [X] T007 [US2] Test: `apps/web-e2e/src/tab-bar.spec.ts` — at 320 px on `/ro`, `/ro/garages`, `/ro/account`: `scrollWidth` ≤ 320, every tab ≥ 44 px tall, every label ≥ 12 px; at 375 px the bar's bottom edge is the viewport's, and scrolled to the end the page's last content sits above the bar; the landmark is reachable by role `navigation` named "Navigare principală" and the active link has `aria-current="page"`; Tab moves focus through the three links in order and Enter opens the focused one (FR-002, FR-003, FR-007, FR-010, SC-002)
- [X] T008 [US2] Styles in `tab-bar.ts` and `frame.ts` (FR-007, FR-010)

## Phase 3: US3 Both languages, phone only (P2)

**Independent test**: English labels, the language switch, the 768 px rule and the typing rule.

- [X] T009 [US3] Test: `tab-bar.spec.ts` — `/en` reads "Search", "Garages", "Account" and the landmark "Main navigation"; choosing English on `/ro/garages` changes the labels in place and the links to `/en`, `/en/garages…`, `/en/account`; the component's styles hide the host from `min-width: 768px`; focusing a text input hides the bar, focusing a checkbox does not, and blurring shows it again (FR-008, FR-009, FR-012)
- [X] T010 [US3] Test: `apps/web-e2e/src/tab-bar.spec.ts` — at 375 px tapping each tab from `/ro` lands on its address; at 768 px and 1024 px the bar is not visible on `/ro` and `/ro/garages`; `/en` shows the English labels (FR-004..FR-006, FR-008, FR-012, SC-001, SC-003)
- [X] T011 [US3] Language and typing handling in `tab-bar.ts` (FR-008, FR-009, FR-012)

## Phase 4: Review follow-up

- [X] T013 Test: `tab-bar.spec.ts` — on the server platform `/ro/account` renders the placeholder and never asks the session; the brand test opens a garage address with a different brand; `public/account.guard.ts` `signedInToDashboard` skips the server; the bar parses the address once per navigation and binds a computed query (FR-005, FR-006)
- [X] T014 Test: `apps/web-e2e/src/tab-bar.spec.ts` — an editable element hides the bar on a phone; the server render of `/` carries no bar (FR-009)

## Phase 5: Polish

- [X] T012 Run `npm run typecheck`, `npm run lint`, `npm run test` and the web-e2e suite; record the results in auto-run.md (SC-004 through the i18n check)

## FR → test

| FR | Tests |
|----|-------|
| FR-001 | T001 |
| FR-002 | T001, T007 |
| FR-003 | T001, T002, T007 |
| FR-004 | T003, T010 |
| FR-005 | T003, T013 |
| FR-006 | T004, T010, T013 |
| FR-007 | T006, T007 |
| FR-008 | T009, T010 |
| FR-009 | T009, T014 |
| FR-010 | T006, T007 |
| FR-011 | T002 |
| FR-012 | T009, T010 |

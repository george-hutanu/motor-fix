# Tasks: Set up the shared phone layout rules

**Input**: plan.md, spec.md, context.md, design.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/ui-cockpit/src/index.ts`, `libs/ui-cockpit/src/lib/helm/table.ts`, `libs/ui-cockpit/src/lib/provide-cockpit-theme.ts`, `libs/ui-cockpit/src/lib/provide-cockpit-theme.spec.ts`, `libs/ui-cockpit/src/lib/sample-page.ts`, `libs/ui-cockpit/src/styles/cockpit.css`, `libs/ui-cockpit/src/styles/cockpit.css.spec.ts`, `apps/web/project.json`, `apps/web/src/index.html`, `apps/web/src/app/app.config.ts`, `apps/web-e2e/playwright.config.mts`.

## Phase 1: Setup

- [X] T001 Add `@angular/service-worker` 22.2.1 (exact, same as `@angular/core`) to `package.json` (FR-011)

## Phase 2: US1 Every screen fits a phone (P1)

**Independent test**: the CSS carries the rules; every route at 320 px and 375 px passes the width, text and target checks.

- [X] T002 [US1] Test: `libs/ui-cockpit/src/styles/cockpit.css.spec.ts` — base rules: `button`, `select`, `textarea`, `summary`, `[role=button|tab|switch]`, text-like `input` and standalone `a` take `min-height: var(--mf-tap)`; links in `p`/`li` are exempt; fields take `--mf-size-field`; every `--mf-size-*` token ≥ 12 px; `body` wraps long words and pads the left and right safe-area insets; on a phone `.spartan-button` wraps (FR-002, FR-003, FR-004, FR-005, FR-006, FR-009)
- [X] T003 [US1] Test: `apps/web/src/pwa.spec.ts` — `index.html` declares `width=device-width, initial-scale=1, viewport-fit=cover` and no `user-scalable` / `maximum-scale` (FR-001)
- [X] T004 [US1] `libs/ui-cockpit/src/styles/cockpit.css` — target, field, wrap and safe-area rules and tokens; `apps/web/src/index.html` viewport (FR-001..FR-006, FR-009)
- [X] T005 [US1] Test: `apps/web-e2e/src/phone.spec.ts` — each route (`/`, `/cockpit`, `/app/driver`, `/app/garage`, `/app/admin` with a stubbed session) at 320 px: `scrollWidth` ≤ 320; at 375 px: no visible text under 12 px, no visible FR-003 target under 44 px, every field ≥ 16 px; at 375 px with the type tokens and body size doubled: no sideways scroll and no button whose content is wider than it (FR-002..FR-006, SC-001, SC-002)

## Phase 3: US2 Tables become list rows on a phone (P1)

**Independent test**: a table naming main and key columns shows only those, side by side, below 768 px.

- [X] T006 [US2] Test: `libs/ui-cockpit/src/lib/helm/table.spec.ts` — `hlmTh` / `hlmTd` with `column="main"` or `"key"` carry `data-column`; without it they carry none (FR-007)
- [X] T007 [US2] Test: `libs/ui-cockpit/src/styles/cockpit.css.spec.ts` — the phone query (`max-width: 767.98px`, tied to `BREAKPOINTS.tablet`) hides the header and every cell not main or key in a table that has a main column, and lays the row out as main at the start, key at the end (FR-007)
- [X] T008 [US2] `libs/ui-cockpit/src/lib/helm/table.ts` — optional `column` input; `cockpit.css` list-row rules; `sample-page.ts` names Service (main) and Rating (key) (FR-007)
- [X] T009 [US2] Test: `apps/web-e2e/src/phone.spec.ts` — `/cockpit` at 375 px: header row and area column hidden, name and rating visible on one line; at 1024 px every column and the header show (FR-007)

## Phase 4: US3 Views know their layout, live (P2)

**Independent test**: the signal at 320 / 767 / 768 / 1023 / 1024 and on the server.

- [X] T010 [US3] Test: `libs/ui-cockpit/src/lib/layout.spec.ts` — with a controllable `matchMedia`, `Layout.current()` is `phone` below 768, `tablet` 768–1023, `desktop` from 1024, changes when the queries change, and is `phone` on the server platform (FR-008)
- [X] T011 [US3] `libs/ui-cockpit/src/lib/layout.ts` — `Layout` service and `BREAKPOINTS` on CDK `BreakpointObserver`; export from `libs/ui-cockpit/src/index.ts` (FR-008)
- [X] T012 [US3] Test: `apps/web-e2e/src/phone.spec.ts` — on `/cockpit`, text typed in the field survives a resize from 375 to 1024 and back, and the table switches between list rows and columns each time (FR-007, FR-008)

## Phase 5: US4 MotorFix can be installed (P2)

**Independent test**: the manifest, icons, theme colours and service worker config are right; the production build registers the worker.

- [X] T013 [US4] Test: `apps/web/src/pwa.spec.ts` — `public/manifest.webmanifest`: name and short name "MotorFix", `display: standalone`, `start_url: /`, theme and background colour = dark `--mf-bg`, icons 192 and 512 (`any`) and 512 (`maskable`) whose PNG files exist with those sizes; `index.html` links the manifest and an `apple-touch-icon`; `ngsw-config.json`: index `/index.csr.html`, no `dataGroups`, navigations `freshness`, `/api/**` and `/health/**` excluded; production build config names it, development does not (FR-010, FR-011)
- [X] T014 [US4] Test: `libs/ui-cockpit/src/lib/provide-cockpit-theme.spec.ts` — the provider adds one `theme-color` meta per scheme, each equal to `--mf-bg` of that scheme in `cockpit.css`, and providing it twice leaves two tags (FR-010)
- [X] T015 [US4] Manifest, icons, `ngsw-config.json`, `index.html` links, `project.json` production `serviceWorker`, `provideServiceWorker` in `app.config.ts`, theme-color tags in `provideCockpitTheme()` (FR-010, FR-011)
- [X] T016 [US4] Test: `libs/ui-cockpit/src/styles/cockpit.css.spec.ts` — `.spartan-sheet-content` pads `--mf-safe-top` and `--mf-safe-bottom` (FR-009)
- [X] T017 [US4] Test: `apps/web-e2e/src/pwa.spec.ts` with service workers allowed — the manifest and its three icons answer 200 and `navigator.serviceWorker.ready` resolves on the production build; `playwright.config.mts` blocks service workers for every other spec (FR-010, FR-011, SC-003)

## Phase 6: Polish

- [ ] T018 Run `npm run typecheck`, `npm run lint`, `npm run test`, and the e2e suite against the production build on port 4286; record results in auto-run.md

## FR → test

| FR | Tests |
|----|-------|
| FR-001 | T003 |
| FR-002 | T002, T005 |
| FR-003 | T002, T005 |
| FR-004 | T002, T005 |
| FR-005 | T002, T005 |
| FR-006 | T002, T005 |
| FR-007 | T006, T007, T009, T012 |
| FR-008 | T010, T012 |
| FR-009 | T002, T016 |
| FR-010 | T013, T014, T017 |
| FR-011 | T013, T017 |

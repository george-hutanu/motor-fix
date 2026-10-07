# Tasks: Open the admin dashboard and its menu, admins only

**Input**: `specs/160-admin-dashboard-menu/` (spec.md, plan.md, research.md R1-R10, data-model.md, contracts/admin-overview.md, quickstart.md, design.md)
**Tests**: required (Constitution II, red-first): in every phase the test tasks come first and must fail before the implementation tasks. Paths are under the worktree root. `(new)` marks a file that does not exist yet.

## Format: `- [ ] T### [P?] [US?] Description with path (FR ids)`

## Phase 1: Setup

No new dependency, lib, module or migration (plan, Constitution I). Nothing to set up.

## Phase 2: Foundational (blocks every story)

- [X] T001 [P] Red spec for `VerificationService.countWaiting(db)`: counts files in `submitted` and `in_review` only, over files in each of the five statuses, 0 for none, in `libs/domain/src/garages/verification.service.spec.ts` (FR-001, FR-015)
- [X] T002 [P] Red spec for `AdminOverviewController`: `GET admin/overview` answers `{ garagesWaiting }` from the service and carries `@Requires('admin.garages')` in `libs/domain/src/garages/admin-overview.controller.spec.ts` (new) (FR-001, FR-002)
- [X] T003 [P] Add `AdminOverviewDto { garagesWaiting }` (integer >= 0, `@ApiProperty({ description })`) in `libs/contracts/src/admin.dto.ts` (new) and export it from `libs/contracts/src/index.ts` (FR-001)
- [X] T004 Implement `countWaiting(db)` in `libs/domain/src/garages/verification.service.ts` (FR-001)
- [X] T005 Add `AdminOverviewController` (`@Controller('admin')`, `@Get('overview')`, `@Requires('admin.garages')`, `@ApiTags('admin')`) in `libs/domain/src/garages/admin-overview.controller.ts` (new) and register it in `libs/domain/src/garages/garages.module.ts` (FR-001, FR-002)
- [X] T006 Regenerate `apps/api/openapi.json` (`npx nx run api:openapi`) and the client in `libs/data-access/src/lib/` (`npx nx run data-access:generate`), never by hand (FR-001)

## Phase 3: User Story 1 - Admins only, 404 for everyone else (P1)

**Goal**: an admin lands on Panou; non-admins get 404 on `admin/*` and their own dashboard on `/app/admin`; visitors get 401 and the sign-in dialog.
**Independent test**: sign in as each role, call every `admin/*` route, open `/app/admin`.

- [X] T007 [P] [US1] Red integration spec: boot the API, read every `/api/v1/admin/*` path from the OpenAPI document, assert at least the four known routes, call each as driver, garage, receptionist and mechanic (404 `not_found`), signed out (401 `sign_in_required`), suspended admin (403 `account_suspended`), and the overview as admin with `MAINTENANCE` overridden on (200), in `apps/api/src/admin-routes.integration.spec.ts` (new) (FR-002, FR-003, FR-015, SC-001)
- [X] T008 [P] [US1] Red Playwright spec: seeded admin signs in and lands on `/app/admin`; a driver opening `/app/admin` ends on `/app/driver`; a visitor ends on Home with the sign-in dialog, in `apps/web-e2e/src/admin-dashboard.spec.ts` (new; relative imports end in `.js`) (FR-005, FR-015)
- [X] T009 [US1] Make T007 green: the guard already answers 404/401/403 and does not read maintenance, so add code only if the spec finds a route that answers otherwise (FR-002, FR-003)
- [X] T010 [US1] Confirm no screen, endpoint or command grants `admin` (grep the roles use cases and the OpenAPI document; note the result in `specs/160-admin-dashboard-menu/auto-run.md`) (FR-004)

## Phase 4: User Story 2 - Menu and header show the work waiting (P1)

**Goal**: released entries only, in the fixed order; header line, "ADMINISTRATOR" label, RO/EN, counter on Service-uri; skeleton while loading; counter hidden on failure.
**Independent test**: with the seeded 2 waiting files, read header and counter at 320, 390, tablet, desktop, both languages.

- [X] T011 [P] [US2] Red spec: the admin list holds the seven views in order with capabilities, `users`, `reviews`, `catalogue`, `assistant` unreleased, `garages` carrying the counter key, and `allowedViews` hides an unreleased entry; its address falls through to Panou, in `apps/web/src/app/dashboard/views.spec.ts` (FR-006, FR-007, SC-004)
- [X] T012 [P] [US2] Red spec: the tab bar shows released views only with the short labels, a count chip on the counter tab hidden at 0, "99+" above 99, and an accessible name carrying the full count, in `apps/web/src/app/dashboard/tab-bar.spec.ts` (FR-006, FR-010)
- [X] T013 [P] [US2] Red spec for the overview store: skeleton before the first read, value after it, counter and line hidden (never 0) when a read fails, in `apps/web/src/app/dashboard/admin-overview.spec.ts` (new) (FR-011, SC-005, FR-015)
- [X] T014 [P] [US2] Red frame specs: header line in the RO forms one/few/other/zero and EN one/other/zero, the "ADMINISTRATOR" label, RO/EN switch re-rendering line, label, menu and counters, the Service-uri chip and its accessible name; add `on` to the `Live` mocks and an `AdminService` stub to `apps/web/src/app/dashboard/frame.spec.ts`, `frame.role-switch.spec.ts` and `frame.sign-out.spec.ts` (FR-008, FR-009, FR-010, FR-015)
- [X] T015 [P] [US2] Red seed spec: after `seed()` two garages wait (`service-dobre` `submitted`, `atelier-dinamo` `in_review`), `atelier-test` has no file, a second run adds nothing, in `libs/domain/src/seed.integration.spec.ts` (FR-013)
- [X] T016 [P] [US2] Extend the Playwright spec of T008: seeded admin sees "MotorFix · București · 2 service‑uri așteaptă verificarea", "ADMINISTRATOR" and the counter 2 on a 390 px phone and a desktop, in Romanian and English, no sideways scroll at 320 px, in `apps/web-e2e/src/admin-dashboard.spec.ts` (FR-014, FR-015, SC-002)
- [X] T017 [US2] Add `unreleased?: true` and `counter?: 'garagesWaiting'` to `DashboardView`, the `assistant` view (`admin.settings`), the marks on `users`, `reviews`, `catalogue`, `assistant`, filter them in `allowedViews` and `dashboardRoutes` in `apps/web/src/app/dashboard/views.ts` (FR-006, FR-007)
- [X] T018 [US2] Add the `AdminOverview` store over `liveResource` (loading, value, failed) in `apps/web/src/app/dashboard/admin-overview.ts` (new) (FR-010, FR-011, FR-012)
- [X] T019 [US2] Render the admin subtitle (label, line, skeleton, hidden-on-failure) and the Service-uri chip in `apps/web/src/app/dashboard/frame.ts`, provide `AdminOverview` for the admin area only (FR-008, FR-009, FR-010, FR-011)
- [X] T020 [US2] Add the `counts` input, chip ("99+" above 99, full count in the accessible name), 12 px label size and the 48 px touch target in `apps/web/src/app/dashboard/tab-bar.ts` (FR-006, FR-010, FR-014)
- [X] T021 [P] [US2] Add the shell texts in Romanian and English (`frame.admin.place`, `frame.admin.label`, `frame.admin.none`, `frame.admin.waiting.{one,few,other}`, `frame.counter`, `frame.area.admin` = Administrator, assistant nav and tab labels, the short tab labels, U+2011 in "Service‑uri") in `libs/i18n/src/shell/ro.json` and `libs/i18n/src/shell/en.json` (FR-008, FR-009, FR-014)
- [X] T022 [US2] Add the two idempotent `INSERT ... SELECT ... WHERE NOT EXISTS` verification-file statements to `libs/domain/src/seed.ts` (FR-013)

## Phase 5: User Story 3 - The counters move live (P2)

**Goal**: counters and header re-read on `verification.submitted|decided|reopened` and on reconnect, one re-read per 300 ms burst.
**Independent test**: emit each event and a resync; the count changes without a reload.

- [X] T023 [P] [US3] Red specs in `apps/web/src/app/dashboard/live.spec.ts` for the two `liveResource` additions: matching by kind with no object id, and a `failed` signal true after a failed read (also a re-read after a value) and false after the next success (FR-011, FR-012)
- [X] T024 [P] [US3] Red specs in `apps/web/src/app/dashboard/admin-overview.spec.ts`: a re-read on each of the three kinds, none on `verification.opened`, one re-read for two events inside 300 ms, a re-read on reconnect (resync) (FR-012, FR-015, SC-003)
- [X] T025 [US3] Add the optional id (match by kind) and the `failed` signal to `liveResource` in `apps/web/src/app/dashboard/live.ts` (FR-011, FR-012)
- [X] T026 [US3] Wire the three kinds and the resync in the store of T018 (`admin-overview.ts`) (FR-012)

## Phase 6: Polish

- [ ] T027 Run `npm run lint`, typecheck, the affected unit and integration specs and the Playwright spec through `scripts/heavy.sh`; record the deferred end-to-end live rise for ST-116 in `specs/160-admin-dashboard-menu/deferred.md` (new) (FR-015)

## Dependencies

Phase 2 before Phases 3-5. US1 is independent of US2 and US3 after Phase 2. US3 builds on T018 (US2). Within a phase: red specs, then implementation. T021 and T022 can run beside T017-T020.

## Parallel examples

- Phase 2: T001, T002, T003 together. Phase 4: T011-T016 together, then T017-T022 (T021 and T022 apart from the rest). Phase 5: T023, T024 together.

## Strategy

MVP is Phase 2 plus US1 (the gate and the overview route); then US2 (visible shell), then US3 (live). Each phase ends green and is committed and pushed separately.

# Implementation Plan: Open the admin dashboard and its menu, admins only

**Branch**: `160-admin-dashboard-menu` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/160-admin-dashboard-menu/spec.md`, the Notion digest `context.md` and the design note `design.md`.

## Summary

An admin who opens `/app/admin` sees the admin frame with its header line ("MotorFix · București · {n} service‑uri așteaptă verificarea", a zero form, Romanian and English), the "ADMINISTRATOR" label, and the released entries only (Panou, Service‑uri, Setări) in the side menu and the phone tab bar, Service‑uri carrying the count of garages waiting for verification. The count comes from one new gated route, `GET /api/v1/admin/overview`, counted by the verification service, and is re-read through the dashboards' shared live re-read on `verification.submitted|decided|reopened` and on reconnect; a failed read hides it. Every `admin/*` route answers 404 `not_found` to the other four roles, which the guard already does and a test over the OpenAPI document now proves. The dev/test seed adds one `submitted` and one `in_review` verification file. No new dependency, no new lib, no new module: one controller, one DTO, one small store, a few lines in the frame, the tab bar, the view list, `liveResource`, the shell catalogue and the seed ([research.md](./research.md)).

## Technical Context

Sources: `package.json` (engines `node >=24.0.0` :84-85; `"type": "module"` :108; `postinstall` runs `prisma generate --config libs/domain/prisma.config.ts` :98), `package-lock.json` (versions match), `tsconfig.base.json`, `apps/web-e2e/tsconfig.json`, `nx.json`, `jest.preset.cjs`, `apps/api/project.json`, `libs/data-access/project.json`, `libs/ui-cockpit/src/styles/cockpit.css`, `specs/160-admin-dashboard-menu/context.md` (Constraints).

**Language/Version**: TypeScript 6.0.3 on Node >= 24 (`package.json`); `tsconfig.base.json` targets `es2023`, `module: esnext`, `moduleResolution: bundler`, `strict`, paths `@motor-fix/*`; `apps/web-e2e/tsconfig.json` uses `module`/`moduleResolution` `nodenext`, so relative imports there end in `.js` (other apps and libs do not).

**Primary Dependencies**: `@angular/core`, `@angular/router`, `@angular/cdk`, `@angular/ssr` 22.2.1 (standalone components, signals); `@spartan-ng/brain` 1.5.0 with the helm components copied into `libs/ui-cockpit`; `rxjs` 7.8.2; `@nestjs/core`, `@nestjs/common` 12.1.2 (ESM-only); `@nestjs/swagger` 12.0.2; `class-validator` 0.15.1; `prisma`, `@prisma/client` 7.10.0; `pg` 8.23.1 (the seed); `ng-openapi-gen` 1.1.0 (`libs/data-access/project.json`, target `generate`, after `api:openapi`). Nothing new.

**Storage**: PostgreSQL through Prisma; the count reads `verification_file` (`libs/domain/prisma/schema/garages.prisma:126-146`, migration `20261007120000_verification_file`). No schema change, no migration. Nothing in Redis.

**Testing**: Jest 30.5.2 from the root preset (`jest.preset.cjs`, `JEST_SUITE` unit/integration; `*.integration.spec.ts` need PostgreSQL and Redis; Nest projects run with `--experimental-vm-modules`); `supertest` 7.3.1 for API specs; Playwright 1.63.0 in `apps/web-e2e`; Biome 2.5.15; Nx 23.2.1 (`nx.json` plugins `@nx/jest`, `@nx/webpack`, `@nx/playwright`).

**Target Platform**: the web app (Angular SSR, hydrated in the browser) at 320 px and up, light and dark, Romanian and English; the API on Node 24.

**Project Type**: Nx monorepo: `apps/web`, `apps/api`, `apps/web-e2e`; `libs/contracts`, `libs/domain`, `libs/data-access` (generated), `libs/i18n`, `libs/ui-cockpit`.

**Performance Goals**: the count is one `COUNT` over `verification_file` per read (the table holds at most one live file per garage, index `verification_file_one_live`); a burst of events becomes one re-read after 300 ms (`liveResource`, `apps/web/src/app/dashboard/live.ts:412`); the frame paints with a skeleton, never waits for the count (SC-004).

**Constraints** (context.md): this story reads only, it consumes `verification.*` events and raises none; the count is re-read on reconnect; a failed read hides the count and the counter (never 0, never a stale number); the reported-reviews counter comes only after MF-45 (the Recenzii raportate entry is unreleased here); the city is fixed to București; every text in Romanian and English, 12 px or larger (`--mf-size-label: 12px`, `cockpit.css:28`), wrapping at 320 px with U+2011 in "Service‑uri"; the route is `GET /api/v1/admin/overview`; a non-admin gets 404 on every `admin/*` route (A31), problem details per A28/A42; maintenance mode never closes the admin area; ST-164 depends on the `admin/*` surface and adds no route here. Nothing new is bundled into the web app beyond the shell catalogue keys.

**Scale/Scope**: one new API route and DTO; one new web store and ~40 lines in the frame, the tab bar and the view list; two `liveResource` additions; ~12 shell catalogue keys in two languages; two seed statements; Jest specs for each, one API integration spec over every `admin/*` route, one Playwright spec. No open `NEEDS CLARIFICATION`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.2), evaluated before research and again after design:

- [x] **I. No Bloat (NON-NEGOTIABLE)**: no new dependency, lib or module; the overview route joins the garages module (R1); the release mark is one optional field on the view (R4); the counter reuses `liveResource` with two additions it needed anyway for a count (R5); the header line lives in the frame, not a second header component (R6); the 404 rule and maintenance behaviour are kept by tests, not code (R2, R3). Post-design: unchanged; nothing in Complexity Tracking.
- [x] **II. Test Discipline**: `/speckit-tests` writes the red specs first: `admin-routes.integration.spec.ts` against the booted API with PostgreSQL and Redis, the controller and `countWaiting` specs, `views.spec.ts`, `tab-bar.spec.ts`, `frame.spec.ts` and `admin-overview.spec.ts` colocated in `apps/web/src/app/dashboard`, `live.spec.ts` for the two additions, `seed.integration.spec.ts`, and `apps/web-e2e/src/admin-dashboard.spec.ts` (R9).
- [x] **III. The Given Stack**: Angular signals and the Cockpit theme tokens; NestJS and Prisma; no front-end dependency added.
- [x] **IV. One Repository, One Toolchain**: everything in the existing apps and libs; Biome from the root; no store library (the count is a signal in a component-provided class).
- [x] **V. Rules Live in One Place**: `AdminOverviewDto` in `libs/contracts`; the route documented by `@nestjs/swagger` into `apps/api/openapi.json` and the client regenerated (`npx nx run data-access:generate`); the capability check on the server (`@Requires('admin.garages')`); the released list is the one view list `DASHBOARDS` that the menu, the tab bar and the routes all read (R4, R8).
- [x] **VI. PostgreSQL Is the Truth**: a read-only count over `verification_file`; the seed writes PostgreSQL rows idempotently (R7); nothing in Redis.
- [x] **Notion choices**: A8 (SSE live updates), A31 (404 for a missing capability), A28/A42 (problem details) are decided in Architecture decisions and cited in `context.md`; the role-granting operations command and the release-flag mechanism are open with the owner and this plan builds neither (spec Assumptions; R4 marks the views in code until the owner decides otherwise). No To-decide item is assumed.

## Project Structure

### Documentation (this feature)

```text
specs/160-admin-dashboard-menu/
├── spec.md
├── context.md
├── design.md
├── plan.md              # This file
├── research.md          # R1–R10, each with Evidence path:line
├── data-model.md
├── quickstart.md
├── contracts/
│   └── admin-overview.md
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
libs/contracts/src/
├── admin.dto.ts                                  (new)  AdminOverviewDto { garagesWaiting }
└── index.ts                                             + export

libs/domain/src/garages/
├── admin-overview.controller.ts                  (new)  GET admin/overview, @Requires('admin.garages')
├── admin-overview.controller.spec.ts             (new)
├── verification.service.ts                              + countWaiting(db)
├── verification.service.spec.ts                         + countWaiting
└── garages.module.ts                                    + controller
libs/domain/src/seed.ts                                  + two verification_file inserts
libs/domain/src/seed.integration.spec.ts                 + waiting files, second run

apps/api/src/
├── admin-routes.integration.spec.ts              (new)  every admin/* route, 4 roles → 404; maintenance on → 200
└── public-routes.integration.spec.ts                    unchanged (PUBLIC list)
apps/api/openapi.json                                    regenerated
libs/data-access/src/lib/                                regenerated (AdminService, AdminOverviewDto)

apps/web/src/app/dashboard/
├── views.ts                                             + unreleased?, counter?, assistant view
├── views.spec.ts
├── live.ts                                              + optional id, failed signal in liveResource
├── live.spec.ts
├── admin-overview.ts                             (new)  AdminOverview store over liveResource
├── admin-overview.spec.ts                        (new)
├── frame.ts                                             + admin subtitle, label, counter chip
├── frame.spec.ts                                        + Live.on, AdminService stub, new cases
├── frame.role-switch.spec.ts, frame.sign-out.spec.ts    + Live.on, AdminService stub
├── tab-bar.ts                                           + counts input, chip, aria-label
└── tab-bar.spec.ts

libs/i18n/src/shell/ro.json, en.json                     + frame.admin.*, frame.counter, frame.area.admin, nav/tab assistant

apps/web-e2e/src/
└── admin-dashboard.spec.ts                       (new)  seeded admin: header line, entries, count 2, tab bar at 390 px
```

**Structure Decision**: the API side stays in `libs/domain/src/garages` (the verification service owns the count) and `libs/contracts`; the web side stays in `apps/web/src/app/dashboard`, where the frame, the view list, the tab bar and `liveResource` already live. No new directory.

## Complexity Tracking

No Constitution Check violation; nothing to justify.

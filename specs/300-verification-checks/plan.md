# Implementation Plan: Store each file's checks and their results

**Branch**: `300-verification-checks` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/300-verification-checks/spec.md` (with Clarifications), `context.md` (Notion digest, high confidence), `design.md` (no screens of its own; the mock is not shared with this account).

## Summary

ST-300 is the store behind the verification queue's lamps and summary, with no screen. It adds the `verification_check` table (one row per file and kind, unique on the pair), the `rar_activity` catalogue seeded in the migration, and `garage.rar_activities`. `VerificationService.submit()` and `resend()` create the 8 `not_run` rows with one `createMany … skipDuplicates` inside the caller's transaction, before the event. One new `VerificationChecksService.record()` updates a row, writes its audit entry and its `verification.check_recorded` outbox row in the same transaction and, for `activities`, the garage's list; one new controller exposes it as `PUT /api/v1/admin/verification-files/:id/checks/:kind` behind `@Requires('admin.garages')`. The lamp colour and the summary line are two pure functions in the contracts library, which the queue and file stories reuse.

## Technical Context

Sources: `package.json`, `package-lock.json` (`packages["node_modules/…"].version`), `tsconfig.base.json`, `jest.preset.cjs`, `libs/domain/prisma.config.ts`, `libs/domain/prisma/schema/*.prisma`, `apps/api/project.json`, `libs/data-access/project.json`, `scripts/contract-check.sh`.

**Language/Version**: TypeScript 6.0.3 (`package.json:78`); `target: es2023`, `module: esnext`, `moduleResolution: bundler` (`tsconfig.base.json:9-10,38`); Node `>=24.0.0` (`package.json:85`, `.nvmrc` 24). `libs/domain` and `libs/contracts` compile as `commonjs` (`libs/domain/tsconfig.json:5`, `libs/contracts/tsconfig.json:5`): relative imports carry no extension there and in `apps/api`; only `apps/web-e2e` is `nodenext` (`apps/web-e2e/tsconfig.json:3-4`) and needs `.js`, and it is not touched.

**Primary Dependencies**: NestJS 12.1.2 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `package.json:18-20`), `@nestjs/swagger` 12.0.2 (`:21`), `class-validator` 0.15.1 and `class-transformer` 0.5.1 (`:27-28`); Prisma 7.10.0 (`:23,74`) with the client generated to `libs/domain/src/generated/prisma` as `cjs` (`libs/domain/prisma/schema/schema.prisma:1-5`), `createMany({ skipDuplicates })` available (`generated/prisma/models/VerificationFile.ts:643`); `pg` 8.23.1 (`:73`); `ng-openapi-gen` 1.1.0 and `supertest` 7.3.1 (lockfile). Nx 23.2.1, Jest 30.5.2, Biome 2.5.15. No new dependency.

**Storage**: PostgreSQL through Prisma. Existing: `VerificationFile` (`garages.prisma:171-190`), `Garage` (`:20-38`), `ActivityLog` append-only (`audit.prisma:25-52`), `OutboxEvent` through `EventPort.record` (`libs/domain/src/events/event.port.ts:24-35`). Migrations are hand-written SQL under `libs/domain/prisma/migrations/<stamp>_<name>/migration.sql` (`prisma.config.ts:5`; style of `20261007120000_verification_file`). New: enums `verification_check_kind` and `verification_check_result`, tables `verification_check` and `rar_activity` (seeded in the migration), column `garage.rar_activities text[]`, and a back-fill of 8 `not_run` rows per existing file. See [data-model.md](./data-model.md).

**Testing**: Jest 30.5.2 from the root preset; `*.integration.spec.ts` need PostgreSQL and Redis (`jest.preset.cjs:5-10`), serialised by `serialDatabase` with the `fixtures()` of `libs/domain/src/notifications/notifications.testing.ts:46` as `verification.service.integration.spec.ts:1-18` does; API route specs boot the app with `apiBoot()` from `apps/api/src/api-boot.testing.ts` as `admin-routes.integration.spec.ts:1-57` does (supertest, `signAccessToken`). No Playwright: no screen (spec Assumptions; design.md).

**Target Platform**: NestJS API on Linux (Railway); the contracts library is also compiled into the Angular web app, so the pure functions have no Node import.

**Project Type**: Nx monorepo: `libs/contracts`, `libs/domain` (garages, audit, events modules), `apps/api` (route list, OpenAPI), `libs/data-access` (generated).

**Performance Goals**: submit/resend add one `createMany` (8 rows) to their transaction; a record is one transaction with one file read, one check read, one `update`, one audit insert, one outbox insert, plus one `rar_activity` read and one garage `update` for `activities`; the summary read is 8 rows per file (the queue story's join, not this one's).

**Constraints** (context.md Constraints and Decisions): the rows exist for every file at submission and resend, kept on a resend (ST-300 Rules; clarified: in the transaction, not a consumer); every record audited with old and new values (A27) and its event written in the same transaction (A7, Constitution VI); problem details with lower snake case `code` (A28/A42, `apps/api/src/problem.filter.ts`); non-admins get 404 (A31; `requireCapability`, `policy.ts:45-52`); `verification.check_recorded` goes to the admin channel only (clarified; `{ type: 'platform' }` → `admin`, `system` in `audience.ts:76-77`); the RAR activity list is with the lawyer (T12): seed the five proposed codes; the `evidence` column is dropped until the first automatic look-up (clarified).

**Scale/Scope**: 2 enums, 2 tables, 1 column, 1 migration; 1 new service (one method), 1 new controller (one route), 2 touched methods; 1 contracts module (2 constants, 2 functions, 2 DTOs); ~8 source files new or touched plus their specs.

## Constitution Check

*GATE: evaluated before Phase 0 and again after Phase 1 (both pass).*

- [x] **I. No Bloat**: one service with one method, no per-kind strategy, no evidence column, no consumer of `verification.submitted` (the rows are one `createMany` in the transaction that already exists, research.md R1); the catalogue is seeded by the migration, not a seed script or a CRUD route (R3); the 404/409/422/400 answers reuse `refusal()` from `sign-up.service.ts:24` and `NotFoundException` as `verification.service.ts` does; the summary is one function over a kinds table, no i18n framework (R5). Nothing is exported that this story and the queue story do not call.
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing specs first (quickstart.md lists them): the contracts unit for `lamp` and `checkSummary` (the four exact texts, both languages, the severity and kind order), the domain integration spec on a real database (8 rows at submit, kept at resend, record with audit and outbox in one transaction and none after a thrown one, `activities` writes the garage, 409/422/400/404) and the API spec for the route and the non-admin 404. No FR id in source.
- [x] **III. The Given Stack**: NestJS, Prisma on PostgreSQL, Redis through the existing relay; nothing else.
- [x] **IV. One Repository, One Toolchain**: all inside `libs/domain`, `libs/contracts`, `apps/api`, `libs/data-access`; Biome, root Jest.
- [x] **V. Rules Live in One Place**: the DTOs, kinds, results, lamp and summary in `libs/contracts`, validated at the edge by the global `ValidationPipe` (`apps/api/src/bootstrap.ts:38-44`); `apps/api/openapi.json` and the client regenerated by `npx nx run data-access:generate` (`libs/data-access/project.json:10-15`, which depends on `api:openapi`, `apps/api/project.json:8-10`) and checked by `scripts/contract-check.sh`; one use case (`record`) the three form stories call; the admin check on the server.
- [x] **VI. PostgreSQL Is the Truth**: the check, the garage list, the audit entry and the outbox row are one transaction; the rows are created in the submission's own transaction; nothing lives in Redis.
- [x] **Notion choices**: A7/A27 (audit and outbox), A28/A42 (problem details), A31 (404) cited above from context.md. T12 (the activity list) is the only To-decide item touched: the five codes are the Build brief's proposal, recorded in research.md R3 and to be listed in `deferred.md` when the lawyer's list replaces them; the Decisions page's `[NEEDS CLARIFICATION]` on MF-58 (CAEN from the ONRC record) touches the decision core, not this store.

## Project Structure

### Documentation (this feature)

```text
specs/300-verification-checks/
├── plan.md              # this file
├── research.md          # Phase 0: decisions with evidence
├── data-model.md        # Phase 1: enums, tables, column, migration, audit and event shapes
├── contracts/
│   └── verification-checks.md   # the route, the DTOs, the use case, the pure functions
├── quickstart.md        # Phase 1: how to prove it
└── tasks.md             # /speckit-tasks (not written here)
```

### Source Code (repository root)

```text
libs/domain/prisma/schema/
└── garages.prisma                                   # enum VerificationCheckKind, enum VerificationCheckResult, model VerificationCheck, model RarActivity, Garage.rarActivities String[], VerificationFile.checks
libs/domain/prisma/migrations/
└── 20261007140000_verification_check/migration.sql (new)  # enums, tables, column, catalogue seed, CHECK on detail, back-fill

libs/contracts/src/
├── verification-checks.ts                     (new)  # VERIFICATION_CHECK_KINDS, VERIFICATION_CHECK_RESULTS, lamp(), checkSummary(), RecordVerificationCheckDto, VerificationCheckDto, VerificationCheckRecordedDto
├── verification-checks.spec.ts                (new)
└── index.ts                                           # + export * from './verification-checks'

libs/domain/src/garages/
├── verification.service.ts                            # submit() and resend(): createMany of the 8 rows before announce()
├── verification.service.integration.spec.ts           # + 8 rows at submit, kept at resend, no audit entry per row
├── verification-checks.service.ts             (new)  # VerificationChecksService.record(tx, actor, fileId, kind, body)
├── verification-checks.service.integration.spec.ts (new)
├── verification-checks.controller.ts          (new)  # PUT admin/verification-files/:id/checks/:kind, @Requires('admin.garages')
└── garages.module.ts                                  # + VerificationChecksService (provider), VerificationChecksController

apps/api/src/
├── admin-routes.integration.spec.ts                   # + the route in KNOWN (the non-admin 404 sweep covers it)
└── verification-checks.api.integration.spec.ts (new)  # the route end to end: 200 body, 400/409/422, non-admin 404
apps/api/openapi.json                                  # regenerated
libs/data-access/src/lib/**                            # regenerated (never hand-edited)
```

**Structure Decision**: everything joins the existing garages module (`GaragesModule.register`, `garages.module.ts:29-57`), which already provides `AUDIT_PORT` and gets `EVENT_PORT` through the notifications module it imports; the new controller sits next to `admin-overview.controller.ts`. The `verification.check_recorded` kind is already in `EVENT_KINDS` (`libs/contracts/src/events.ts`). No new lib, module or app.

## Complexity Tracking

No violations. Two deliberate lines of hand-written SQL beyond what Prisma generates, both with precedent: the `CHECK (char_length(detail) <= 200)` (as `garage.brand_note`, `garages.prisma:33`) and the back-fill `INSERT … SELECT` of 8 rows per existing file (a one-off data migration; FR-002).

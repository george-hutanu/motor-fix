# Implementation Plan: Keep garages hidden until approved, with a status flow

**Branch**: `207-garage-approval-flow` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/207-garage-approval-flow/spec.md` (with Clarifications), `context.md` (Notion digest, medium confidence), `design.md` (the mock is not shared with this account; no screens of its own, only the shared labels).

## Summary

ST-207 is the verification state machine and the one public scope, with no screen. It adds a `verification_file` table and `approved_at` on the garage, turns the garage's text status into the enum `draft | approved | suspended`, and ships one `VerificationService` in the garages module whose five use cases (submit, open, decide, resend, reopen) each run a compare-and-set `updateMany` inside the caller's transaction, as `StaffInviteService` already does, and write their audit entry and outbox row there. `publicGarages()` is one `where` fragment; the only public read, `GET /api/v1/garages/{slug}`, goes through it and answers 404 `not_found` or 410 `gone`. The derived status, its seven labels in both languages and the re-approval field list live in the contracts library. A test scans the domain library's `@Public()` handlers and fails naming any garage read that skips the scope.

## Technical Context

Sources: `package.json`, `package-lock.json` (`packages["node_modules/…"].version`), `tsconfig.base.json`, `jest.preset.cjs`, `libs/domain/prisma.config.ts`, `libs/domain/prisma/schema/*.prisma`, `apps/api/project.json`, `libs/data-access/project.json`.

**Language/Version**: TypeScript 6.0.3 (lockfile; `package.json` devDependencies); `target: es2023`, `module: esnext`, `moduleResolution: bundler` (`tsconfig.base.json:9-10,37`); Node `>=24.0.0` (`package.json:85`), `"type": "module"` (`:108`). Relative imports carry no extension in `libs/*` and `apps/api`; only `apps/web-e2e` is `nodenext` and needs `.js` (not touched here).

**Primary Dependencies**: NestJS 12.1.2 (`@nestjs/core`, `@nestjs/common`), `@nestjs/swagger` 12.0.2, `class-validator` 0.15.1; Prisma 7.10.0 with `@prisma/adapter-pg` 7.10.0 on `pg` 8.23.1 (`libs/domain/src/auth/prisma.ts:7-10`), client generated to `libs/domain/src/generated/prisma` (`schema.prisma:1-5`, `postinstall` at `package.json:98`); `ng-openapi-gen` for the client (`libs/data-access/project.json:11`); Nx 23.2.1. No new dependency.

**Storage**: PostgreSQL through Prisma. `Garage(id, name, slug unique, status String default "draft", createdAt)` (`garages.prisma:11-22`); `ActivityLog` append-only (`audit.prisma:21-48`, triggers in `migrations/20261004120000_audit_history/migration.sql:46-58`); `OutboxEvent(kind, subjectId, payload, audience[])` (`events.prisma:5-17`). Migrations: hand-held SQL under `libs/domain/prisma/migrations/<stamp>_<name>/migration.sql`, applied by `prisma migrate deploy --config libs/domain/prisma.config.ts` (`scripts/test-services.ts:88`). New here: `verification_file`, `garage.approved_at`, the `garage_status` and `verification_file_status` enums.

**Testing**: Jest 30.5.2 from the root preset; `*.integration.spec.ts` need PostgreSQL and Redis (`jest.preset.cjs:5-10`), serialised by `serialDatabase` (`libs/domain/src/auth/serial-db.testing.ts`) with the fixtures of `libs/domain/src/notifications/notifications.testing.ts` as `staff-invite.api.integration.spec.ts:20-28` uses them; static AST scans in Jest as `audit-coverage.spec.ts` does. No Playwright here (Assumptions: the end-to-end scenario lands with the search story).

**Target Platform**: NestJS API on Linux (Railway); the contracts library is also compiled into the Angular web app.

**Project Type**: Nx monorepo: `libs/contracts`, `libs/domain` (garages, audit, events modules), `apps/api` (route list, OpenAPI), `libs/data-access` (generated).

**Performance Goals**: every use case is one transaction with one `updateMany`, at most one read for the 409 detail, one audit insert and one outbox insert; the public read is one indexed lookup by `slug` (unique) plus one more only on a miss.

**Constraints** (context.md Constraints and Decisions): public = `status = approved` and nothing else, one scope, a test fails when a read path skips it (ST-207 Rules); every status change audited (A27) and its event written in the same transaction (A7, Constitution VI); problem details with a lower snake case `code` (A28/A42: `apps/api/src/problem.filter.ts`); another's resource answers 404 (A31), a gone public resource 410 (A34); `skip_manual_approval` only under `APP_ENV=test`, never required (A33); the RAR/CAEN gates are ST-203/ST-204/ST-303's, not this machine's (X17); timestamps UTC (`@db.Timestamptz` as every model). Submit must be callable inside ST-116's own transaction (account, garage and file in one go).

**Scale/Scope**: 2 enums, 1 table, 1 column; 5 use cases, 1 scope, 1 endpoint, 1 config reader; 2 contracts files; ~9 source files new or touched plus their specs; one migration.

## Constitution Check

*GATE: evaluated before Phase 0 and again after Phase 1 (both pass).*

- [x] **I. No Bloat**: one service with five methods, no state-machine framework: the allowed transitions are one table `FROM: Record<Transition, Status[]>` fed to `updateMany`'s `status: { in }`; the concurrency rule is that `updateMany` and the row lock, with no advisory lock, no version column and no `SERIALIZABLE` (research.md R1). The scope is a `where` fragment, not a repository. Reason codes are a free string (no code list exists yet, T12). No endpoint beyond the one read; no submit endpoint; no web change. `firstName` is reused from the audit writer by exporting it, not copied.
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing specs first (quickstart.md lists them): the contracts units, the config unit, the state-machine integration spec on a real database (every allowed and refused pair, two concurrent transactions, audit and outbox counts, the switch), the public read API spec, the scope-bypass scan and the `public-routes` list entry. No FR id in source.
- [x] **III. The Given Stack**: NestJS, Prisma on PostgreSQL, Redis through the existing relay; nothing else.
- [x] **IV. One Repository, One Toolchain**: all inside `libs/domain`, `libs/contracts`, `apps/api`, `libs/data-access`; Biome, root Jest.
- [x] **V. Rules Live in One Place**: the DTO, the status derivation, the labels and the re-approval list in `libs/contracts`; `apps/api/openapi.json` by `npx nx run api:openapi` (`apps/api/project.json:8-10`) and the client by `npx nx run data-access:generate` (`libs/data-access/project.json:11-15`); one use case per transition, called by later stories' server code; the admin check (`requireCapability(actor, 'admin.garages')`, `policy.ts:44-52`) on the server.
- [x] **VI. PostgreSQL Is the Truth**: every transition, its audit entry and its outbox row are one transaction (the caller's); the public read reads the database; nothing lives in Redis.
- [x] **Notion choices**: A28/A42 (problem details), A31/A34 (404/410) and A33 (test-only switch) are cited above from context.md; the "cache entries dropped on `verification.decided`" line is marked proposed and this story has no cache, so nothing rests on it. T12 (the code list) touches only the free-string reason code, recorded in research.md R6 as `[NEEDS CLARIFICATION]` for the deciding stories, not assumed here.

## Project Structure

### Documentation (this feature)

```text
specs/207-garage-approval-flow/
├── plan.md              # this file
├── research.md          # Phase 0: decisions with evidence
├── data-model.md        # Phase 1: enums, verification_file, transitions, derived status
├── contracts/
│   └── garage-verification.md   # the public read, the use cases, the contracts exports
├── quickstart.md        # Phase 1: how to prove it
└── tasks.md             # /speckit-tasks (not written here)
```

### Source Code (repository root)

```text
libs/domain/prisma/schema/
└── garages.prisma                                   # enum GarageStatus, Garage.status: GarageStatus, approvedAt; enum VerificationFileStatus; model VerificationFile
libs/domain/prisma/migrations/
└── 20261007120000_verification_file/migration.sql (new)  # enums, column conversion with USING, table, partial unique index

libs/contracts/src/
├── garages.dto.ts                             (new)  # PublicGarageDto { id, name, slug }
├── garage-status.ts                           (new)  # GARAGE_STATUSES, VERIFICATION_FILE_STATUSES, garageStatusKey(), GARAGE_STATUS_LABELS, statusLabel(), REAPPROVAL_FIELDS
├── garage-status.spec.ts                      (new)
└── index.ts                                           # + the two exports

libs/domain/src/garages/
├── garages.module.ts                                  # + VerificationService, PublicGaragesController, VERIFICATION_CONFIG, EVENT_PORT
├── verification-config.ts                     (new)  # verificationConfig(appEnv, source): { skipManualApproval }
├── verification-config.spec.ts                (new)
├── verification.service.ts                    (new)  # submit, open, decide, resend, reopen (each takes tx)
├── verification.service.integration.spec.ts   (new)
├── public-garages.ts                          (new)  # publicGarages() where fragment; PublicGaragesService.bySlug()
├── public-garages.controller.ts               (new)  # GET garages/:slug, @Public()
├── public-garages.api.integration.spec.ts     (new)
└── public-garages.scope.spec.ts               (new)  # AST scan: @Public() handlers → service methods → garage reads spread publicGarages()

libs/domain/src/audit/audit.service.ts                 # export firstName (one word)
libs/domain/src/events/audience.ts                     # verification subject: + published?: { brandIds } → public:garage:{id}, public:search:{brandId}
libs/domain/src/events/audience.spec.ts                # + the published case
libs/domain/src/index.ts                               # + VerificationService, verificationConfig, publicGarages
apps/api/src/app.module.ts                             # GaragesModule.register(email, notifications, verificationConfig(env.APP_ENV, process.env))
apps/api/src/public-routes.integration.spec.ts         # + 'GET /api/v1/garages/<SOME_ID>'
apps/api/openapi.json                                  # regenerated
libs/data-access/src/lib/**                            # regenerated (never hand-edited)
```

**Structure Decision**: everything joins the existing garages module (`libs/domain/src/garages/`, `GaragesModule.register` at `garages.module.ts:19-37`), which already wires `AUDIT_PORT` and imports the notifications module; the `EVENT_PORT` is provided there as the notifications module does for its own services. No new lib, module or app.

## Complexity Tracking

No violations. One deliberate line of hand-written SQL beyond what Prisma generates: the partial unique index `verification_file_one_live` (one `submitted`, `in_review` or `approved` file per garage), which Prisma's schema language cannot express; precedent `20261004120000_audit_history/migration.sql:46-58` (triggers).

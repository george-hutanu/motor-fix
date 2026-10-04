# Implementation Plan: Audit history read API

**Branch**: `391-audit-history-api` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/391-audit-history-api/spec.md`, Notion digest `context.md`, design `design.md` (no screens in this build).

## Summary

Add two capabilities to the one capabilities table (`garage.audit_history` for owner, receptionist and mechanic; `admin.audit_history` for admin), and one read use case `AuditHistoryService.list(actor, query)` in `libs/domain/src/audit` with its controller `GET /audit-history` (served under the global `api/v1` prefix). The use case checks the right through `requireCapability` (404), scopes garage staff to their own garage (404 on another `garageId`), applies the filters and the 7-day default, pages newest first by `(at, id)` with Prisma's cursor (which compares in the database, so microsecond times stay exact), counts the total, and masks `phone`/`plate` values for garage staff. The query and answer DTOs live in `libs/contracts`; the OpenAPI document and the generated Angular client are regenerated.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`), Node 24 (local v24.21.0).

**Primary Dependencies**: NestJS 12.1.2, `@nestjs/swagger` 12.0.2, `class-validator` 0.15.1, `class-transformer` 0.5.1, Prisma 7.10.0 with `@prisma/adapter-pg` (`package.json`). The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) and the RFC 9457 `ProblemFilter` are already configured (`apps/api/src/bootstrap.ts`). The client generator is `ng-openapi-gen` via `npx nx run data-access:generate` (`libs/data-access/project.json`). No new dependency.

**Storage**: PostgreSQL, table `activity_log` from ST-390 with indexes `(garage_id, at)`, `(actor_id, at)`, `(job_id, at)` (`libs/domain/prisma/migrations/20261004120000_audit_history/migration.sql`). No migration in this story. Redis untouched.

**Testing**: Jest from the root config, `--maxWorkers=2`; database specs named `*.integration.spec.ts`, serialized with `serialDatabase()` (`libs/domain/src/auth/serial-db.testing.ts`); local database `motorfix_391`. `activity_log` cannot be truncated (append-only trigger), so each test scopes its rows by fresh garage, actor or job ids.

**Target Platform**: the `api` app on Railway.

**Project Type**: Nx monorepo; touches `libs/domain`, `libs/contracts`, `apps/api/openapi.json`, `libs/data-access` (generated).

**Performance Goals**: "Any other read under 400 ms for 95 of 100 calls" (Security, Performance targets). Two queries per call (page of 21 rows on an `(garage_id, at)` index, and a count).

**Constraints**: 404 never 403 for a missing right or another garage (ST-79 policy, A31); rules in one place (capabilities table, the use case); generated client never hand-edited (constitution V).

**Scale/Scope**: 1 endpoint, 1 service, 1 controller, 3 DTO classes, 2 capabilities.

## Constitution Check

*Pre-design and post-design: PASS.*

- [x] **I. No Bloat**: one service + one controller registered in the existing `AuthModule` (which already hosts the audit writer and exports PRISMA and the guard) rather than a new module that would need a second Prisma client; no `limit` knob; the area table is a plain object; masking is one small recursive function; no repository layer.
- [x] **II. Test Discipline**: red first; a service integration spec colocated with the service (scope, filters, paging, masking, every "may not"), the capabilities spec extended, and an HTTP spec in `apps/api` through `AppModule` + `configureApp` (prefix, 401, 404, 400, answer shape).
- [x] **III. The Given Stack**: NestJS, Prisma, PostgreSQL, Angular client generated.
- [x] **IV. One Repository, One Toolchain**: Biome, root Jest, Nx.
- [x] **V. Rules Live in One Place**: the right is a row in the capabilities table; scope, filters and masking in the one use case the views and a future assistant tool call.
- [x] **VI. PostgreSQL Is the Truth**: read straight from PostgreSQL; no cache (Security: "Anything personal … Not cached").
- [x] **Notion choices**: Prisma (Proposed, confirmed by ST-421/ST-79); parameter names from the Build brief's Data section; no T1–T10 item touched.

## Project Structure

### Documentation (this feature)

```text
specs/391-audit-history-api/
├── spec.md, context.md, design.md, auto-run.md, notion-sync.md
├── plan.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
libs/contracts/src/
├── audit-history.dto.ts           (new) AUDIT_AREAS, AuditHistoryQueryDto, AuditEntryDto, AuditActorDto, AuditHistoryPageDto
└── index.ts                       # export it
libs/domain/src/
├── auth/
│   ├── capabilities.ts            # garage.audit_history (owner, receptionist, mechanic), admin.audit_history (admin)
│   ├── capabilities.spec.ts       # granted table extended; mechanic-permission test keeps the new base
│   ├── auth.module.ts             # registers AuditHistoryController and AuditHistoryService
│   └── auth.api.integration.spec.ts  # mechanic /me capabilities now include garage.audit_history
└── audit/
    ├── audit-history.service.ts               (new) list(actor, query)
    ├── audit-history.service.integration.spec.ts (new)
    └── audit-history.controller.ts            (new) GET /audit-history
apps/api/
├── src/audit-history.api.integration.spec.ts  (new) through AppModule + configureApp
└── openapi.json                                # regenerated
libs/data-access/src/lib/                       # regenerated by ng-openapi-gen
```

**Structure Decision**: the read use case sits next to the writer in `libs/domain/src/audit`; the controller is registered in `AuthModule.register`, which already binds the audit writer and owns the Prisma client.

## Design notes

- **Right**: `actor.role === 'admin' ? 'admin.audit_history' : 'garage.audit_history'` through `requireCapability`; a garage capability without `actor.garageId` already answers 404 there.
- **Scope**: staff → `where.garageId = actor.garageId` (a different `query.garageId` → 404); admin → `query.garageId` if given.
- **Filters**: `at >= from ?? now − 7 days`, `at <= to` if given, `actorId`, `jobId`; `area` → `subjectType in [...]`, `admin_actions` → `actorRole = admin`.
- **Paging**: `findMany({ orderBy: [{ at: 'desc' }, { id: 'desc' }], take: 21, cursor: { id }, skip: 1 })`; 21 rows → `nextCursor` = the 20th id. The cursor is first looked up inside the caller's scope (`findFirst({ where: { id, ...scope } })`); not found → 400 `invalid_cursor`.
- **Total**: `count({ where })` with the same filters, without the cursor.
- **Masking**: for roles other than admin, `field ∈ {phone, plate}` → value `•••`; inside object/array values, keys `phone`/`plate` → `•••`.
- **from > to**: 400 `validation_failed` from the use case (class-validator cannot compare two fields without a custom validator).

## Complexity Tracking

None.

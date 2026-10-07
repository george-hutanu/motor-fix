# Implementation Plan: Admin actions in the audit history

**Branch**: `164-admin-audit-log` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/164-admin-audit-log/spec.md`, the Notion digest `context.md` and the design note `design.md` (no screens).

## Summary

Two admin routes change data without an audit entry today: `POST /api/v1/admin/live/test` records a live update in a transaction of its own (`live.controller.ts:77-99`) and `POST /api/v1/admin/notifications/test` queues a test message per account (`notifications.service.ts:166-185`). Each gets one entry through the existing writer (`AuditService.record`, `audit.service.ts:36-59`): the live test inside its existing transaction, with the admin as actor, the target account as subject and the validated body as new value (FR-002); the test message in one transaction of its own, before any message is queued, with the admin as actor and subject (FR-003). A new guard spec beside `admin-routes.integration.spec.ts` reads every `admin/*` route from the OpenAPI document, calls each once as a seeded admin with a known-good request from a table keyed by `METHOD /path`, and fails naming the route when the answer is not 2xx, when a changing route left no entry by that admin, when a `GET` left one, or when the table has no row for it (FR-004). No table, migration, DTO, endpoint, client regeneration or new dependency: two controllers gain the current actor, one service method gains an actor parameter, one module gains the `AUDIT_PORT` provider line the others already have, and one spec file is new ([research.md](./research.md)).

## Technical Context

Sources: `package.json` (engines `node >=24.0.0`; `"type": "module"` :108; `supertest` 7.3.1 :75, `pg` 8.23.1 :73, `@nestjs/swagger` 12.0.2 :21, `class-validator` 0.15.1 :28), `package-lock.json` (`@nestjs/core` 12.1.2 :8641, `@prisma/client` 7.10.0 :10822, `jest` 30.5.2 :19882, `typescript` 6.0.3 :27939, `supertest` 7.3.1 :26894), `tsconfig.base.json` (:9-10, :37-38), `apps/api/tsconfig.spec.json`, `libs/domain/tsconfig.json`, `nx.json` (:34-40), `jest.preset.cjs`, `apps/api/project.json`, `specs/164-admin-audit-log/context.md` (Constraints).

**Language/Version**: TypeScript 6.0.3 on Node >= 24 (`package.json` engines; `node -v` here 26.5.0); `tsconfig.base.json` targets `es2023`, `module: esnext`, `moduleResolution: bundler`, `strict`; `apps/api/tsconfig.spec.json` compiles specs as `commonjs` with `moduleResolution: bundler`, `libs/domain/tsconfig.json` as `commonjs`. Relative imports in `apps/api` and `libs/domain` carry no extension; only `apps/web-e2e` (nodenext) uses literal `.js`, and this story touches nothing there.

**Primary Dependencies**: `@nestjs/core`, `@nestjs/common` 12.1.2 (ESM-only; the Nest projects' `test` targets run Jest with `--experimental-vm-modules`, AGENTS.md); `@nestjs/swagger` 12.0.2 (the OpenAPI document the guard reads, `apps/api/src/bootstrap.ts` `openApiDocument`); `class-validator` 0.15.1 (`LiveTestDto`, `TestMessageDto`, `SendNewsDto` in `libs/contracts`); `prisma`, `@prisma/client` 7.10.0 (`ActivityLog`, `libs/domain/prisma/schema/audit.prisma:25-52`); `supertest` 7.3.1 and `pg` 8.23.1 (both already used by `apps/api/src/admin-routes.integration.spec.ts:10-11`). Nothing new.

**Storage**: PostgreSQL through Prisma. The entries go to the existing `activity_log` table (`audit.prisma:25-52`, index `[actorId, at]` :50); no schema change, no migration. The live test's entry commits with its `outbox_event` row in the same transaction; the test message's entry commits in a transaction of its own before the `notification` rows (FR-003). Nothing in Redis.

**Testing**: Jest 30.5.2 from the root preset (`jest.preset.cjs`: `*.integration.spec.ts` need PostgreSQL and Redis, `JEST_SUITE` unit/integration); the API specs boot the whole app with `apiBoot()` (`apps/api/src/api-boot.testing.ts`), which takes the database turn (`databaseTurn`) and starts an S3 test store; the domain API specs boot `AuthModule` plus one module under `Test.createTestingModule` (`live.api.integration.spec.ts:31-39`, `notifications.api.integration.spec.ts:32-42`). Biome 2.5.15; Nx 23.2.1 (`@nx/jest/plugin`, `nx.json:34-40`). Playwright: none in this story (FR-007).

**Target Platform**: the API on Node 24 (`apps/api`), served under `/api/v1`.

**Project Type**: Nx monorepo; touched projects `api` (one new spec) and `domain` (two controllers, one service, one module, three specs). `contracts`, `data-access`, `web`, `worker`, `mcp` untouched.

**Performance Goals**: one `INSERT` into `activity_log` per admin call (two for a verification approval, unchanged); the test-message route makes one extra short transaction before its per-account loop. The guard spec makes one HTTP call per `admin/*` route (four today) plus two `COUNT` queries each, inside the existing API boot.

**Constraints** (context.md): entries go into the one audit history (ACTIVITY_LOG) through the ST-390 writer, never a log of their own; the entry and the change commit together or not at all, a failed entry fails the request with 500; reads are not logged; `via_assistant` false for every admin entry (no admin assistant exists); entries are not outbox events and nobody is notified; the table is append-only (390-FR-011, not repeated here); `admin/*` calls by non-admins answer 404 (ST-160's spec, unchanged); the guard test is the HTTP-level counterpart of the service-level coverage spec `libs/domain/src/audit/audit-coverage.spec.ts`; ST-164 is slice 5 of EP-2 and the decision core (ST-303) and the platform rules (ST-258) are held to it by the guard. Retention (T10) and anonymisation are open with the lawyer and block nothing here.

**Scale/Scope**: ~12 lines in `live.controller.ts`, ~12 in `notifications.service.ts`, 2 in `notifications.controller.ts`, 2 in `events.module.ts`; one new spec (~90 lines) in `apps/api/src`; additions to three existing specs. No open `NEEDS CLARIFICATION`: the kinds and values are decided in the spec's Clarifications.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.2), evaluated before research and again after design:

- [x] **I. No Bloat (NON-NEGOTIABLE)**: no new dependency, lib, module, table, DTO, endpoint or helper; the two entries are two `audit.record` calls on the existing writer (R1, R2); the `AUDIT_PORT` provider in `EventsModule` is the one line the other modules already carry (R1); the guard spec is one `it.each` over the OpenAPI routes with a four-row fixture table and counts through the `pg` client the neighbouring spec already opens (R3, R4); no exemption list, no decorator, no registry of audited routes. Post-design: unchanged; nothing in Complexity Tracking.
- [x] **II. Test Discipline**: `/speckit-tests` writes the red specs first: `apps/api/src/admin-audit.integration.spec.ts` (the guard, against the booted API on PostgreSQL and Redis), the entry's fields in `libs/domain/src/events/live.api.integration.spec.ts`, the entry, its order and the failed-send case in `libs/domain/src/notifications/notifications.service.integration.spec.ts` and `notifications.api.integration.spec.ts`; all colocated with their source (R5). No FR id in source.
- [x] **III. The Given Stack**: NestJS, Prisma, PostgreSQL; nothing on the front end.
- [x] **IV. One Repository, One Toolchain**: everything in `apps/api` and `libs/domain`; Biome from the root; root Jest preset.
- [x] **V. Rules Live in One Place**: the rule "every changing admin route writes an entry" is enforced by one test, the guard, and the entries are written by the one writer; the test message's entry sits in the use case (`NotificationsService.sendTestMessage`) that the controller calls, so a later caller (the MCP server) records it too (R2); the live test's entry sits in the controller because its whole use case is the controller's transaction today (`live.controller.ts:84-98`) and moving it into a service would be a single-implementation layer (R1). OpenAPI unchanged: `@CurrentActor()` is a request-scoped param decorator (`actor.guard.ts:43-46`), not a documented parameter, so `apps/api/openapi.json` and the generated client stay as they are (R6).
- [x] **VI. PostgreSQL Is the Truth**: the live test's entry and its outbox event commit in one transaction; the test message's entry commits before the queued rows, as FR-003 decides; nothing in Redis holds the only copy.
- [x] **Notion choices**: ACTIVITY_LOG as the one history and the writer-in-transaction rule are decided (ST-390, context.md Decisions); `actor_name` as the first name is Proposed on ST-390 and already the writer's behaviour (`audit.service.ts:64-73`); 404 for non-admins is A31 (ST-160). T10 (retention) is open with the lawyer and this plan deletes nothing; no To-decide item is assumed.

## Project Structure

### Documentation (this feature)

```text
specs/164-admin-audit-log/
├── spec.md
├── context.md
├── design.md
├── plan.md              # This file
├── research.md          # R1–R6, each with Evidence path:line
├── data-model.md
├── quickstart.md
├── contracts/
│   └── admin-audit-entries.md
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
libs/domain/src/events/
├── live.controller.ts                                   + @CurrentActor() actor, @Inject(AUDIT_PORT) audit, one audit.record in test()
├── events.module.ts                                     + { provide: AUDIT_PORT, useClass: AuditService }
└── live.api.integration.spec.ts                         + the entry's fields; none on 404

libs/domain/src/notifications/
├── notifications.service.ts                             sendTestMessage(actor, accountIds): entry first, in its own transaction
├── notifications.controller.ts                          + @CurrentActor() actor passed through
├── notifications.service.integration.spec.ts            + entry before the rows; failed send keeps it; failed entry queues nothing
└── notifications.api.integration.spec.ts                + the entry's fields over HTTP; none on 400

apps/api/src/
├── admin-routes.integration.spec.ts                     unchanged (404 for non-admins)
└── admin-audit.integration.spec.ts               (new)  the guard: every admin/* route, fixture table, entry count per call
```

**Structure Decision**: the two entries live where the two routes' use cases already live (`libs/domain/src/events`, `libs/domain/src/notifications`); the guard sits beside the existing route-wide admin spec in `apps/api/src`, which already boots the whole API and reads the OpenAPI document. No new directory.

## Complexity Tracking

No Constitution Check violation; nothing to justify.

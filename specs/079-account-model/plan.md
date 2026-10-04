# Implementation Plan: Account model, roles and their rights

**Branch**: `079-account-model` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/079-account-model/spec.md`, Notion digest `context.md`, design `design.md`.

## Summary

Add the `auth` and minimal `garages` tables (Prisma, one migration), an `AuthModule` in `libs/domain` holding the capabilities table, the actor guard (HS256 bearer access token → actor loaded from PostgreSQL), the policy (`allows`, `requireCapability`, `assertOwner`, `assertGarage`, `describeCustomer`), the account use cases (`createAccount`, `grantRole`) writing through an audit port and an event port bound to no-ops, and `GET /api/v1/me`. In `web`, add routing with a home route, three lazy dashboard areas behind a `canMatch` guard, and one dashboard frame component.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Node ≥ 24 (`package.json` engines; local v24.21.0).

**Primary Dependencies**: NestJS 12.1.2, @nestjs/swagger 12.0.2, class-validator 0.15.1, Prisma 7.10.0 with `@prisma/adapter-pg` (`package.json`; generator `prisma-client`, CJS, output `libs/domain/src/generated/prisma` per `libs/domain/prisma/schema/schema.prisma`), Angular 22.2.1 with `@angular/router` 22.2.1 (`node_modules/@angular/router/package.json`). No new dependency: HS256 via `node:crypto`.

**Storage**: PostgreSQL (truth); Redis untouched by this story.

**Testing**: Jest 30 via `@nx/jest` per project (`jest.config.ts` → `getJestProjectsAsync`), ts-jest; API tests on real PostgreSQL (`DATABASE_URL`) and Redis (`REDIS_URL`) as `apps/api/src/bootstrap.spec.ts` does; Angular tests with jest-preset-angular (`apps/web/jest.config.cts`); Playwright in `apps/web-e2e` (`playwright.config.mts`).

**Target Platform**: Linux containers on Railway (api, web SSR).

**Project Type**: Nx monorepo — apps `api`, `web`, `web-e2e`; libs `domain`, `contracts`, `data-access` (generated).

**Performance Goals**: the actor is loaded with one query per protected call (account with roles, memberships, mechanic link via `include`). No target in Notion; none invented.

**Constraints**: 404 not 403 for rights and ownership (A31, ST-79 brief); RFC 9457 problem details with a `code` (A28, `apps/api/src/problem.filter.ts`); event and audit inside the change's transaction (A7, constitution VI); the generated client is never edited by hand (constitution V); API module import is one line in `apps/api/src/app.module.ts` (orchestrator rule).

**Scale/Scope**: 7 tables, 1 endpoint, 3 routes, 1 frame component.

## Constitution Check

*Pre-design and post-design: PASS.*

- [x] **I. No Bloat**: no new dependency (JWT in ~30 lines of `node:crypto`); no new lib (`libs/auth` from the brief folded into `libs/domain/src/auth`, AGENTS.md "a lib is created by the story that first needs it" and Principle I). Two ports with one no-op implementation each — justified in Complexity Tracking. No repository layer: use cases call Prisma directly. Guard is opt-in per controller, no global guard + public decorator machinery.
- [x] **II. Test Discipline**: red tests first (`/speckit-tests`); specs colocated; API tests against the real `motorfix_st079` database migrated with `prisma migrate deploy`; Playwright for the frame landing.
- [x] **III. The Given Stack**: Angular router, NestJS guard, Prisma, PostgreSQL. PrimeNG is not used yet: the frame is semantic HTML until the Cockpit theme (ST-50) lands; no second UI framework.
- [x] **IV. One Repository, One Toolchain**: fits `api`, `web`, `libs/domain`, `libs/contracts`; Biome only.
- [x] **V. Rules Live in One Place**: the capabilities table exists once, on the server; the web reads the actor's capabilities from `GET /me` through the generated client (`npx nx run data-access:generate`). `MeDto` lives in `libs/contracts`.
- [x] **VI. PostgreSQL Is the Truth**: `account.created` is handed to the event port inside the account's transaction; ST-257 binds the outbox.
- [x] **Notion choices**: Prisma (A6, Proposed, confirmed here); problem details (A28, Proposed, already in the repo); 404 rule (A31, Proposed, the story adopts it). No T1–T10 item touched.

## Project Structure

### Documentation (this feature)

```text
specs/079-account-model/
├── spec.md, context.md, design.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/me.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
libs/domain/prisma/schema/auth.prisma                 # Account, AccountRole, AccountIdentity, RefreshToken
libs/domain/prisma/schema/garages.prisma              # (new) Garage, GarageMember, Mechanic — minimal
libs/domain/prisma/migrations/20261004053640_accounts/          # (new) migration.sql + migration_lock.toml
libs/domain/src/audit/audit.port.ts                   # (new) AuditPort, AUDIT_PORT, no-op
libs/domain/src/events/event.port.ts                  # (new) EventPort, EVENT_PORT, no-op
libs/domain/src/auth/capabilities.ts (+ .spec.ts)     # (new) roles, capabilities table, allows()
libs/domain/src/auth/policy.ts (+ .spec.ts)           # (new) requireCapability, assertOwner, assertGarage, describeCustomer
libs/domain/src/auth/access-token.ts (+ .spec.ts)     # (new) signAccessToken, verifyAccessToken
libs/domain/src/auth/actor.guard.ts                   # (new) ActorGuard, @Requires, @CurrentActor, actor loading
libs/domain/src/auth/accounts.service.ts (+ .spec.ts) # (new) createAccount, grantRole (DB tests)
libs/domain/src/auth/me.controller.ts                 # (new) GET /me
libs/domain/src/auth/auth.module.ts                   # (new) AuthModule.register({ databaseUrl, tokenSecret })
libs/domain/src/auth/auth.api.spec.ts                 # (new) HTTP tests: 401/403/404, /me, route list
libs/domain/src/index.ts                              # one export line
libs/contracts/src/me.dto.ts, index.ts                # (new) MeDto
apps/api/src/app.module.ts, main.ts                   # one import line; AUTH_TOKEN_SECRET in readEnv
apps/api/src/problem.filter.ts (+ spec)               # keep an exception's own `code`
apps/api/openapi.json, libs/data-access/src/lib/**    # regenerated, never hand-edited
apps/web/src/app/app.ts, app.config.ts, app.routes.ts (new), app.routes.server.ts
apps/web/src/app/home/home.ts (+ spec)                # (new) skeleton content moved from app.ts unchanged
apps/web/src/app/dashboard/session.ts                 # (new) Session: who-am-I signal
apps/web/src/app/dashboard/area.guard.ts (+ spec)     # (new) canMatch guard
apps/web/src/app/dashboard/frame.ts (+ spec)          # (new) dashboard frame
apps/web-e2e/src/dashboards.spec.ts                   # (new)
.env.example, .github/workflows/ci.yml                # AUTH_TOKEN_SECRET; migrate before tests
```

**Structure Decision**: the auth module lives in the existing `domain` lib next to `health`; contracts hold only the DTO; the web reads capabilities from `/me`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `AuditPort` with one (no-op) implementation | The user and the brief require it: ST-390 binds the real writer; account use cases must not change then | Calling nothing now would force ST-390 to edit every account use case and lose the "same transaction" contract |
| `EventPort` with one (no-op) implementation | `account.created` must be written in the account's transaction (constitution VI); the outbox (ST-257) is slice 4 | Building OUTBOX_EVENT here is ST-257's scope and its relay; emitting nothing breaks VI the day ST-257 lands |
| `signAccessToken` used only by tests in this story | ST-82 issues tokens with it; the guard and the issuer must share one format (Principle V) | Leaving signing to ST-82 would let two token formats drift |

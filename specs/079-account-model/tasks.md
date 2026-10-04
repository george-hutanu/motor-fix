# Tasks: Account model, roles and their rights

**Input**: spec.md, plan.md, data-model.md, contracts/me.md, research.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 Add `AUTH_TOKEN_SECRET` to `.env.example` (api section) and a `prisma migrate deploy --config libs/domain/prisma.config.ts` step before the test steps in `.github/workflows/ci.yml` with `AUTH_TOKEN_SECRET` set in the job env (FR-011)

## Phase 2: Foundational (blocks every story)

- [X] T002 Prisma models in `libs/domain/prisma/schema/auth.prisma`: `Account` (`email` unique nullable, `phone` unique nullable, `language` enum `ro|en` default `ro`, `status` enum `active|suspended|deleted` default `active`, `lastRole` Role, `lastActiveAt?`, `emailVerifiedAt?`, `phoneVerifiedAt?`, `city?`, `createdAt`), `AccountRole` (PK account+role, enum `driver|garage|receptionist|mechanic|admin`), `AccountIdentity` (method enum `password|google|apple|whatsapp_phone`, `subject`, `passwordHash?`, unique (method, subject)), `RefreshToken` (`tokenHash` unique, `familyId` indexed, `expiresAt`, `usedAt?`); uuid ids, snake_case `@@map` (FR-001, FR-002, FR-003, FR-004)
- [X] T003 [P] Prisma models in `libs/domain/prisma/schema/garages.prisma` (new): `Garage` (`slug` unique, `status` default `draft`), `GarageMember` (PK garage+account, role enum `owner|receptionist`, unique (account, role), `joinedAt`), `Mechanic` (`accountId` unique, three permissions default false) (FR-005)
- [X] T004 Generate the migration `libs/domain/prisma/migrations/20261004053640_accounts/migration.sql` (new) with `prisma migrate dev --create-only`, apply it to `motorfix_st079`, regenerate the client (FR-001, FR-002, FR-003, FR-004, FR-005)
- [X] T005 [P] `apps/api/src/problem.filter.ts`: an HttpException body with a string `code` keeps it (FR-011)

## Phase 3: User Story 1 — one account, several roles (P1)

Independent test: `createAccount` writes account, role, identity; ports called in the transaction; a failing port leaves no row.

- [X] T006 [P] [US1] `libs/domain/src/audit/audit.port.ts` (new): `AuditPort.record(tx, entry)`, `AUDIT_PORT`, no-op binding (FR-008)
- [X] T007 [P] [US1] `libs/domain/src/events/event.port.ts` (new): `EventPort.record(tx, event)`, `EVENT_PORT`, no-op binding (FR-008)
- [X] T008 [US1] `libs/domain/src/auth/accounts.service.ts` (new): `createAccount` (trim/lower-case e-mail, refuse empty roles, one transaction: account + roles + identity + `account.created` + one audit entry per role, actor = new account) and `grantRole(tx, actor, accountId, role)` (no-op when held) (FR-006, FR-007, FR-009)

## Phase 4: User Story 2 — every call runs as an actor (P1)

Independent test: HTTP 401/403/404 and `GET /me` against the real database.

- [X] T009 [P] [US2] `libs/domain/src/auth/capabilities.ts` (new): roles, capability names of FR-010, the table, `capabilitiesOf(actor)` with mechanic permission gates (FR-010, FR-014)
- [X] T010 [P] [US2] `libs/domain/src/auth/access-token.ts` (new): HS256 `signAccessToken`, `verifyAccessToken` (null for malformed, wrong key, expired) (FR-011)
- [X] T011 [P] [US2] `libs/domain/src/auth/policy.ts` (new): `roleInUse`, `landingFor`, `requireCapability`, `assertOwner`, `assertGarage` (404), `describeCustomer(actor, customer, { ownJob })` (FR-012, FR-013, FR-015)
- [X] T012 [US2] `libs/domain/src/auth/actor.guard.ts` (new): `ActorGuard` (401 `sign_in_required`, 403 `account_suspended` first, then `@Requires` → 404), `@Requires`, `@CurrentActor`, actor with garage from the matching membership or mechanic link (FR-011, FR-012, FR-013)
- [X] T013 [US2] `libs/contracts/src/me.dto.ts` (new) + export in `libs/contracts/src/index.ts`; `libs/domain/src/auth/me.controller.ts` (new) `GET /me` (FR-016)
- [X] T014 [US2] `libs/domain/src/auth/auth.module.ts` (new) `AuthModule.register({ databaseUrl, tokenSecret })` with Prisma client, ports, guard, controller; export from `libs/domain/src/index.ts`; one import in `apps/api/src/app.module.ts`; `AUTH_TOKEN_SECRET` in `apps/api/src/main.ts` and the `openapi` target env in `apps/api/project.json` (FR-011, FR-016)
- [X] T015 [US2] Regenerate `apps/api/openapi.json` and `libs/data-access` with `npx nx run data-access:generate` (FR-016)

## Phase 5: User Story 3 — each role lands on its frame (P2)

Independent test: with a stubbed "who am I" per role, each address ends on the right frame; menu filtered; no "Vezi ca".

- [X] T016 [US3] Routing: `apps/web/src/app/app.routes.ts` (new), `provideRouter` in `apps/web/src/app/app.config.ts`, `app.ts` becomes `<router-outlet />`, skeleton moved to `apps/web/src/app/home/home.ts` (new) with its spec moved to `home.spec.ts`; `app/**` client-rendered in `app.routes.server.ts` (FR-017)
- [X] T017 [US3] `apps/web/src/app/dashboard/session.ts` (new): loads "who am I" once through the generated client; `area.guard.ts` (new): `canMatch` → true for the actor's area, else `UrlTree` of `landing`, Home `/` when signed out (FR-017)
- [X] T018 [US3] `apps/web/src/app/dashboard/frame.ts` (new): aside (logo → `/`, role tag, `nav` "Meniu" filtered by capabilities, name, "Ieși din cont" at the bottom), header `h1`, main empty state "Nimic aici încă."; no "Vezi ca" (FR-017, FR-018)

## Phase 6: Polish

- [X] T019 Mark tasks, update `specs/079-account-model/auto-run.md`; run `npm run typecheck`, `npm run lint`, the touched Jest projects and the e2e

## Tests (written first by `/speckit-tests`; FR → test)

| FR | Test file |
|----|-----------|
| FR-001, FR-002, FR-003, FR-004, FR-005 | `libs/domain/src/auth/accounts.service.spec.ts` (constraints: unique e-mail case-insensitive, one owner membership, mechanic defaults) |
| FR-006, FR-007, FR-008, FR-009 | `libs/domain/src/auth/accounts.service.spec.ts` |
| FR-009 (route list), FR-011, FR-013, FR-016 | `libs/domain/src/auth/auth.api.spec.ts` |
| FR-010, FR-014 | `libs/domain/src/auth/capabilities.spec.ts` |
| FR-011 (token) | `libs/domain/src/auth/access-token.spec.ts` |
| FR-012, FR-013, FR-015 | `libs/domain/src/auth/policy.spec.ts` |
| FR-011 (code passthrough) | `apps/api/src/problem.filter.spec.ts` (new) |
| FR-017 | `apps/web/src/app/dashboard/area.guard.spec.ts`, `apps/web-e2e/src/dashboards.spec.ts` |
| FR-018 | `apps/web/src/app/dashboard/frame.spec.ts` |

## Dependencies

Setup → Foundational → US1 and US2 (US2's API test needs US1's `createAccount` to seed) → US3 (needs the generated `/me` client). [P] tasks touch separate files.

## Implementation Strategy

Slice commits: (1) schema + migration + ports + accounts use cases; (2) capabilities, token, policy, guard, `/me`, API wiring, generated client; (3) web routing, guard, frame, e2e.

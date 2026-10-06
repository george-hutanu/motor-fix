# Implementation Plan: Refuse an expired token on every gated route

**Branch**: `563-expired-token-sweep` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/563-expired-token-sweep/spec.md`
(ST-563, EP-1 Foundations; test-only).

## Summary

Add one `it` to the API route sweep, `apps/api/src/public-routes.integration.spec.ts`,
that creates a driver account, signs an access token for it whose expiry is
well in the past, proves a fresh token for the same account gets 200 from
`GET /api/v1/me`, then calls every route outside `PUBLIC` with the expired
token and requires the guard's refusal (401, `sign_in_required`, no
`set-cookie`). The file takes `databaseTurn` for its run so a parallel suite
cannot empty the account meanwhile. No product code changes.

## Technical Context

**Language/Version**: TypeScript 6.0.3 on Node >=24 (`package.json`
`devDependencies.typescript`, `engines.node`; `.nvmrc` 24; lockfile
`node_modules/typescript` 6.0.3). Spec files compile with
`module: commonjs`, `moduleResolution: bundler` (`apps/api/tsconfig.spec.json`),
so imports carry no `.js` extension.

**Primary Dependencies**: NestJS 12.1.2 (`@nestjs/core`, `@nestjs/testing`;
lockfile), supertest 7.3.1, `@prisma/client` 7.10.0. Test helpers already in
the repo: `signAccessToken` and `AccountsService` from `@motor-fix/domain`
(`libs/domain/src/index.ts:1-2`), `databaseTurn` and `S3TestStore` from
`@motor-fix/domain/testing` (`tsconfig.base.json` maps it to
`libs/domain/src/storage/s3-test-store.ts`, which re-exports `databaseTurn`
at line 13). No new dependency.

**Storage**: the test's PostgreSQL and Redis (`DATABASE_URL`, `REDIS_URL`,
as the sweep already reads them); one `account` row written by the test.

**Testing**: Jest 30.5.2 through the root preset (`jest.preset.cjs`;
`apps/api/jest.config.cts`, ts-jest with `tsconfig.spec.json`). The file is an
`*.integration.spec.ts`, so `JEST_SUITE=integration` includes it and CI's
Integration tests job runs it. Nx 23.2.1 (`nx.json`, `apps/api/project.json`
`test` target).

**Target Platform**: Node server test, Linux CI runner and the laptop.

**Project Type**: Nx monorepo, app `api` (NestJS).

**Performance Goals**: N/A (a test). The new case adds one request per
non-public route plus two account/token calls; the existing `it.each` already
does three such passes.

**Constraints**: test-only (FR-006); the smallest change (Constitution I,
SC-004); the token must be refused for expiry alone (FR-001, FR-004);
`verifyAccessToken` rejects `claims.exp * 1000 <= now`
(`libs/domain/src/auth/access-token.ts:66`) and `signAccessToken` sets
`exp = iat + 15 min` by default (`access-token.ts:28,32`), so a `now` of
`Date.now() - 24h` is clearly past.

**Scale/Scope**: one spec file; roughly 25 added lines.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat**: one new `it`, one account, two tokens, one lock; the
  guard-refusal predicate is shared with the no-credential case only if
  extracting it is smaller than repeating three comparisons. No helper
  module, no new export, no change to `libs/domain`.
- [x] **II. Test Discipline**: the deliverable is the test; it runs against
  real PostgreSQL and Redis like the rest of the sweep; `/speckit-tests` writes
  it red-first (it fails until it exists, and would fail on a route that
  honours an expired token).
- [x] **III. The Given Stack**: NestJS, PostgreSQL, Redis, TypeScript; nothing
  added.
- [x] **IV. One Repository, One Toolchain**: root Jest, Biome; the file stays
  in `apps/api/src`.
- [x] **V. Rules Live in One Place**: the sweep reads its route list from the
  OpenAPI document at test time (`openApiDocument(app).paths`), so no second
  list is kept (FR-003).
- [x] **VI. PostgreSQL Is the Truth**: not touched; the account is created
  through `AccountsService.createAccount`, the product's own path.
- [x] **Notion choices**: none relied on. `context.md` records the token
  lifetime as unread in Architecture; the design does not depend on it beyond
  "clearly past", which a 24-hour-old issue time satisfies for any lifetime
  under a day.

Post-design re-check: unchanged, all gates pass. Complexity Tracking stays
empty.

## Project Structure

### Documentation (this feature)

```text
specs/563-expired-token-sweep/
├── plan.md              # This file
├── research.md          # Phase 0: the five design decisions with evidence
├── quickstart.md        # Phase 1: how to run the sweep and what it must show
├── data-model.md        # N/A: no entity is added or changed (one existing account row is written by the test)
├── contracts/           # N/A: no API shape changes; the sweep reads the existing OpenAPI document
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/src/
├── public-routes.integration.spec.ts   # the only file changed: databaseTurn in beforeAll/afterAll, one new `it`
└── sign-up-confirmation.integration.spec.ts   # pattern for databaseTurn (lines 23, 30, 52), unchanged

libs/domain/src/
├── index.ts                            # exports signAccessToken, AccountsService (read only)
├── auth/access-token.ts                # signAccessToken(claims, secret, now, minutes = 15) (read only)
├── auth/database-turn.testing.ts       # databaseTurn (read only)
├── auth/me.controller.ts               # GET /me (read only)
└── auth/actor.guard.adversary.integration.spec.ts   # pattern for createAccount + signAccessToken (lines 79-86), unchanged
```

**Structure Decision**: the change lives entirely in the existing sweep file;
no new file, module or export.

## Design

1. **Lock**: `const turn = databaseTurn(env.DATABASE_URL);` next to `store`;
   `await turn.take()` first in `beforeAll`, `await turn.release()` last in
   `afterAll` (as `sign-up-confirmation.integration.spec.ts:23,30,52`).
   `beforeAll` gets the same `120_000` timeout as that file, since taking the
   lock can wait on another worker.
2. **Account and tokens**, inside the new `it` (not `beforeAll`, so the
   existing cases stay untouched): `app.get(AccountsService).createAccount({
   identity: { method: 'google', subject: `driver-${randomUUID()}` }, name,
   roles: ['driver'] })`, then `signAccessToken({ accountId: id, role: 'driver' },
   env.AUTH_TOKEN_SECRET)` (fresh) and the same with
   `Date.now() - 24 * 60 * 60 * 1000` (expired).
3. **Control assertion first** (FR-004): `GET /api/v1/me` with the fresh token
   expects 200.
4. **Sweep** (FR-001..003): for each route not in `PUBLIC`, call with
   `Bearer <expired>` and require 401, `code === 'sign_in_required'` and no
   `set-cookie` header, reported with the path as the `it.each` rows do. The
   `byGuard` check of the no-credential case is lifted to a small
   `refusedByGuard(res)` predicate only if that keeps the file shorter than
   repeating it; otherwise the three comparisons are written inline.
5. **Nothing else**: `PUBLIC`, the existing `it`s and all product code are
   unchanged (FR-006, SC-003).

## Complexity Tracking

None: no Constitution Check violation.

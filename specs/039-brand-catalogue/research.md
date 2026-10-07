# Research: Brand catalogue and its upkeep

Phase 0 of `/speckit-plan` for `specs/039-brand-catalogue`. Every unknown of the Technical Context is resolved below; no `NEEDS CLARIFICATION` remains. The research was done by reading this repository (no agent dispatch was needed: every question had its answer in a file).

## 1. Where the brand data file lives and what it is

- **Decision**: a TypeScript constant, `libs/domain/src/catalogue/brands.ts`, exporting `BRANDS: readonly BrandRecord[]` with `{ key: string; name: string; popularity?: number }`; versioned in git; the slug is derived from the name.
- **Rationale**: a `.ts` file is typed (a malformed row fails `typecheck`), bundles into the api with no copy step, and needs no Jest change: the domain Jest config lists `moduleFileExtensions: ['ts', 'js', 'html']`, so a `.json` import would need a config change and a `require` shim. The api is bundled by webpack (`apps/api/webpack.config.cjs`), so the constant ships inside `main.js`. The slug is a pure function of the name for every brand in the brief ("Škoda" → "skoda", "Mercedes-Benz" → "mercedes-benz"), so a slug column would be a second place to get wrong.
- **Alternatives considered**: `brands.json` under `libs/domain/prisma/` copied like the seed (Dockerfile copies that folder into the api image) — extra copy and extra Jest config; a CSV read at run time — a parser for no gain.
- **Evidence**: `libs/domain/jest.config.cts:4`, `apps/api/webpack.config.cjs:13-22`, `Dockerfile:22-26`, spec FR-002/FR-003 and scenario 1.

## 2. Where the loader runs at deploy and in development

- **Decision**: `apps/api/src/main.ts`, one awaited line after `configureApp(app, env)` and before `app.listen`, on the listening path only: `await app.get(BrandLoader).load(BRANDS)`.
- **Rationale**: the api is deployed with `npx prisma migrate deploy` as its pre-deploy step and then boots, so a boot-time load runs after every migration in every environment (Railway production and staging, `nx serve api`, the e2e job's API, the PR QA runner) with no change to `scripts/railway-deploy.ts`, its specs, the Dockerfile or `seed.ts`. The loader is idempotent and reads ~100–200 rows, so a boot costs one SELECT. It must not run for the `openapi` command: CI's Checks job runs the Contract check (which boots `main.js openapi`) before the Compose stack step, with no database. A Nest `onModuleInit` would run there too, so the call sits in `main.ts` after the `openapi` branch. `seed.ts` imports nothing from the workspace (it runs under Node's type stripping with `pg` only), so it cannot call the loader; the seed is not changed.
- **Alternatives considered**: `node main.js load-brands` as a second pre-deploy command — changes `railway-deploy.ts`, its specs and every developer's routine; `CatalogueModule.onModuleInit` — runs in the `openapi` command without a database and in every integration test's `app.init()`; the seed — cannot import the loader, and a duplicate of the loader in SQL would be a second rule.
- **Evidence**: `scripts/railway-deploy.ts:294`, `apps/api/src/main.ts:23-28`, `.github/workflows/ci.yml` Checks job order (Contract check before `docker compose up`, line 93), `libs/domain/src/seed.ts:1-2`, `scripts/reset-staging.sh`.

## 3. Audit of loader changes

- **Decision**: the existing `AuditPort` (`AUDIT_PORT` → `AuditService`), inside the loader's transaction: `record(tx, { action: 'create', subjectType: 'brand', subjectId, actorId: null, actorRole: 'system', newValue })` for a new brand and `recordChanges(tx, change, before, after)` for `name`, `slug`, `popularity` and `active`. No new audit table or area.
- **Rationale**: `AuditActorRole` already has `system`, and `AuditService.actorName` names it "MotorFix"; `recordChanges` writes one `update` entry per changed field and nothing when nothing changed, which is exactly FR-004's "no audit entry". `audit-coverage.spec.ts` requires a service method that writes through Prisma to call `this.audit`, so the loader and `GarageBrandsService` inject `AUDIT_PORT` and call it in the writing method.
- **Alternatives considered**: a `brand_change` table — a second history (Constitution I, IV).
- **Evidence**: `libs/domain/prisma/schema/audit.prisma` (`system` in `AuditActorRole`), `libs/domain/src/audit/audit.port.ts:30-41`, `libs/domain/src/audit/audit.service.ts:36-78,100-110`, `libs/domain/src/audit/audit-coverage.spec.ts:1-60`.

## 4. Redis client and the cache

- **Decision**: reuse the `AUTH_REDIS` ioredis client that `AuthModule` exports; one key `brands:active` holding the JSON of the active list in search order, `SETEX 3600`; the loader `DEL`s it after a committing run that changed something; a Redis error is logged and the list is read from PostgreSQL.
- **Rationale**: `AUTH_REDIS` is already shared by the e-mail confirmation limit (the comment in `attempts.ts` says so), so a second connection would be the bloat. One key for the whole list keeps filtering and paging in process (a few hundred brands) and makes invalidation one `DEL` (FR-009). Constitution VI: PostgreSQL is the truth; the key is a copy.
- **Alternatives considered**: a key per query (`brands:q:<q>:<cursor>`) — many keys to drop; in-process memory — not shared between replicas and not dropped by a loader on another replica.
- **Evidence**: `libs/domain/src/auth/auth.module.ts:56-63,83`, `libs/domain/src/auth/attempts.ts:7-8`, `libs/domain/src/events/events.module.ts:26-39` (the "Redis down is logged, not thrown" pattern), spec FR-009/FR-012.

## 5. Accent- and case-insensitive matching

- **Decision**: fold in process: `s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`, applied to the typed text and to each cached name; a name matches when its folded form contains the folded query. The same fold, then `[^a-z0-9]+` → `-` and trim, makes the slug.
- **Rationale**: the list is already in memory from the cache, so the database's `unaccent` extension (available in the PostGIS images but not enabled by any migration) is not needed and a migration to enable it would be one more moving part. The three brief searches ("sko", "Skoda", "ŠKODA") fold to `sko`, `skoda`, `skoda` and match `skoda`.
- **Alternatives considered**: `CREATE EXTENSION unaccent` + `ILIKE` per query — a database round trip per search and bypasses the cache; `citext` — handles case only.
- **Evidence**: spec FR-010 and Assumptions ("whichever the implementation chooses, as long as the three Škoda searches pass"); no `CREATE EXTENSION` in `libs/domain/prisma/migrations/*/migration.sql`.

## 6. Paging and the cursor

- **Decision**: `{ items, nextCursor, total }`, 20 a page, `nextCursor` = the id of the page's last item (null on the last page); a `cursor` that is not an id in the filtered list → 400 `invalid_cursor`. `total` is the number of matches.
- **Rationale**: the shape and the cursor rule are the ones `AuditHistoryService.list` already uses (`PAGE = 20`, cursor is the last row's id, `invalid_cursor` when the cursor row does not match the filters), so the generated client and the screens meet one convention (A30).
- **Alternatives considered**: an offset cursor (`base64(offset)`) — a second convention.
- **Evidence**: `libs/domain/src/audit/audit-history.service.ts:93-125`, `libs/contracts/src/audit-history.dto.ts:153-167`, `context.md` Constraints (A30).

## 7. Database rules: CHECK constraint or domain function

- **Decision**: CHECK where one line states the rule, a domain method where the rule crosses tables:
  - fuel ticks on a `does_not_take` row: `CHECK (stance = 'works_on' OR NOT (petrol OR diesel OR hybrid OR electric))` on `garage_brand`; the four ticks are `BOOLEAN NOT NULL DEFAULT true`, so a new `works_on` row has all four ticked by the default (FR-014) and a tick on a `does_not_take` row is refused by PostgreSQL;
  - brand note and refusal phrase: `CHECK (brand_note IS NULL OR (char_length(brand_note) <= 140 AND btrim(brand_note) <> ''))`, the same with 60 for `refusal_phrase` (FR-016);
  - a job only for a `works_on` brand, and clearing ticks and deleting jobs when a stance turns to `does_not_take`: `GarageBrandsService.addJob` and `setStance` (FR-014, FR-015), with the FK `garage_brand_job (garage_id, brand_id) → garage_brand ON DELETE CASCADE` so a job can never outlive its brand row.
- **Rationale**: the repository already puts a one-line rule in a CHECK (`reminder_subject_check`) and append-only history in triggers; a cross-table rule in a trigger would be ~15 lines of PL/pgSQL that Prisma cannot model and the services could not name an error code for, while a service method is the single use case Constitution V wants and the later writers call.
- **Alternatives considered**: triggers for the job rule — invisible to the Prisma schema and to error codes; a `ticked` column on `garage_brand_job` — the row's presence is the tick (spec Clarifications).
- **Evidence**: `libs/domain/prisma/migrations/20261005160000_reminders/migration.sql:37-39`, `libs/domain/prisma/migrations/20261004120000_audit_history` (triggers), spec FR-013..FR-016 and the Clarifications of 2026-10-07.

## 8. Module wiring and the public route

- **Decision**: `CatalogueModule.register(auth)` imports the application's `AuthModule` (for `PRISMA` and `AUTH_REDIS`), provides `BrandLoader`, `BrandsService`, `{ provide: AUDIT_PORT, useClass: AuditService }`, controller `BrandsController`; exports `BrandLoader`. `GaragesModule` gains `GarageBrandsService`. `BrandsController` is `@Controller('brands')` with `@Public()` on `GET`; the route string `GET /api/v1/brands` joins `PUBLIC` in `apps/api/src/public-routes.integration.spec.ts`.
- **Rationale**: the same shape as `GaragesModule.register(email, notifications)` and `EventsModule`; `ActorGuard` is the app-wide `APP_GUARD`, so a route is open only with `@Public()` and the public-routes spec fails when the list and the document disagree (SC-005).
- **Evidence**: `libs/domain/src/garages/garages.module.ts`, `libs/domain/src/auth/actor.guard.ts:36`, `apps/api/src/public-routes.integration.spec.ts:25-50,115-125`, `apps/api/src/app.module.ts`.

## 9. The contract and the generated client

- **Decision**: DTOs in `libs/contracts/src/brands.dto.ts` with `@nestjs/swagger` and `class-validator` decorators, exported from `index.ts`; after the controller exists, `npx nx run data-access:generate` rewrites `apps/api/openapi.json` and `libs/data-access/src/lib`, both committed.
- **Rationale**: `scripts/contract-check.sh` fails CI when the document or the client is stale; `ng-openapi-gen` reads `apps/api/openapi.json`, which `nx run api:openapi` writes from the booted app.
- **Evidence**: `libs/data-access/project.json:9-17`, `apps/api/project.json:8-9`, `scripts/contract-check.sh`, `libs/contracts/src/audit-history.dto.ts` (decorator style).

## Migration timestamp

Newest migration today: `20261006120000_staff_invite`; this feature's is `20261007090000_brand_catalogue` (`ls libs/domain/prisma/migrations`).

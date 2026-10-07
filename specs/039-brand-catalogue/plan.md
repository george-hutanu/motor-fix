# Implementation Plan: Brand catalogue and its upkeep

**Branch**: `039-brand-catalogue` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/039-brand-catalogue/spec.md` (17 FRs, clarified 2026-10-07), `context.md` (Notion: ST-39, MF-9, EP-2, Architecture decisions), `design.md` (no screens: a backend and data task).

## Summary

One brand list for the product, kept by MotorFix in a versioned TypeScript data file (`libs/domain/src/catalogue/brands.ts`) and loaded by an idempotent loader that runs when the API boots (one awaited call in `apps/api/src/main.ts`, before `listen`); every change the loader makes goes to the existing `activity_log` as actor `system` and drops the one Redis key that caches the active list. A public `GET /api/v1/brands?q=&cursor=` searches the cached active list with accents and case folded, 20 a page, `{ items, nextCursor, total }`. In the garages module, two tables (`garage_brand` with stance and four fuel ticks, `garage_brand_job`) and two `garage` columns (`brand_note`, `refusal_phrase`) carry their rules as PostgreSQL CHECK constraints where one line states the rule, and as one domain service (`GarageBrandsService`: `stanceFor`, `setStance`, `addJob`) where the rule crosses tables. Three new Prisma models, one migration, one new NestJS module (`CatalogueModule`), one new service in the existing `GaragesModule`, three DTOs in `libs/contracts`, no screen, no event, no new dependency.

## Technical Context

Every value below is read from the repository, not from memory.

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Node `>=24.0.0` (`package.json` engines; `Dockerfile` `NODE_VERSION=24`). The domain lib and the api compile with `module: commonjs` (`libs/domain/tsconfig.json:5`, `apps/api/tsconfig.json`), so relative imports carry no `.js` extension; only `apps/web-e2e` is `nodenext` and is not touched here. `tsconfig.base.json` has `strict: true`, `resolveJsonModule: true`, paths `@motor-fix/contracts` and `@motor-fix/domain`.

**Primary Dependencies**: NestJS `@nestjs/common`/`core` 12.1.2, `@nestjs/swagger` 12.0.2, `class-validator` 0.15.1, `class-transformer` 0.5.1 (`package.json` dependencies); Prisma `@prisma/client` 7.10.0 with `@prisma/adapter-pg` 7.10.0, generator `prisma-client` output `libs/domain/src/generated/prisma` (`libs/domain/prisma/schema/schema.prisma:1-3`), config `libs/domain/prisma.config.ts` (schema folder `prisma/schema`, migrations `prisma/migrations`, seed `node src/seed.ts`); `ioredis` 6.0.0 (the `AUTH_REDIS` client `AuthModule` exports, `libs/domain/src/auth/auth.module.ts:60,83`). Nx 23.2.1, Biome 2.5.15. No new dependency.

**Storage**: PostgreSQL 17 with PostGIS (`docker-compose.yml:6` `imresamu/postgis:17-3.5`, `.github/workflows/ci.yml:109` `postgis/postgis:17-3.5`) is the truth for brands, garage brands, jobs and the garage texts; Redis 7 (`docker-compose.yml:14`, `ci.yml:116`) holds one cache key, `brands:active`, TTL 3600 s, never the only copy (Constitution VI).

**Testing**: Jest 30.5.2 with ts-jest 29.4.14 from the root preset (`jest.preset.cjs`: `*.integration.spec.ts` need PostgreSQL and Redis, `JEST_SUITE=unit|integration`), supertest 7.3.1 for API specs, `@nestjs/testing` 12.1.2. Domain specs take the database turn with `serialDatabase` (`libs/domain/src/auth/serial-db.testing.ts`) and reset with `fixtures().reset` (`TRUNCATE account, garage CASCADE`, `libs/domain/src/notifications/notifications.testing.ts:79`). No Playwright test: no screen (Build brief "Tests"; design.md).

**Target Platform**: the `api` Nest app on Railway (image from root `Dockerfile`, `scripts/railway-deploy.ts:294` runs `npx prisma migrate deploy` as the api's pre-deploy step), Linux containers; local `nx serve api`.

**Project Type**: Nx monorepo libraries `domain` and `contracts`, app `api`, generated client `data-access` (`libs/data-access/project.json`: `ng-openapi-gen` from `apps/api/openapi.json`, which `apps/api/project.json` writes with `node dist/apps/api/main.js openapi apps/api/openapi.json`; `scripts/contract-check.sh` fails CI when either is stale).

**Performance Goals**: brand search answers from the cached list (one Redis `GET`, filtering and paging in process over ~100–200 brands); the loader runs once per API boot and writes only on a change.

**Constraints** (from `context.md` Constraints and the spec): build first in EP-2, ST-89 waits on it; the shipped development list holds at least the twelve mock brands, ST-245 loads the full list through the same loader (twice-run idempotent); `garage_brand_job.job_type_id` is a plain UUID column with no foreign key until ST-354 creates `job_type`; lists are `{ items, nextCursor, total }`, 20 a page (A30, Proposed); REST with the generated client (A4), Prisma schema per module (A6), errors as RFC 9457 with a lower-snake `code` (A28/A42, Proposed; the existing `ProblemFilter` does this), audit history of every change (A27). Brand note ≤ 140 characters, refusal phrase ≤ 60.

**Scale/Scope**: one data file (12 brands now, every brand sold in Romania later: a few hundred rows at most), 3 Prisma models + 2 columns, 1 migration, 1 module, 2 services, 1 controller, 3 DTOs, 1 public route; the garage-side writers (ST-397, ST-412, the listing form) come later and call the two write functions.

## Constitution Check

*GATE: evaluated before Phase 0; re-evaluated after Phase 1 below.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: no new dependency; the file is a typed `.ts` constant (no JSON loader, no Jest `moduleFileExtensions` change); the loader runs from one line in `main.ts` rather than a new CLI command, a deploy-script change and a seed change; rules that fit one SQL line are CHECK constraints, the two cross-table rules are two small service methods; the cache is one key; no repository layer, no event, no admin route. Nothing in Complexity Tracking.
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing specs first, colocated: `brands.spec.ts` (fold, slug, file validation, the shipped file's twelve brands), `brand-loader.integration.spec.ts`, `brands.api.integration.spec.ts` (public route, search, cache on real Redis), `garage-brands.service.integration.spec.ts`, and `apps/api/src/public-routes.integration.spec.ts` gains `GET /api/v1/brands`. No FR or task id in source.
- [x] **III. The Given Stack**: NestJS, PostgreSQL, Redis, TypeScript; no front end in this task.
- [x] **IV. One Repository, One Toolchain**: new code in `libs/domain`, `libs/contracts`, `apps/api`; Biome from the root; root Jest preset.
- [x] **V. Rules Live in One Place**: the route's shapes are DTOs in `libs/contracts` validated by the global `ValidationPipe`, documented in `apps/api/openapi.json` and regenerated into `libs/data-access`; the brand rules are in the schema (CHECKs) and in `GarageBrandsService`, which every later writer calls; the loader is the only writer of `brand`.
- [x] **VI. PostgreSQL Is the Truth**: Redis holds a copy of the active list that is rebuilt from PostgreSQL on a miss; the loader's writes and their audit entries are one transaction (`AuditPort.record(tx, …)`); no outbox event (the brief names none; nothing subscribes).
- [x] **Notion choices**: A30 (`{ items, nextCursor, total }`, 20 a page) and A28/A42 (problem codes) are Proposed and cited in `context.md` Constraints; no T1–T10 item is touched. The `does_not_take` clearing rule follows the ST-39 brief over MF-9's proposed "kept hidden" (spec Clarifications).

## Project Structure

### Documentation (this feature)

```text
specs/039-brand-catalogue/
├── plan.md              # this file
├── research.md          # Phase 0: decisions with evidence
├── data-model.md        # Phase 1: Brand, GarageBrand, GarageBrandJob, Garage columns, audit entries
├── quickstart.md        # Phase 1: how to prove it works
├── contracts/
│   └── brands.md        # Phase 1: GET /api/v1/brands
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

Existing paths confirmed by listing; `(new)` marks what this feature adds.

```text
libs/domain/prisma/schema/
├── catalogue.prisma                         (new)  model Brand
├── garages.prisma                                  + Garage.brandNote, Garage.refusalPhrase, GarageBrand, GarageBrandJob, enum GarageBrandStance
└── schema.prisma                                   unchanged (generator, datasource)
libs/domain/prisma/migrations/
└── 20261007090000_brand_catalogue/migration.sql (new)  tables, enum, columns, CHECKs, indexes (newest today: 20261006120000_staff_invite)
libs/domain/src/catalogue/                        (new)
├── brands.ts                                        the versioned data file: BrandRecord[] (key, name, popularity)
├── brands.spec.ts                                   fold, slug, validateFile, the shipped file
├── brand-loader.ts                                  BrandLoader.load(records): one transaction, audit, cache drop
├── brand-loader.integration.spec.ts
├── brands.service.ts                                active list (Redis then PostgreSQL), search, paging
├── brands.controller.ts                             GET /brands, @Public()
├── brands.api.integration.spec.ts
└── catalogue.module.ts                              CatalogueModule.register(auth)
libs/domain/src/garages/
├── garages.module.ts                                + GarageBrandsService provider
├── garage-brands.service.ts                  (new)  stanceFor, setStance, addJob
└── garage-brands.service.integration.spec.ts (new)
libs/domain/src/index.ts                             + CatalogueModule, BrandLoader, BRANDS, GarageBrandsService
libs/contracts/src/
├── brands.dto.ts                             (new)  BrandsQueryDto, BrandDto, BrandPageDto
├── brands.dto.spec.ts                        (new)
└── index.ts                                         + export * from './brands.dto'
apps/api/src/
├── app.module.ts                                    + CatalogueModule.register(auth)
├── main.ts                                          + await app.get(BrandLoader).load(BRANDS) before listen
├── main.spec.ts                                     + the load call
└── public-routes.integration.spec.ts                + 'GET /api/v1/brands'
apps/api/openapi.json                                regenerated (nx run data-access:generate)
libs/data-access/src/lib/                            regenerated client
```

**Structure Decision**: the catalogue is its own domain module, as A6 wants a schema file per module and the brief names the `catalogue` module; the garage-side tables stay in `garages.prisma` and the existing `GaragesModule`, because they are the garage's statements and the module already provides `AUDIT_PORT`. The loader's single caller is the api's `main.ts`; the worker never needs brands.

## Design decisions (summary; evidence in research.md)

1. **Data file**: `libs/domain/src/catalogue/brands.ts` exports `BRANDS: readonly BrandRecord[]` with `{ key, name, popularity? }`. The slug is derived from the name by folding accents and case (`Škoda` → `skoda`, `Mercedes-Benz` → `mercedes-benz`), so the file carries no slug column. Twelve rows, popularity 1–12 in the mock's order.
2. **Loader**: `BrandLoader.load(records)` runs one `$transaction` under `pg_advisory_xact_lock(hashtext('brand_loader'))` (two API replicas booting together take turns), validates the file (duplicate key, name or slug → `BrandFileError` naming both brands, before any write), reads the stored brands, refuses a name or slug held by a stored brand with another key, then per record creates (audit `create`), updates changed `name`/`slug`/`popularity`/`active` (audit `update` per field through `recordChanges`), and sets `active=false` on stored brands absent from the file. Any thrown error rolls the whole run back. After the commit, if anything changed, `DEL brands:active` (a Redis error is logged, never thrown). Subject type `brand`, actor `{ actorId: null, actorRole: 'system' }` (`AuditService.actorName` names it "MotorFix").
3. **Where it runs**: `apps/api/src/main.ts`, after `configureApp` and only on the listening path (not for the `openapi` command, which CI runs before the compose stack exists): `await app.get(BrandLoader).load(BRANDS)`. A deploy therefore loads on the API's first boot after `prisma migrate deploy`; `nx serve api` and the e2e job's API do the same; the seed stays as it is. The staging reset (`scripts/reset-staging.sh`) empties the table; the brands return at the next deploy or restart, which the reset workflow is followed by.
4. **Search**: `BrandsService.active()` reads `brands:active` from `AUTH_REDIS`; on a miss it reads `brand where active` ordered by `popularity asc nulls last, name asc` and `SETEX` 3600. `search(q, cursor)` folds `q` and each name (`normalize('NFD')`, strip `\p{M}`, lower case), keeps names that contain the folded `q`, pages 20 after the item whose id is `cursor` (`invalid_cursor` 400 when it is not in the filtered list, as the audit history does), `total` = matches. Empty `q` returns the whole order. Redis down: the list comes from PostgreSQL each time, logged once.
5. **Route**: `GET /api/v1/brands` in `BrandsController`, `@Public()`, `@Query() BrandsQueryDto` (`q?` ≤ 60 chars, `cursor?` UUID), returns `BrandPageDto`; joins `PUBLIC` in `public-routes.integration.spec.ts`.
6. **Garage brands**: `garage_brand (garage_id, brand_id) PK`, `stance garage_brand_stance`, four `BOOLEAN NOT NULL DEFAULT true` ticks, `CHECK (stance = 'works_on' OR NOT (petrol OR diesel OR hybrid OR electric))` so a `does_not_take` row carries no tick and a tick on it is refused by the database; FK to `garage` and `brand` (`ON DELETE CASCADE` from garage; brand rows are never deleted). `garage_brand_job (garage_id, brand_id, job_type_id) PK`, FK `(garage_id, brand_id)` → `garage_brand ON DELETE CASCADE`, `job_type_id UUID` with no FK yet. `garage.brand_note TEXT CHECK (char_length ≤ 140 AND btrim <> '')`, `garage.refusal_phrase TEXT CHECK (char_length ≤ 60 AND btrim <> '')`: nothing blank is ever stored; the later writer trims to `NULL` (data-model.md names the rule).
7. **Service rules**: `GarageBrandsService.stanceFor(garageId, brandId)` → `'works_on' | 'does_not_take' | 'unstated'`. `setStance(tx, actor, garageId, brandId, stance)` upserts the row; for `does_not_take` it sets the four ticks false and `deleteMany` the brand's job rows in the same transaction; audited. `addJob(tx, actor, garageId, brandId, jobTypeId)` reads the row and refuses with `brand_not_worked_on` (409) unless it is `works_on`, then creates; audited. Both are the single use case later writers (ST-397, ST-412, the listing form) call.

## Phase 0 and Phase 1 outputs

- `research.md`: 9 decisions with `Evidence:` lines; no `NEEDS CLARIFICATION` left.
- `data-model.md`: the three models, the two columns, the constraints, the audit entries, the cache key.
- `contracts/brands.md`: the one route, its DTOs, codes and examples.
- `quickstart.md`: migrate, boot, call the route as a visitor, run the specs.

## Constitution Check (after Phase 1)

Re-evaluated against the design above: no violation. The only things that could look like extra are (a) the two write functions nothing in this task calls from a route, which FR-014 and FR-015 need as the one place their rules live and the integration tests exercise, and (b) the advisory lock, one SQL line that makes two replicas' boot loads safe. Both stay.

## Complexity Tracking

No violations to justify.

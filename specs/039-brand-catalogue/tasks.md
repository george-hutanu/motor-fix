---
description: "Task list for the brand catalogue and its upkeep (ST-39)"
---

# Tasks: Brand catalogue and its upkeep

**Input**: `specs/039-brand-catalogue/` (spec.md, plan.md, research.md, data-model.md, contracts/brands.md, quickstart.md, context.md, design.md)

**Tests**: Required (Constitution II, red-first). Every story's test tasks come before its implementation tasks and must fail first. `/speckit-tests` writes them; no FR or task id goes in source.

**Format**: `[ID] [P?] [Story] Description with path`. `[P]` = different files, no dependency on an unfinished task. `(new)` = file this feature adds; every other path was confirmed in plan.md's listing.

**No screen** (design.md): no Playwright task. Paths are relative to the repo root.

## Phase 1: Setup

None. No new dependency, project or tool; `libs/domain`, `libs/contracts` and `apps/api` exist.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the Prisma schema and migration all three stories read and write.

- [X] T001 [P] Add `model Brand` in `libs/domain/prisma/schema/catalogue.prisma` (new): `id` UUID PK `@default(uuid())`, `key` unique, `name` unique, `slug` unique, `popularity` Int?, `active` Boolean default true, `createdAt`, `updatedAt`; index `(active, popularity, name)`; relation `garageBrands GarageBrand[]` (FR-002)
- [X] T002 [P] In `libs/domain/prisma/schema/garages.prisma` add `enum GarageBrandStance { works_on does_not_take }`, `model GarageBrand` (PK `(garageId, brandId)`, `stance`, `petrol`/`diesel`/`hybrid`/`electric` Boolean default true), `model GarageBrandJob` (PK `(garageId, brandId, jobTypeId)`, FK `(garageId, brandId)` → `GarageBrand` cascade, `jobTypeId` UUID with no relation), and `Garage.brandNote String?`, `Garage.refusalPhrase String?` (FR-013, FR-014, FR-015, FR-016)
- [X] T003 Write `libs/domain/prisma/migrations/20261007090000_brand_catalogue/migration.sql` (new): the three tables, the enum, the two `garage` columns, `garage_brand_fuel_check` (`"stance" = 'works_on' OR NOT ("petrol" OR "diesel" OR "hybrid" OR "electric")`), `brand_note` CHECK (`char_length <= 140 AND btrim <> ''`) and `refusal_phrase` CHECK (`char_length <= 60 AND btrim <> ''`) (FR-013, FR-014, FR-015, FR-016; depends on T001, T002)
- [X] T004 Apply the migration to the worktree database and regenerate the Prisma client into `libs/domain/src/generated/prisma` (`npx prisma migrate deploy`, `npx prisma generate` in `libs/domain`, through `scripts/heavy.sh`) (depends on T003)

**Checkpoint**: schema in place; stories can start.

---

## Phase 3: User Story 1 - One brand list, kept by MotorFix (P1) MVP

**Goal**: a versioned data file and an idempotent, audited, all-or-nothing loader.

**Independent Test**: load a small file, load it again (no change, no audit), rename, retire, bring back, load a duplicate; check rows and audit history each time.

### Tests (write first, must fail)

- [X] T005 [P] [US1] `libs/domain/src/catalogue/brands.spec.ts` (new): fold and slug (`Škoda` → `skoda`, `Mercedes-Benz` → `mercedes-benz`), `validateFile` refuses a duplicate key, name or slug naming both brands, and the shipped `BRANDS` holds the twelve mock brands once each (FR-002, FR-003, FR-007; SC-001)
- [X] T006 [P] [US1] `libs/domain/src/catalogue/brand-loader.integration.spec.ts` (new): stores every brand once; a second run changes nothing and writes no audit entry; a rename keeps id and the garage's `garage_brand` row; a retired brand stays with its garage rows and inactive, and returns as the same row; a duplicate in the file and a name or slug held by a stored retired brand leave the stored list unchanged; every change is audited with actor `system`; a change drops `brands:active` and a no-change run does not (FR-004, FR-005, FR-006, FR-007, FR-008, FR-009; SC-002)

### Implementation

- [X] T007 [US1] `libs/domain/src/catalogue/brands.ts` (new): `BrandRecord`, `BRANDS` (twelve brands, popularity 1–12 in the mock's order), `fold`, `slugOf`, `validateFile`, `BrandFileError` (FR-002, FR-003, FR-007; depends on T005)
- [X] T008 [US1] `libs/domain/src/catalogue/brand-loader.ts` (new): `BrandLoader.load(records)` in one `$transaction` under `pg_advisory_xact_lock(hashtext('brand_loader'))`: validate, refuse a name or slug held by another stored key, create/update/retire/reactivate by `key`, audit through `AuditPort` as `{ actorId: null, actorRole: 'system' }`, then `DEL brands:active` after commit when anything changed (Redis error logged, not thrown) (FR-004, FR-005, FR-006, FR-007, FR-008, FR-009; depends on T004, T006, T007)
- [X] T009 [US1] Create `libs/domain/src/catalogue/catalogue.module.ts` (new, a plain `@Module` `CatalogueModule` providing `BrandLoader`), export `CatalogueModule`, `BrandLoader`, `BRANDS` from `libs/domain/src/index.ts`, import the module in `apps/api/src/app.module.ts` (FR-001; depends on T008)
- [X] T010 [US1] Extend `apps/api/src/main.spec.ts` to expect `await app.get(BrandLoader).load(BRANDS)` before `listen` and not on the `openapi` command, then add the call in `apps/api/src/main.ts` (FR-003; depends on T009)

**Checkpoint**: the brand list loads at boot and is testable alone.

---

## Phase 4: User Story 2 - Find a brand by typing part of its name (P2)

**Goal**: public, cached, accent- and case-insensitive brand search, 20 a page.

**Independent Test**: load the development list, search `sko`, `Skoda`, `ŠKODA` and empty as a visitor.

### Tests (write first, must fail)

- [X] T011 [P] [US2] `libs/contracts/src/brands.dto.spec.ts` (new): `BrandsQueryDto` accepts no `q`, `q` of 60 characters and a UUID `cursor`; refuses `q` of 61, a non-UUID `cursor` and an unknown parameter (FR-012)
- [X] T012 [P] [US2] `libs/domain/src/catalogue/brands.api.integration.spec.ts` (new, supertest, real Redis): visitor gets `sko`/`Skoda`/`ŠKODA` → Škoda; empty search by popularity then name, unranked last; 20 a page with `nextCursor` and `total`; `q=zzz` → empty page; `invalid_cursor` 400; a retired brand is not returned; second identical call is served from `brands:active` and a loader change shows in the next call (FR-010, FR-011, FR-012, FR-009; SC-003)
- [X] T013 [P] [US2] Add `'GET /api/v1/brands'` to the `PUBLIC` list in `apps/api/src/public-routes.integration.spec.ts` (FR-012; SC-005)

### Implementation

- [X] T014 [P] [US2] `libs/contracts/src/brands.dto.ts` (new): `BrandsQueryDto`, `BrandDto`, `BrandPageDto` per `contracts/brands.md`, and `export * from './brands.dto'` in `libs/contracts/src/index.ts` (FR-012; depends on T011)
- [X] T015 [US2] `libs/domain/src/catalogue/brands.service.ts` (new): `active()` reads `brands:active` from `AUTH_REDIS`, on a miss reads PostgreSQL `popularity asc nulls last, name asc` and `SETEX` 3600; `search(q, cursor)` folds, filters, pages 20, `invalid_cursor` 400, Redis failure falls back to PostgreSQL (FR-010, FR-011, FR-012; depends on T007, T012, T014)
- [X] T016 [US2] `libs/domain/src/catalogue/brands.controller.ts` (new): `GET /brands`, `@Public()`, tag `brands`; register controller and `BrandsService` in `CatalogueModule` (FR-012; depends on T015, T009)
- [X] T017 [US2] Regenerate `apps/api/openapi.json` and the client in `libs/data-access/src/lib` (`npx nx run api:openapi`, `npx nx run data-access:generate`) (depends on T016)

**Checkpoint**: visitors can search brands.

---

## Phase 5: User Story 3 - A garage's answer for a brand (P3)

**Goal**: stance, fuel ticks, jobs, limits and the read function with their rules.

**Independent Test**: works-on, does-not-take and no row give three answers; a tick or job on the does-not-take brand is refused.

### Tests (write first, must fail)

- [X] T018 [US3] `libs/domain/src/garages/garage-brands.service.integration.spec.ts` (new): `stanceFor` answers `works_on`, `does_not_take`, `unstated`; a new `works_on` row has four ticks true; a tick on a `does_not_take` row is refused by the database; `addJob` stores a job for `works_on` and refuses `brand_not_worked_on` (409) otherwise; `works_on` → `does_not_take` clears ticks and deletes the brand's jobs; same stance writes nothing; `brandNote` 140 and `refusalPhrase` 60 characters kept, 141 and 61 and blank refused; writes are audited (FR-013, FR-014, FR-015, FR-016, FR-017; SC-004)

### Implementation

- [X] T019 [US3] `libs/domain/src/garages/garage-brands.service.ts` (new): `stanceFor`, `setStance(tx, actor, garageId, brandId, stance)` with the transitions in data-model.md, `addJob(tx, actor, garageId, brandId, jobTypeId)` throwing `ConflictException({ code: 'brand_not_worked_on' })`, both audited (`garage_brand`, `garage_brand_job`); provide it in `libs/domain/src/garages/garages.module.ts`; it stays off the lib's public index until its first caller outside `garages/` (ST-397) exports it, since an export with no consumer is bloat (Principle I; spec review 2026-10-07) (FR-013, FR-014, FR-015, FR-016, FR-017; depends on T004, T018)

**Checkpoint**: all three stories work independently.

---

## Phase 6: Polish

- [X] T020 Run the checks in `specs/039-brand-catalogue/quickstart.md` and `scripts/contract-check.sh` so `apps/api/openapi.json` and `libs/data-access` are current (SC-001..SC-005; depends on T010, T017, T019)
- [X] T021 `libs/domain/src/catalogue/brand-loader.integration.spec.ts` and `brand-loader.ts`: a file swapping two brands' names is refused and the error tells the operator to rename one brand to a temporary name first, then load again (FR-007; decided by Chief, deferred.md)
- [X] T022 Review fixes: the brand cache refuses JSON that is not a list (falls back to PostgreSQL); the API stops with exit code 1, never serving, when the brand file cannot load (`apps/api/src/main.ts`); the retired-cursor and cross-garage tests assert the exact outcome (FR-008, FR-012; code and spec review 2026-10-07)

---

## Dependencies and order

- Foundational T001–T004 first; T001 and T002 in parallel.
- US1 → US2 (the service reads `brands.ts` and the module); US3 depends only on Foundational and runs in parallel with US1/US2 (different files, except `libs/domain/src/index.ts`, edited by T009 and T019 in turn).
- Inside a story: its tests, red, then implementation.

## Parallel examples

- After T004: T005, T006 (US1 tests), T011, T012, T013 (US2 tests) and T018 (US3 test) are all different files.
- T014 (DTOs) runs beside T007/T008.

## Strategy

MVP is US1 (the list and its loader). Then US2 (what consumers read), then US3 (storage for ST-397/ST-412). One PR, a commit per slice.

# Implementation Plan: Brand-first garage list

**Branch**: `043-brand-first-garage-list` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/043-brand-first-garage-list/spec.md`; `context.md` (Notion, 2026-10-07); `design.md` (no screen in this story; mock unavailable, logged).

## Summary

One public read, `GET /api/v1/search/garages?brandId=<uuid>[&cursor=…]`, answers with every approved garage for one brand in two groups (`works_on` first, then `does_not_take` and `unstated` together), 20 a page behind an opaque keyset cursor that carries the group, plus two counts over everything found. It is a new `search` module in the domain library (the brief's name; ST-328 and MF-10 extend the same route), three small files and a DTO file, reading the `garage` and `garage_brand` tables ST-39 and ST-207 created through the one public scope `publicGarages()`. No schema change, no write, no event, no cache.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Node 26.5.0 on this machine (`node -v`); `tsconfig.base.json` targets `es2023`, `module: esnext`, `moduleResolution: bundler`, `strict`. `libs/domain/tsconfig.json` compiles to `commonjs`; imports inside `libs/domain`, `libs/contracts` and `apps/api` carry no `.js` extension (only `apps/web-e2e` is `nodenext`).

**Primary Dependencies**: NestJS 12.1.2 (`@nestjs/common`, `@nestjs/core`), `@nestjs/swagger` 12.0.2 (OpenAPI decorators), `class-validator` 0.15.1 (DTOs at the edge), Prisma 7.10.0 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`; client generated to `libs/domain/src/generated/prisma` by `postinstall`), Nx 23.2.1. No new dependency.

**Storage**: PostgreSQL through Prisma: tables `garage` (`libs/domain/prisma/schema/garages.prisma`: `id`, `name`, `slug`, `status`) and `garage_brand` (same file: PK `(garage_id, brand_id)`, `stance` enum `works_on | does_not_take`, `@@index([brandId])`), `brand` (`catalogue.prisma`). No migration: FR-008 adds no column, and the existing indexes serve the query (research R4). Redis is not touched (no cache: research R6).

**Testing**: Jest 30.5.2 from the root config (`jest.preset.cjs`, `libs/domain/jest.config.cjs` with `ts-jest`); integration specs named `*.integration.spec.ts` on real PostgreSQL, booted like `libs/domain/src/catalogue/brands.api.integration.spec.ts` (AuthModule + the module under test, the API's `ValidationPipe` options, `serialDatabase`, `fixtures()`); the worktree's own services: `eval "$(node scripts/test-services.ts 2a8f9b75~30)"` prints `DATABASE_URL`/`REDIS_URL` (the shared default database refuses with "too many clients"). Static spec `libs/domain/src/garages/public-garages.scope.spec.ts` already walks every `@Public()` handler and fails on a garage read without `...publicGarages()`. No Playwright test (no screen; spec Assumptions). Stryker floor for `domain`: `break: 0` (`libs/domain/stryker.config.json`), CI nightly only.

**Target Platform**: the `api` NestJS app (Linux container in release, `Dockerfile`), consumed later by the Angular `web` app through the generated client in `libs/data-access` (`ng-openapi-gen` from `apps/api/openapi.json`, `libs/data-access/project.json` target `generate`; CI's Contract check `scripts/contract-check.sh` fails when document or client is stale).

**Project Type**: web-service route in an Nx monorepo (domain lib + contracts lib + api app).

**Performance Goals**: none stated by the brief; one page costs at most four indexed queries (brand lookup, two counts, one or two group reads) — research R3.

**Constraints** (from `context.md` › Constraints, and the spec):
- Reads `GARAGE` and `GARAGE_BRAND` only; the brief's `rating`, `review_count`, `location`, `service_radius_km` do not exist on `Garage` and are not added (spec FR-008, clarify Q1/Q2; open decision for the owner recorded in spec Assumptions).
- Writes nothing: no `SEARCH_LOG` (proposed, possibly MF-10's), no audit, no event (FR-011).
- Paging cursor includes the group so later pages never mix groups (the brief, proposed → adopted: FR-006).
- Depends on ST-39 (`garage_brand`, `GarageBrandsService.stanceFor`) and ST-207 (`publicGarages()` scope): both merged on `main` (`libs/domain/src/garages/`).
- Live updates (`public:search:{brandId}`, A8) are the results screen's; nothing is emitted here (spec Assumptions).
- Cursor pagination `{ items, nextCursor, total }`, 20 a page (Architecture decision A30, Proposed); this plan relies on it as the brand search already does (`libs/domain/src/catalogue/brands.service.ts`, `PAGE = 20`), adding `counts`.
- EP-4 starts 2027-01-18 and needs this story.

**Scale/Scope**: hundreds to low thousands of garages per brand at launch (Romania); one route, two DTO classes plus a query DTO, one service, one controller, one module, one app-module line, one public-routes entry, regenerated `openapi.json` and client.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.2, `.specify/memory/constitution-card.md`):

- [x] **I. No Bloat (NON-NEGOTIABLE)**: three source files in `libs/domain/src/search/` (module, controller, service) and one DTO file; no repository layer, no cache, no index, no rating columns, no new dependency, no sort knob (ST-328's); the cursor is ~15 lines of base64url JSON encode/decode in the service. The stance is read with Prisma's relation filter and a filtered `include`, not a second copy (FR-010).
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing specs first: `garage-search.service.integration.spec.ts` (order, counts, paging, ties, exclusions on real PostgreSQL), `garage-search.api.integration.spec.ts` (400/404/200 shapes through the controller), a `garage-search.dto.spec.ts` in contracts, and the `GET /api/v1/search/garages` line in `apps/api/src/public-routes.integration.spec.ts`. The red-first gate blocks source edits until a spec exists on the branch.
- [x] **III. The Given Stack**: NestJS, Prisma over PostgreSQL, TypeScript; no front-end change.
- [x] **IV. One Repository, One Toolchain**: a module in the existing `domain` lib, registered in `apps/api/src/app.module.ts`; no search engine (PostgreSQL `ORDER BY` and relation filters do the grouping); Biome and root Jest unchanged.
- [x] **V. Rules Live in One Place**: DTOs in `libs/contracts/src/garage-search.dto.ts`, validated at the edge by the API's global `ValidationPipe` (`@IsUUID` on `brandId`); the route documented through `@nestjs/swagger` into `apps/api/openapi.json`, client regenerated (`npx nx run data-access:generate`); the grouping rule lives once, in `GarageSearchService`; the visibility rule stays in `publicGarages()`.
- [x] **VI. PostgreSQL Is the Truth**: a read only; nothing in Redis.
- [x] **Notion choices**: A30 cursor pagination (Proposed) cited above and already in use; the brief's `search` module name adopted (research R1); the brief's proposed `SEARCH_LOG` write is not assumed (FR-011, spec Assumptions). No T1–T10 item is touched.

Post-design re-check (after Phase 1): unchanged; the contract in `contracts/garage-search.openapi.json` adds one path and three schemas, nothing speculative. No Complexity Tracking entry needed.

## Project Structure

### Documentation (this feature)

```text
specs/043-brand-first-garage-list/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R8 with evidence
├── data-model.md        # Phase 1: entities, cursor, query shape
├── quickstart.md        # Phase 1: how to run and prove it
├── contracts/
│   └── garage-search.openapi.json   # the new path and schemas as they will appear in apps/api/openapi.json
├── spec.md, context.md, design.md, auto-run.md, notion-sync.md, checklists/
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
libs/contracts/src/
├── garage-search.dto.ts              (new) GarageSearchQueryDto, ListedGarageDto, BrandCountsDto, GarageSearchPageDto, GARAGE_BRAND_ANSWERS
├── garage-search.dto.spec.ts         (new, /speckit-tests) the query DTO refuses a non-uuid brandId and an extra field
└── index.ts                          (edit) export * from './garage-search.dto'

libs/domain/src/search/               (new directory)
├── search.module.ts                  (new) SearchModule: controller + service; PRISMA from the global AuthModule
├── garage-search.controller.ts       (new) @Public() @Get() on @Controller('search/garages')
├── garage-search.service.ts          (new) forBrand(brandId, cursor?): brand check, counts, grouped keyset page, cursor codec
├── garage-search.service.integration.spec.ts  (new, /speckit-tests)
└── garage-search.api.integration.spec.ts      (new, /speckit-tests)

libs/domain/src/index.ts              (edit) export { SearchModule }
apps/api/src/app.module.ts            (edit) SearchModule in imports
apps/api/src/public-routes.integration.spec.ts  (edit) + 'GET /api/v1/search/garages'
apps/api/openapi.json                 (regenerated) + /api/v1/search/garages, 3 schemas
libs/data-access/src/lib/**           (regenerated) search service + models
.specify/capabilities/garage-search.md (archive merges the Spec Delta; features: [043-brand-first-garage-list])
```

**Structure Decision**: a new `search` module in `libs/domain/src/search/`, as the Build brief names it and spec Assumptions adopt, rather than a method on `PublicGaragesService` in `garages/`. Reasons (research R1): the search is the first of a family the brief and ST-328/MF-10 put in `search` (sort, distance, area), so the module is the smallest unit that will not have to move; it depends only on the global `AuthModule`'s `PRISMA` provider, so its specs boot `AuthModule + SearchModule` like `catalogue/brands.api.integration.spec.ts` does, while `GaragesModule.register` drags e-mail, notifications and verification config into every test; and the PR already carries `scope: search`. The module is three files; nothing else is scaffolded.

## Complexity Tracking

No constitution violation to justify.

## Design decisions (summary; evidence in research.md)

| # | Decision | Where |
| --- | --- | --- |
| R1 | New `SearchModule` in `libs/domain/src/search/`, registered in `AppModule` | research.md |
| R2 | Route `GET /api/v1/search/garages?brandId=<uuid>&cursor=<opaque>`; `brandId` required `@IsUUID()`; `cursor` optional string ≤ 200 chars | contracts/ |
| R3 | Grouping by two Prisma reads, not raw SQL: group A `brands: { some: { brandId, stance: 'works_on' } }`, group B `brands: { none: { brandId, stance: 'works_on' } }`, both `where: { ...publicGarages() }`, `orderBy: [{ name: 'asc' }, { id: 'asc' }]`, keyset `OR [{ name: { gt } }, { name, id: { gt } }]`, `take: 21` (one past the page, so the last page needs no extra read); a page that exhausts group A is filled from the start of group B; `nextCursor` is null when 20 or fewer rows came back | data-model.md |
| R4 | Counts: two `prisma.garage.count` calls with the same two `where`s, per page request; `total = worksOn + doesNotTake`; no schema or index change | data-model.md |
| R5 | Stance per item: `include: { brands: { where: { brandId }, select: { stance: true } } }` → `brands[0]?.stance ?? 'unstated'` (the same rule as `GarageBrandsService.stanceFor`, applied to the batch; FR-010) | data-model.md |
| R6 | Cursor: base64url of `{"b":brandId,"g":"works_on"\|"other","n":lastName,"i":lastId}`, unsigned; any decode failure, other brand, unknown group, or non-uuid `i` → 400 `invalid_cursor` (as `brands.service.ts`) | data-model.md |
| R7 | Brand existence: `prisma.brand.findUnique({ where: { id }, select: { id: true } })` before the reads; missing → 404 `not_found`; `active: false` still answers | research.md |
| R8 | No Redis cache, no event, no SEARCH_LOG; no Playwright; `stanceFor` stays for single reads | research.md |

## Phase 2 preview (for /speckit-tasks, not executed here)

1. Contracts DTOs + spec (red), export from index.
2. Failing domain specs: service integration (order, counts, paging, ties, exclusions, cursor refusals), API integration (400 non-uuid, 400 bad cursor, 404 unknown brand, 200 shape, visitor without session), public-routes entry.
3. `SearchModule`, controller, service → green.
4. Register in `AppModule`; `npx nx run data-access:generate` (rebuilds the API, rewrites `openapi.json` and the client); commit both.
5. Harden, review, archive (Spec Delta → `.specify/capabilities/garage-search.md`).

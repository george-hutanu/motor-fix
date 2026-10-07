# Research: Brand-first garage list (ST-43)

Phase 0 of `/speckit-plan`, 2026-10-07. Every unknown was resolved from this repository; no external fetch was needed and no research agent was dispatched (nothing depended on a dependency's undocumented behaviour: the Prisma relation filters used below are in the generated client under `libs/domain/src/generated/prisma/models/Garage.ts`).

## R1 — Where the search lives

- **Decision**: a new NestJS module `SearchModule` in `libs/domain/src/search/` (`search.module.ts`, `garage-search.controller.ts`, `garage-search.service.ts`), exported from `libs/domain/src/index.ts` and imported in `apps/api/src/app.module.ts` next to `CatalogueModule`.
- **Rationale**: the Build brief scopes the story to "the brand grouping in the `search` module" and ST-328 (sort) and MF-10 (distance, areas) extend the same results; a method on `PublicGaragesService` would move at the next story. `GaragesModule.register(email, notifications, verification)` needs e-mail, notifications and verification config, so a spec booting it pays for all three (`libs/domain/src/garages/public-garages.api.integration.spec.ts:28-45`); `CatalogueModule` boots with `AuthModule` alone (`libs/domain/src/catalogue/brands.api.integration.spec.ts:29-35`) and the search needs only the global `PRISMA` provider (`libs/domain/src/catalogue/catalogue.module.ts:9`, "The client and the Redis connection come from the global AuthModule"). The module is three files, nothing speculative (Principle I).
- **Alternatives considered**: (a) `PublicGaragesService.forBrand()` in `garages/` — fewer files, but the wrong home for ST-328/MF-10 and a heavier test boot; (b) a controller in `catalogue/` under `/brands/{id}/garages` — brands are the catalogue's subject, garages are not, and the route would not take MF-10's area parameters naturally.
- **Evidence**: `libs/domain/src/garages/garages.module.ts:25-55`; `libs/domain/src/catalogue/catalogue.module.ts`; `apps/api/src/app.module.ts:60-65`; `specs/043-brand-first-garage-list/spec.md` › Assumptions ("new `search` module"); PR #198 label `scope: search` (`auto-run.md`, Phase 2 hook outcomes); `libs/domain/src/garages/public-garages.scope.spec.ts:216-236` already uses `search/search.controller.ts` as its example of a public handler it must catch.

## R2 — The route and its parameters

- **Decision**: `GET /api/v1/search/garages?brandId=<uuid>[&cursor=<opaque>]`, `@Public()`, tag `search`, operation `GarageSearchController_forBrand`. `GarageSearchQueryDto`: `brandId` required, `@IsUUID()`; `cursor` optional, `@IsString() @MaxLength(200)`. Answers: 200 `GarageSearchPageDto`; 400 `validation_failed` (the global pipe, non-uuid or extra field) or `invalid_cursor`; 404 `not_found` (no brand row).
- **Rationale**: a query parameter for the brand lets ST-328 add `sort` and MF-10 add area parameters on the same path; the public-routes check lists it as `GET /api/v1/search/garages` (a call without `brandId` answers 400, which `byGuard` does not count as refused, like `GET /api/v1/brands` with no query). The API's global `ValidationPipe` is `{ forbidNonWhitelisted: true, transform: true, whitelist: true }` and answers `validation_failed` (`apps/api/src/validation-problem.integration.spec.ts:38-39`), so no hand-written uuid check is needed; the brand DTO already shows the pattern (`libs/contracts/src/brands.dto.ts:4-21`).
- **Alternatives considered**: `GET /api/v1/brands/{brandId}/garages` (REST-nested; rejected in R1); `POST /search` with a body (a read with a body: no).
- **Evidence**: `libs/domain/src/catalogue/brands.controller.ts`; `libs/domain/src/garages/public-garages.controller.ts:17-24` (`@Public()`, `ApiNotFoundResponse`); `apps/api/src/public-routes.integration.spec.ts:14-40`; `apps/api/src/validation-problem.integration.spec.ts`.

## R3 — Grouping and paging with Prisma, not raw SQL

- **Decision**: two Prisma `findMany` reads over `garage`, both spreading `...publicGarages()`: group A (takers) `brands: { some: { brandId, stance: 'works_on' } }`, group B (the rest) `brands: { none: { brandId, stance: 'works_on' } }`. `orderBy: [{ name: 'asc' }, { id: 'asc' }]`, `take: 20`, keyset continuation `OR: [{ name: { gt: n } }, { name: n, id: { gt: i } }]` when the cursor is in that group. A page reads its cursor's group first; when it returns fewer than 20 and the group is A, the remainder (`take: 20 - items.length`) is read from the start of group B. `nextCursor` is the last item on the page with its group, or `null` when the page is in group B and short, or when group B is empty after a full group A page is checked on the next request (a trailing empty page is acceptable only if unavoidable: see data-model.md for the exact rule).
- **Rationale**: the scope spec `public-garages.scope.spec.ts` recognises only `prisma.garage.<read>` calls carrying `...publicGarages()`; a `$queryRaw` would bypass it and need its own guard. `group B = none works_on` folds `does_not_take` and `unstated` into one filter, exactly FR-001's second group, and PostgreSQL's `ORDER BY name` under the database's default collation is what FR-007 names; Prisma's `gt` on a string column compares under the same collation. The garage id is a uuid, so `id: { gt }` is a total tie-break.
- **Alternatives considered**: one `$queryRaw` with `ORDER BY (stance = 'works_on') DESC, name, id` and a `(group, name, id)` row-value keyset — one round trip fewer, but outside the scope guard and Prisma's typing; Prisma's `cursor:` option — needs a unique field, and `(name, id)` is not a unique index.
- **Evidence**: `libs/domain/src/garages/public-garages.ts:9-10` (the scope); `libs/domain/src/garages/public-garages.scope.spec.ts:90-109` (`SCOPED = /\.\.\.publicGarages\(\)/`); `libs/domain/src/generated/prisma/models/Garage.ts` (`GarageBrandListRelationFilter` with `some`/`none`); `libs/domain/prisma/schema/garages.prisma` (`GarageBrand @@id([garageId, brandId])`, `@@index([brandId])`).

## R4 — The counts and the schema

- **Decision**: `prisma.garage.count({ where: { ...publicGarages(), brands: { some: … } } })` and the `none` twin, run on every page request alongside the reads; `total = worksOn + doesNotTake`. No migration, no new index.
- **Rationale**: FR-005 wants the counts over everything found, on every page; two indexed counts are cheap at launch scale and keep the figures consistent with the reads of the same request (the spec accepts drift between pages). `garage_brand` already has `(garage_id, brand_id)` and `brand_id` indexes, and `garage` is small; an index on `garage(status, name)` would be premature (Principle I). FR-008 forbids new garage columns.
- **Alternatives considered**: counting once and carrying the counts in the cursor (stale on later pages, and the spec says "read once per page request"); a Redis cache per brand (Redis would then need invalidation on every stance change and approval — bloat, and FR-011 forbids writing anything from here).
- **Evidence**: `spec.md` FR-005, FR-008, Assumptions ("counts are read with each page request"); `libs/domain/prisma/schema/garages.prisma`.

## R5 — Each garage's answer for the brand

- **Decision**: `include: { brands: { where: { brandId }, select: { stance: true } } }` on both reads; `stance = garage.brands[0]?.stance ?? 'unstated'`.
- **Rationale**: one row per garage and brand (`@@id([garageId, brandId])`), so the filtered include yields zero or one row; the rule "no row is `unstated`" is `GarageBrandsService.stanceFor`'s, applied here to the batch rather than calling it per garage (20 extra queries). FR-010: the rows are read, never copied.
- **Alternatives considered**: calling `stanceFor` per item (N+1); adding a `stance` column to the DTO only for group B (the screen's lamp needs it anyway and FR-004 wants it on every item).
- **Evidence**: `libs/domain/src/garages/garage-brands.service.ts:31-40`; `.specify/capabilities/garage-brands.md` 039-FR-013, 039-FR-017.

## R6 — The cursor

- **Decision**: `base64url(JSON.stringify({ b: brandId, g: 'works_on' | 'other', i: lastId }))`, unsigned. Decoding refuses with 400 `invalid_cursor` ("cursor is not a page of this search") when the text is not base64url JSON of an object, `b !== brandId`, `g` is not one of the two groups, or `i` is not a uuid or names no public garage. The name of the keyset is read back by id (changed in harden: a name in the cursor overflowed the 200-character cap for long names).
- **Rationale**: the spec (clarify Q4) fixes the shape; a signature would need a key and a rotation story for a public, idempotent read whose worst forgery is a wrong page of public data (the owner can add one later without changing the client, the cursor being opaque). `invalid_cursor` mirrors `BrandsService.search` (`libs/domain/src/catalogue/brands.service.ts:34-40`) so the web interceptor and the screen meet one code. Node's `Buffer.from(text, 'base64url')` is built in; no dependency.
- **Alternatives considered**: the name in the cursor (first choice) — overflows the 200-character cap, garage names being unbounded; a signed token — bloat for now.
- **Evidence**: `spec.md` Clarifications Q4, FR-006, FR-009; `libs/domain/src/catalogue/brands.service.ts:28-41`; `libs/contracts/src/brands.dto.ts:14-21` (the brand cursor is a uuid, so the DTO there uses `@IsUUID`; this one is opaque text, so `@IsString()` with a length cap).

## R7 — Brand existence and retired brands

- **Decision**: `prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } })` first; `null` → `refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found')` (the helper `libs/domain/src/auth/sign-up.service.ts:24-29`, as `PublicGaragesService` uses it). `active: false` is not tested: a retired brand answers.
- **Rationale**: FR-009; the brand's `active` flag hides it from the pickers (`BrandsService.active()` filters `active: true`), not from garages that already hold rows for it.
- **Alternatives considered**: answering an empty page for an unknown brand (hides a client bug); 404 for inactive brands (contradicts FR-009).
- **Evidence**: `libs/domain/src/garages/public-garages.ts:12,32-35`; `libs/domain/src/catalogue/brands.service.ts:63-71`.

## R8 — What is deliberately left out

- **Decision**: no Redis cache, no `SEARCH_LOG`, no outbox event, no live channel, no Playwright test, no rating or review-count column, no `sort` parameter, no change to `GarageBrandsService.stanceFor` (still the single-garage read).
- **Rationale**: FR-008, FR-011 and the spec Assumptions; Principle I. The open decision (rating columns now) stays with the owner, recorded in `spec.md` Assumptions and `auto-run.md`.
- **Evidence**: `spec.md` › Assumptions; `context.md` › Contradictions (SEARCH_LOG, live channel, Playwright).

## Import-extension rule (carried for implementers)

`libs/domain`, `libs/contracts` and `apps/api` import without `.js` (`libs/domain/tsconfig.json`: `module: commonjs`; `libs/domain/src/catalogue/brands.controller.ts:5-6`); only `apps/web-e2e` is `nodenext` with `.js`.

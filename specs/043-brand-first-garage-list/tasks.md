# Tasks: Brand-first garage list

**Input**: `specs/043-brand-first-garage-list/` (spec.md, plan.md, research.md, data-model.md, contracts/garage-search.openapi.json, quickstart.md)

**Tests**: first, always (Constitution II; the red-first gate). Colocated `*.spec.ts`; API and service specs are `*.integration.spec.ts` on real PostgreSQL. No Playwright task: deferred to the results-screen story (spec Clarifications).

**Format**: `- [ ] T### [P?] [US?] Description with path`. `(new)` marks a file that does not exist yet.

## Phase 1: Foundational (blocks every story)

- [X] T001 [P] Write the failing `libs/contracts/src/garage-search.dto.spec.ts` (new): `GarageSearchQueryDto` refuses a missing or non-uuid `brandId`, a `cursor` over 200 characters and an unknown field; accepts a uuid with and without a cursor
- [X] T002 Create `libs/contracts/src/garage-search.dto.ts` (new) per data-model.md: `GarageSearchQueryDto` (`@IsUUID() brandId`, optional `cursor` string, max 200), `ListedGarageDto` (id, name, slug, `stance`; nothing else), `BrandCountsDto` (`worksOn`, `doesNotTake`), `GarageSearchPageDto` (`items`, `nextCursor`, `total`, `counts`), `GARAGE_BRAND_ANSWERS`; add `export * from './garage-search.dto'` to `libs/contracts/src/index.ts`

## Phase 2: User Story 1 - Garages that take my brand come first (P1)

**Goal**: every approved garage for one brand, takers first, then the rest with their answer, open to visitors.
**Independent test**: SC-001, SC-004, SC-005 (stance part), SC-006.

- [ ] T003 [P] [US1] Write the failing `libs/domain/src/search/garage-search.service.integration.spec.ts` (new): six approved garages plus one suspended taker give the six, takers first, the rest with `does_not_take` or `unstated` (FR-001, FR-002, FR-004, FR-010, SC-001); no taker of the brand gives all in the second group (SC-005); a retired brand still answers (FR-009); an unknown brand uuid is not found (FR-009); items carry only id, name, slug, stance (FR-008); no audit, event or search-log row after any call (FR-011, SC-006)
- [ ] T004 [P] [US1] Write the failing `libs/domain/src/search/garage-search.api.integration.spec.ts` (new), booting `AuthModule` + `SearchModule` as `catalogue/brands.api.integration.spec.ts` does: a visitor without a session gets 200 and the page shape (FR-003); missing or non-uuid `brandId`, an unknown query field, answer 400 `validation_failed` (FR-009); unknown brand uuid answers 404 `not_found`
- [ ] T005 [P] [US1] Add `GET /api/v1/search/garages` to the public list in `apps/api/src/public-routes.integration.spec.ts` (FR-003, SC-004)
- [ ] T006 [US1] Create `libs/domain/src/search/garage-search.service.ts` (new): `forBrand(brandId, cursor?)` checks the brand with `prisma.brand.findUnique`, reads group A (`brands.some {brandId, stance 'works_on'}`) then group B (`brands.none …`) with `...publicGarages()`, `orderBy name asc, id asc`, stance from a filtered `include` with `?? 'unstated'` (R3, R5); first page, counts and cursor come in US2 and US3
- [ ] T007 [P] [US1] Create `libs/domain/src/search/garage-search.controller.ts` (new): `@Public() @Get()` on `@Controller('search/garages')`, `@nestjs/swagger` decorators, query DTO from T002
- [ ] T008 [US1] Create `libs/domain/src/search/search.module.ts` (new), export `SearchModule` from `libs/domain/src/index.ts`, add it to `apps/api/src/app.module.ts` imports; T003 to T005 go green for the order, shape and refusals

## Phase 3: User Story 2 - The count line covers everything found (P2)

**Goal**: `counts.worksOn` and `counts.doesNotTake` over the whole result, not the page.
**Independent test**: SC-002 (counts), SC-005 (counts).

- [ ] T009 [US2] Extend `libs/domain/src/search/garage-search.service.integration.spec.ts` (red): counts read 3 and 3 for the six garages, 30 and 18 on every page of 48 garages, 0 and 5 with none taking the brand, 0 and 0 with no approved garage; `total` is their sum (FR-005, FR-006)
- [ ] T010 [US2] In `libs/domain/src/search/garage-search.service.ts` add the two `prisma.garage.count` calls with the group A and group B `where`s and return `counts` and `total` (R4)

## Phase 4: User Story 3 - Pages never mix the groups, and ties are settled (P3)

**Goal**: 20 a page behind an opaque keyset cursor; no repeat, no skip, groups in order.
**Independent test**: SC-002 (paging), SC-003, SC-006 (cursor).

- [ ] T011 [US3] Extend `libs/domain/src/search/garage-search.service.integration.spec.ts` and `garage-search.api.integration.spec.ts` (red): 48 garages read in pages of 20 give the 30 takers at positions 1 to 30, no repeat or skip (FR-001, FR-006, SC-002); Alfa, Beta, Delta by name, equal names by id, no refuser before a taker (FR-007, SC-003); `nextCursor` is null on the last page; an undecodable cursor, another brand's, one naming no group or with a non-uuid id, and one over 200 characters answer 400 `invalid_cursor` or `validation_failed` (FR-009, SC-006)
- [ ] T012 [US3] In `libs/domain/src/search/garage-search.service.ts` add the keyset (`OR [{name gt}, {name, id gt}]`, `take: 21`, a page that exhausts group A filled from group B) and the base64url JSON cursor `{b,g,n,i}` codec with `invalid_cursor` on any mismatch (R3, R6)

## Phase 5: Polish

- [ ] T013 Run `npx nx run data-access:generate` to regenerate `apps/api/openapi.json` and `libs/data-access/src/lib/**` (never by hand); confirm the path matches `contracts/garage-search.openapi.json` and `scripts/contract-check.sh` passes (FR-006, FR-008)

## FR to test map

| FR / SC | Test task |
| --- | --- |
| FR-001, FR-002, FR-004, FR-008, FR-010, FR-011 | T003 |
| FR-003, SC-004 | T004, T005 |
| FR-009, SC-006 | T001, T003, T004, T011 |
| FR-005, SC-005 | T009 |
| FR-006, FR-007, SC-002, SC-003 | T011 |
| SC-001 | T003 |

## Dependencies

T001 → T002 → T006/T007 → T008. T003, T004, T005 are written before T006 (red first). T009 → T010 and T011 → T012, each after T008; T013 last. Parallel: T001 with T003, T004, T005; T007 with T006.

## Strategy

MVP is Phase 1 and 2 (the grouped list); counts and paging follow in priority order, each ending green. 13 tasks, no padding.

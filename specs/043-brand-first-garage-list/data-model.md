# Data model: Brand-first garage list (ST-43)

No table, column, enum or index changes. The story reads what ST-39 and ST-207 wrote (`libs/domain/prisma/schema/garages.prisma`, `catalogue.prisma`) and shapes an answer.

## Stored entities read

| Table (Prisma model) | Columns read | Role here |
| --- | --- | --- |
| `garage` (`Garage`) | `id` uuid, `name`, `slug`, `status` (`draft \| approved \| suspended`) | the listed garage; only `status = approved` through `publicGarages()` |
| `garage_brand` (`GarageBrand`) | `garage_id`, `brand_id`, `stance` (`works_on \| does_not_take`) | the garage's answer; PK `(garage_id, brand_id)`, index `brand_id`; no row = `unstated` |
| `brand` (`Brand`) | `id` | existence check only (404); `active` is not tested |

## Answer entities (DTOs, `libs/contracts/src/garage-search.dto.ts`)

### `GarageSearchQueryDto` (query string)

| Field | Type | Validation | Meaning |
| --- | --- | --- | --- |
| `brandId` | string | required, `@IsUUID()` | the brand, by the catalogue's id |
| `cursor` | string | optional, `@IsString() @MaxLength(200)` | the previous page's `nextCursor`, opaque |

Anything else in the query is refused by the global pipe (`forbidNonWhitelisted`) with 400 `validation_failed`.

### `ListedGarageDto`

| Field | Type | Source |
| --- | --- | --- |
| `id` | uuid | `garage.id` |
| `name` | string | `garage.name` |
| `slug` | string | `garage.slug` |
| `stance` | `'works_on' \| 'does_not_take' \| 'unstated'` (`GARAGE_BRAND_ANSWERS`, exported const tuple; OpenAPI `enum`) | the garage's `garage_brand` row for the brand, or `unstated` when none |

Nothing else (FR-008): no rating, review count, note or phrase.

### `BrandCountsDto`

| Field | Type | Meaning |
| --- | --- | --- |
| `worksOn` | integer ≥ 0 | approved garages with a `works_on` row for the brand |
| `doesNotTake` | integer ≥ 0 | approved garages without one (`does_not_take` rows and no row together) |

### `GarageSearchPageDto`

| Field | Type | Meaning |
| --- | --- | --- |
| `items` | `ListedGarageDto[]` | at most 20; takers first, then the rest; inside a group by `name` (database collation) then `id` |
| `nextCursor` | string \| null | opaque; null on the last page |
| `total` | integer | `counts.worksOn + counts.doesNotTake`: every approved garage, as every garage is in one group |
| `counts` | `BrandCountsDto` | read on each page request, over everything found |

## Groups

| Group | Prisma filter on `garage` (always with `...publicGarages()`) | Cursor `g` |
| --- | --- | --- |
| A, takers | `brands: { some: { brandId, stance: 'works_on' } }` | `works_on` |
| B, the rest | `brands: { none: { brandId, stance: 'works_on' } }` | `other` |

The two filters partition the approved garages, so `total` is their sum and no garage is in both.

## Order and keyset

`orderBy: [{ name: 'asc' }, { id: 'asc' }]` inside a group. Continuation after `(n, i)`:

```
OR: [{ name: { gt: n } }, { name: n, id: { gt: i } }]
```

`name` compares under the database's default collation (FR-007), the same one `ORDER BY` uses, so the keyset and the order agree; `id` (uuid text) is a total tie-break.

## Page assembly (`GarageSearchService.forBrand(brandId, cursor?)`)

1. `brand.findUnique({ where: { id: brandId }, select: { id: true } })`; none → 404 `not_found`.
2. Decode the cursor (below); absent → start of group A.
3. Read the cursor's group with `take: 21` (one more than the page, so the last page needs no extra round trip): group A from the keyset, or group B from the keyset.
4. If the group read is A and returned ≤ 20 rows, append group B from its start with `take: 21 - rows.length`.
5. `items = rows.slice(0, 20)` mapped to `ListedGarageDto` (`stance = brands[0]?.stance ?? 'unstated'`); `nextCursor = rows.length > 20 ? encode(items.at(-1), group of that item) : null`.
6. Two `garage.count` calls with the group filters → `counts`; `total = sum`.

Reads 3–4 and 6 are independent and may run in one `Promise.all`. A page never holds a B garage before an A garage (step 4 appends B after A), and a cursor in group B never reads A again (FR-001, FR-006).

## Cursor

`base64url(JSON.stringify({ b: brandId, g: 'works_on' | 'other', i: lastId }))`, unsigned. The search reads the last garage's name back by its id (scoped to public garages) to build the keyset: a name has no length limit, and the cursor is capped at 200 characters.

Decoding refuses with 400 `invalid_cursor` ("cursor is not a page of this search") when:
- the text is not base64url-decodable JSON, or not an object;
- `b !== brandId` (a cursor from another brand's search);
- `g` is neither `works_on` nor `other`;
- `i` is not a uuid string, or names no garage in the public list (one suspended or deleted since the last page).

A cursor whose garage still exists but changed group, or was renamed, is honoured as a position (the keyset is by value, not by row), which is the accepted drift of the spec's edge case.

## Refusals

| Case | Status | `code` | Where |
| --- | --- | --- | --- |
| `brandId` missing, not a uuid, or an unknown query field | 400 | `validation_failed` | global `ValidationPipe` |
| cursor malformed, foreign brand, unknown group, bad `i` | 400 | `invalid_cursor` | `GarageSearchService` |
| no brand row with that id | 404 | `not_found` | `GarageSearchService` |
| visitor without a session | 200 | — | `@Public()`; listed in `public-routes.integration.spec.ts` |

## State transitions

None: the search writes nothing (FR-011). A garage's group changes only through `GarageBrandsService.setStance` (ST-39) and its visibility through the verification flow (ST-207); the next page request sees the new state.

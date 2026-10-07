# Contract: brand search

One route. The source of truth after implementation is `apps/api/openapi.json` (written by `nx run api:openapi`, consumed by `nx run data-access:generate`); this file says what it must contain. DTOs live in `libs/contracts/src/brands.dto.ts`, decorated with `@nestjs/swagger` and `class-validator` like `audit-history.dto.ts`.

## `GET /api/v1/brands`

Public (`@Public()`; listed in `apps/api/src/public-routes.integration.spec.ts`). Tag `brands`. No request body.

### Query — `BrandsQueryDto`

| Parameter | Type | Validation | Meaning |
| --- | --- | --- | --- |
| `q` | string | optional, `@IsString() @MaxLength(60)` | text typed by the user; matched against brand names ignoring accents and case; empty or absent returns every active brand |
| `cursor` | string (uuid) | optional, `@IsUUID()` | the `nextCursor` of the previous page |

The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) refuses any other parameter with 400 `validation_failed` (the existing `ProblemFilter` shape).

### 200 — `BrandPageDto`

```json
{
  "items": [
    { "id": "9f1c…", "name": "Škoda", "slug": "skoda", "popularity": 6 },
    { "id": "2a7b…", "name": "Dacia", "slug": "dacia", "popularity": 7 }
  ],
  "nextCursor": "2a7b…",
  "total": 23
}
```

- `items`: `BrandDto[]`, at most 20, active brands only, in the order below.
- `nextCursor`: `string | null` (uuid of the page's last item when more follow, else null).
- `total`: number of brands matching `q`.

`BrandDto`: `id` (uuid), `name` (string), `slug` (string), `popularity` (integer, nullable).

Order: when `q` is empty, popularity ascending (1 first), unranked last, then name ascending; when `q` is given, the same order filtered to the matches (the brief's "popularity then name" applies to both).

### 400 — problem

`{ "code": "invalid_cursor", "message": "cursor is not a brand of this search" }` when `cursor` is not the id of a brand among the matches of `q` (a retired brand's id, a brand that no longer matches, a random uuid).

### Caching

The answer comes from the `brands:active` Redis key (TTL 3600 s), rebuilt from PostgreSQL on a miss and dropped by the loader on a list change; the response carries no cache header (the web app's SSR reads it fresh per request).

### Examples the API test checks (spec SC-003)

| Call | Expectation |
| --- | --- |
| `GET /api/v1/brands?q=sko` as a visitor | 200, `items` contains Škoda, no `sign_in_required` |
| `GET /api/v1/brands?q=Skoda` | contains Škoda |
| `GET /api/v1/brands?q=%C5%A0KODA` | contains Škoda |
| `GET /api/v1/brands` | active brands by popularity then name, 20 at most, `total` = active count |
| `GET /api/v1/brands?q=zzz` | 200, `items: []`, `nextCursor: null`, `total: 0` |
| `GET /api/v1/brands?cursor=<not a match>` | 400 `invalid_cursor` |
| `GET /api/v1/brands?q=<61 chars>` | 400 `validation_failed` |
| search a retired brand's name | not in `items` |

## Domain functions (no HTTP surface in this task)

Exported from `@motor-fix/domain` for the stories that write garage brands:

- `GarageBrandsService.stanceFor(garageId, brandId): Promise<'works_on' | 'does_not_take' | 'unstated'>`
- `GarageBrandsService.setStance(tx, actor, garageId, brandId, stance): Promise<void>` — see data-model.md transitions
- `GarageBrandsService.addJob(tx, actor, garageId, brandId, jobTypeId): Promise<void>` — throws `ConflictException({ code: 'brand_not_worked_on' })` unless the garage's row is `works_on`
- `BrandLoader.load(records: readonly BrandRecord[]): Promise<{ changed: number }>` — throws `BrandFileError` (message names the duplicate) and rolls everything back

`actor` is the existing `Actor` (`libs/domain/src/auth/policy.ts`) and is written to the audit entry; the loader audits as `system`.

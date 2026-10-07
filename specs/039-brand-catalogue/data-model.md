# Data model: Brand catalogue and its upkeep

Prisma models in `libs/domain/prisma/schema/` (one file per module, A6); one migration `libs/domain/prisma/migrations/20261007090000_brand_catalogue/migration.sql`, written by hand in the style of the existing ones (snake_case tables and columns, `TIMESTAMPTZ(3)`, UUID ids). Column names below are the database's; the Prisma field is camelCase with `@map`.

## `brand` — `catalogue.prisma` (new file)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `UUID` PK, `@default(uuid())` | the brand's identity across the product (FR-001, FR-002) |
| `key` | `TEXT` UNIQUE | the stable key from the data file; renames and retirements are matched by it (FR-005) |
| `name` | `TEXT` UNIQUE | written one way ("Škoda", "Mercedes-Benz") |
| `slug` | `TEXT` UNIQUE | derived from the name by folding accents and case (`skoda`, `mercedes-benz`) |
| `popularity` | `INTEGER` NULL | rank from the file; lower is more popular; NULL sorts last (FR-011) |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | true exactly when the brand is in the current file (FR-002, FR-006) |
| `created_at` | `TIMESTAMPTZ(3) NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ(3) NOT NULL` `@updatedAt` | |

Index: `(active, popularity, name)` for the active-list read. Relations: `garageBrands GarageBrand[]`. Rows are never deleted (a retired brand keeps `active=false`).

### The data file, `libs/domain/src/catalogue/brands.ts`

```ts
export interface BrandRecord {
  key: string;        // stable, lower-case, never changes once shipped
  name: string;       // as shown, official spelling
  popularity?: number; // 1 = most popular; absent = unranked
}
export const BRANDS: readonly BrandRecord[] = [ … ];
```

Development content (twelve rows, popularity 1–12 in the mock's order): BMW, Mini, Mercedes-Benz, Audi, Volkswagen, Škoda, Dacia, Renault, Ford, Toyota, Hyundai, Tesla (FR-003, SC-001). ST-245 replaces the content with every brand sold in Romania through the same loader.

### Loader semantics (`BrandLoader.load(records)`)

One transaction, `pg_advisory_xact_lock(hashtext('brand_loader'))` first.

1. Validate the file: two records with the same `key`, the same `name`, or names that fold to the same slug → `BrandFileError('duplicate <key|name|slug> "<value>": <key a>, <key b>')`, before any write (FR-007).
2. Read every stored brand. A record whose `name` or `slug` is held by a stored brand with a different `key` (active or retired) → `BrandFileError`, nothing written (FR-007).
3. For each record, by `key`: absent → create `{ active: true }` and audit `create`; present → compare `name`, `slug`, `popularity ?? null`, `active: true` with the row and `update` only the fields that differ, audited per field through `recordChanges` (FR-004, FR-005; a retired brand that returns is the same row, `active` false → true).
4. Each stored brand whose `key` is not in the file and is `active` → `active=false`, audited (FR-006).
5. Commit. When step 3 or 4 wrote anything: `DEL brands:active` (FR-009), errors logged.

Audit entry: `subjectType: 'brand'`, `subjectId: brand.id`, `actorId: null`, `actorRole: 'system'` (named "MotorFix" by `AuditService`), `garageId` absent (FR-008). A `BrandFileError` aborts the call, so the awaited load in `main.ts` fails and the API does not start on a refused file; the error names the duplicate. A second run with the same file performs steps 1–2 and writes nothing (FR-004, SC-002).

## `garage_brand` — `garages.prisma`

| Column | Type | Rule |
| --- | --- | --- |
| `garage_id` | `UUID` FK → `garage(id) ON DELETE CASCADE` | |
| `brand_id` | `UUID` FK → `brand(id)` (no cascade: brands are never deleted) | |
| `stance` | enum `garage_brand_stance` (`works_on`, `does_not_take`) NOT NULL | FR-013 |
| `petrol`, `diesel`, `hybrid`, `electric` | `BOOLEAN NOT NULL DEFAULT true` | all true on a new `works_on` row (FR-014) |
| `created_at` | `TIMESTAMPTZ(3) NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ(3) NOT NULL` `@updatedAt` | |

Primary key `(garage_id, brand_id)`: at most one row per garage and brand (FR-013). Unique on `(garage_id, brand_id)` is the PK; the FK from `garage_brand_job` references it.

Constraint `garage_brand_fuel_check`: `CHECK ("stance" = 'works_on' OR NOT ("petrol" OR "diesel" OR "hybrid" OR "electric"))` — a `does_not_take` row carries no tick; ticking one on it is refused by PostgreSQL (FR-014). Prisma does not model CHECKs; the migration adds it, the schema file carries a comment naming it.

Garage's answer (`GarageBrandsService.stanceFor`): the row's `stance`, or `unstated` when there is no row (FR-013, FR-017). Asked for a retired brand it answers from the row as usual (spec edge case).

State transitions (`GarageBrandsService.setStance(tx, actor, garageId, brandId, stance)`), audited as `garage_brand` with `garageId`:

- no row → `works_on`: create with the four defaults (true).
- no row → `does_not_take`: create with the four ticks false.
- `works_on` → `does_not_take`: update stance, set the four ticks false, `deleteMany garage_brand_job` for the pair, same transaction (FR-014).
- `does_not_take` → `works_on`: update stance, set the four ticks true (the row is "first marked as worked on" again; the brief's X20d default).
- same stance again: no write.

Fuel-tick edits themselves are ST-397's; they hit the CHECK if they try a `does_not_take` row.

## `garage_brand_job` — `garages.prisma`

| Column | Type | Rule |
| --- | --- | --- |
| `garage_id`, `brand_id` | `UUID`, FK `(garage_id, brand_id)` → `garage_brand ON DELETE CASCADE` | a job never outlives its brand row |
| `job_type_id` | `UUID NOT NULL` | no FK until ST-354 creates `job_type` (spec Clarifications) |
| `created_at` | `TIMESTAMPTZ(3) NOT NULL DEFAULT now()` | |

Primary key `(garage_id, brand_id, job_type_id)`: the row's presence is the tick (FR-015). `GarageBrandsService.addJob(tx, actor, garageId, brandId, jobTypeId)` reads the `garage_brand` row inside the transaction and refuses with `brand_not_worked_on` (409 Conflict, RFC 9457 through `ProblemFilter`) unless its stance is `works_on`; otherwise it creates the row (an existing one is left as it is) and audits it as `garage_brand_job` (FR-015). Removing a job is ST-412's.

## `garage` — two columns, `garages.prisma`

| Column | Type | Rule |
| --- | --- | --- |
| `brand_note` | `TEXT` NULL | `CHECK ("brand_note" IS NULL OR (char_length("brand_note") <= 140 AND btrim("brand_note") <> ''))` (FR-016) |
| `refusal_phrase` | `TEXT` NULL | `CHECK ("refusal_phrase" IS NULL OR (char_length("refusal_phrase") <= 60 AND btrim("refusal_phrase") <> ''))` (FR-016) |

Exactly 140 or 60 characters pass; 141 or 61 are refused; a blank text is refused, so nothing blank is ever stored — the story that writes these fields trims the input and stores `NULL` for an empty or whitespace-only text (spec edge case). `char_length` counts characters, not bytes, so "Ș" counts once.

## Cache

One Redis key, `brands:active`: the JSON array of `{ id, name, slug, popularity }` for active brands in `popularity ASC NULLS LAST, name ASC` order, `EX 3600`. Written by `BrandsService` on a miss, deleted by `BrandLoader` after a changing run. PostgreSQL holds the truth; Redis down means the list is read from PostgreSQL on every call and logged once (FR-009, FR-012, Constitution VI).

## Search (`BrandsService.search(q, cursor)`)

`fold(s) = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`; matches = active list where `fold(name).includes(fold(q.trim()))` (every brand when `q` is empty); page = the 20 after the item with id `cursor` (from the start when absent); `cursor` not among the matches → 400 `invalid_cursor`; `nextCursor` = last item's id when more follow, else null; `total` = matches.length (FR-010, FR-011, FR-012).

## Spec Delta carriers

- Capability `catalogue`: `brand`, the data file, the loader, the cache, the search (FR-001..FR-012).
- Capability `garage-brands`: `garage_brand`, `garage_brand_job`, the two `garage` columns, `GarageBrandsService` (FR-013..FR-017).

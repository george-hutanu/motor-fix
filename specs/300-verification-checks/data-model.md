# Data model: ST-300 Store each file's checks and their results

All in `libs/domain/prisma/schema/garages.prisma`, with one hand-written migration `libs/domain/prisma/migrations/20261007140000_verification_check/migration.sql` (style: `20261007120000_verification_file`).

## Enums

| Prisma | PostgreSQL (`@@map`) | Values |
| --- | --- | --- |
| `VerificationCheckKind` | `verification_check_kind` | `company`, `caen`, `rar`, `activities`, `representative`, `address`, `photos`, `documents` (this order is the kinds' order everywhere) |
| `VerificationCheckResult` | `verification_check_result` | `not_run`, `ok`, `warning`, `failed` |

## `verification_check` (model `VerificationCheck`)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid pk, default uuid | |
| `file_id` | uuid, FK `verification_file(id)` on delete cascade | |
| `kind` | `verification_check_kind` | |
| `automatic` | boolean not null default false | stays false at launch (no automatic look-up yet) |
| `result` | `verification_check_result` not null default `not_run` | |
| `detail` | text null | migration: `CHECK (char_length(detail) <= 200)`; required by the service for `warning` and `failed` |
| `recorded_by` | uuid null | no FK (as `decided_by`); null until the first record |
| `recorded_at` | timestamptz(3) null | set by every record |

Constraints and indexes: `UNIQUE (file_id, kind)` (`@@unique([fileId, kind])`), which is also the lookup index. Relation: `VerificationFile.checks VerificationCheck[]`. No `evidence` column (spec Clarifications).

Back-fill, in the migration, so files sent before this change have their rows (FR-002):

```sql
INSERT INTO verification_check (id, file_id, kind)
SELECT gen_random_uuid(), f.id, k.kind
FROM verification_file f CROSS JOIN unnest(enum_range(NULL::verification_check_kind)) AS k(kind);
```

## `rar_activity` (model `RarActivity`)

| Column | Type |
| --- | --- |
| `code` | text pk |
| `name_ro` | text not null |
| `name_en` | text not null |

Seeded in the same migration: `mechanics` Mecanică/Mechanics, `brakes` Frâne/Brakes, `steering` Direcție/Steering, `suspension` Suspensie/Suspension, `air_con` Aer condiționat/Air conditioning (the Build brief's proposal until the lawyer's list, T12). Nothing writes it at runtime.

## `garage.rar_activities`

`rarActivities String[] @default([]) @map("rar_activities")` — `text[] NOT NULL DEFAULT '{}'`. Holds `rar_activity.code` values, validated by the service (no array FK). Written only by a record of the `activities` kind that carries a list; an omitted list leaves it as it is.

## Lifecycle

- Created: 8 rows per file by `submit()` and `resend()` (`createMany`, `skipDuplicates`), inside the caller's transaction, before `verification.submitted` is written; no audit entry per row.
- Updated: by `record()` only, and only while the file is `submitted` or `in_review` (a reopened file is `in_review` again); `approved`, `rejected` and `more_requested` refuse with 409. Last save wins; every save sets `recorded_by` and `recorded_at`.
- Deleted: with the file (cascade); never on its own.

## Derived, never stored

- Lamp: `ok` green, `warning` amber, `failed` red, `not_run` grey (`lamp()` in contracts).
- Summary line per file (`checkSummary()` in contracts): part 1 names `company` and/or `rar` when `ok`; part 2 the most serious problem — `failed` before `warning`, `rar` before any other kind, then the kinds' order — as `<kind name> <detail>`, with `rar = failed` reading "Lipsește autorizația RAR" / "RAR licence missing"; joined with " · "; capitalised first letter; "Neverificat" / "Not checked" when neither part exists.

## Audit entry per record (`activity_log`)

`action = update`, `subject_type = 'verification_check'`, `subject_id = <check id>`, `garage_id`, `kind = 'verification_check_recorded'`, `field = <check kind>`, `old_value` / `new_value` = `{ result, detail }`, plus `activities: string[]` (the garage's list before and after) when the kind is `activities`. Actor from the admin; `actor_role = admin`.

## Outbox event per record (`outbox_event`)

`kind = 'verification.check_recorded'`, `subject_id = <file id>`, `payload = { fileId, kind, result }`, `audience = ['admin', 'system']` (`{ type: 'platform' }`).

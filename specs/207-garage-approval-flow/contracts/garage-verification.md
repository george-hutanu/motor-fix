# Contracts: ST-207 garage approval flow

## REST: `GET /api/v1/garages/{slug}` (public, `@Public()`, tag `garages`)

Joins `PUBLIC` in `apps/api/src/public-routes.integration.spec.ts` as `GET /api/v1/garages/<SOME_ID>` (the list replaces `{slug}` with the test's id).

| Answer | When | Body |
| --- | --- | --- |
| 200 | the garage is `approved` | `PublicGarageDto { id: uuid, name: string, slug: string }` |
| 410 `gone` | the garage is `suspended` | problem details, detail "This garage is no longer listed" |
| 404 `not_found` | never approved (`draft`, any file state) or no such slug | problem details, one body for both |

Caching: none; every call reads the database.

## Contracts library (`@motor-fix/contracts`)

- `libs/contracts/src/garages.dto.ts`: `PublicGarageDto` (`@ApiProperty` on each field).
- `libs/contracts/src/garage-status.ts`:
  - `GARAGE_STATUSES = ['draft', 'approved', 'suspended'] as const`, `VERIFICATION_FILE_STATUSES = ['submitted', 'in_review', 'approved', 'more_requested', 'rejected'] as const`.
  - `garageStatusKey(garage: { status }, newestFile: { status; reasonCode; reasonNote } | null): { key: GarageStatusKey; reason?: { code; note } }`.
  - `GARAGE_STATUS_LABELS: Record<'ro' | 'en', Record<GarageStatusKey, string>>`, `statusLabel(key, language): string` (suffix on the unpublished keys).
  - `REAPPROVAL_FIELDS`.

## Domain use cases (`VerificationService`, exported from `@motor-fix/domain`; no endpoint)

Actor: `VerificationActor = Pick<Actor, 'accountId' | 'role' | 'garageId' | 'permissions'> | { accountId: null; role: 'system' }`.

| Method | Trust | Refusals | Returns |
| --- | --- | --- | --- |
| `submit(tx, actor, garageId)` | none here (the submission story's) | 409 `verification_transition_refused` when the newest file is live or `more_requested`; same on the unique index's `P2002` | the new `VerificationFile` (already `approved` when the test switch is on) |
| `open(tx, actor, fileId)` | `admin` (404 otherwise) or `system` | 409 for any status but `submitted` / `in_review`; 404 unknown id | `{ openedBy, openedAt, byAnother: boolean }` |
| `decide(tx, actor, fileId, decision)` | `admin` or `system` | 409 unless `submitted` / `in_review`; 404 unknown id | the updated file |
| `resend(tx, actor, fileId)` | none here | 409 unless `more_requested` | the updated file |
| `reopen(tx, actor, fileId)` | `admin` or `system` | 409 unless `approved` / `rejected` / `more_requested` | the updated file |

`decision: { outcome: 'approved' } | { outcome: 'more_requested' | 'rejected'; reason: { code: string; note: string } }`.

Problem for 409: `{ code: 'verification_transition_refused', status: 409, detail }` with the detail of research.md R2.

## Configuration

`verificationConfig(appEnv, source): { skipManualApproval: boolean }`; `SKIP_MANUAL_APPROVAL` is read as `1` or `true`, only under `APP_ENV=test`, never required.

## Generated

`apps/api/openapi.json` (`npx nx run api:openapi`) and `libs/data-access` (`npx nx run data-access:generate`) regenerated; the client gains the `garages` service with the public read.

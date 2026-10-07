# Data model: ST-207 garage approval flow

Schema file: `libs/domain/prisma/schema/garages.prisma`. Migration: `libs/domain/prisma/migrations/20261007120000_verification_file/migration.sql`. Every timestamp `@db.Timestamptz(3)` (UTC).

## Enums

- `GarageStatus` (`garage_status`): `draft`, `approved`, `suspended`. Replaces `Garage.status String @default("draft")` in place (research.md R3).
- `VerificationFileStatus` (`verification_file_status`): `submitted`, `in_review`, `approved`, `more_requested`, `rejected`.

## Garage (changed)

| Field | Type | Note |
| --- | --- | --- |
| `status` | `GarageStatus @default(draft)` | public when and only when `approved` |
| `approvedAt` | `DateTime? @map("approved_at")` | set at every approval, a reopened file's included |
| `verificationFiles` | `VerificationFile[]` | relation |

## VerificationFile (new, `verification_file`)

| Field | Type | Note |
| --- | --- | --- |
| `id` | `String @id @default(uuid()) @db.Uuid` | |
| `garageId` | `String @db.Uuid` | `onDelete: Cascade` |
| `status` | `VerificationFileStatus @default(submitted)` | |
| `openedBy`, `openedAt` | `String? @db.Uuid`, `DateTime?` | the first admin's open |
| `decidedBy`, `decidedAt` | `String? @db.Uuid`, `DateTime?` | `decidedBy` null = the system ("MotorFix") |
| `reopenedBy`, `reopenedAt` | `String? @db.Uuid`, `DateTime?` | overwritten by each reopening; the history keeps every one |
| `previousFileId` | `String? @unique @db.Uuid` | the rejected file this one follows (self relation, `onDelete: SetNull`) |
| `reasonCode`, `reasonNote` | `String?`, `String?` | of the last `more_requested` or `rejected` decision; kept on reopen, overwritten by the next decision |
| `createdAt` | `DateTime @default(now())` | the newest file is the one with the greatest `createdAt`, then `id` |

Indexes: `@@index([garageId, createdAt])`; by hand, `verification_file_one_live UNIQUE (garage_id) WHERE status IN ('submitted','in_review','approved')` (research.md R4). No actor foreign keys: an entry outlives the admin's account, as the audit log does.

## Transitions (FR-002), as `FROM: Record<Transition, VerificationFileStatus[]>`

| Use case | From | To | Sets | Audit `kind` | Outbox kind |
| --- | --- | --- | --- | --- | --- |
| `submit` | no file, or newest `rejected` | new row `submitted`, `previousFileId` = the rejected one | | `create` (no kind) | `verification.submitted` |
| `open` | `submitted` | `in_review` | `openedBy`, `openedAt` | `verification_opened` | `verification.opened` |
| `open` on `in_review` | `in_review` | unchanged | nothing; returns `openedBy`, `openedAt` | none | none |
| `decide` | `submitted`, `in_review` | `approved` \| `more_requested` \| `rejected` | `decidedBy`, `decidedAt`, `reasonCode`, `reasonNote` | `verification_decided` | `verification.decided` (`decision` in the payload) |
| `resend` | `more_requested` | `submitted` | | `verification_resent` | `verification.submitted` |
| `reopen` | `approved`, `rejected`, `more_requested` | `in_review` | `reopenedBy`, `reopenedAt` | `verification_reopened` | `verification.reopened` |

Every other ordered pair, and a submit while the newest file is `submitted`, `in_review`, `approved` or `more_requested`, is 409 `verification_transition_refused` (research.md R2). `decide` → `approved` also runs `garage.update({ status: 'approved', approvedAt: now })` with its own audit entry (`garage.status`); every other transition leaves the garage as it is (FR-003). With `skipManualApproval` on, `submit` calls `decide` as `system` in the same transaction (research.md R8).

Audience: `admin`, `garage:{garageId}`; an approval adds `public:garage:{garageId}` and `public:search:{brandId}` per brand (none today). Payload: `{ garageId, fileId }`, plus `decision` on `verification.decided`.

## Derived status (FR-006), `garageStatusKey(garage, newestFile)` in `libs/contracts/src/garage-status.ts`

| Key | When | ro | en |
| --- | --- | --- | --- |
| `suspended` | garage `suspended` | Suspendat | Suspended |
| `approved` | garage `approved` (whatever the newest file) | Aprobat, pe hartă | Approved, on the map |
| `rejected` | newest file `rejected` (carries `reasonCode`, `reasonNote`) | Respins | Rejected |
| `more_requested` | newest file `more_requested` | Cerute completări | More details requested |
| `under_review` | newest file `in_review` | În verificare | Under review |
| `sent` | newest file `submitted` | Trimis | Sent |
| `draft` | garage `draft`, no file | Ciornă | Draft |

Order of the rules: garage status first (`suspended`, `approved`), then the newest file, then `draft`. `statusLabel(key, language)` appends ` · nepublicat` / ` · not published` to every key but `approved`. Nothing is stored.

## Re-approval field list (FR-007)

`REAPPROVAL_FIELDS = ['cui', 'address', 'seat_address', 'business_kind', 'work_kinds'] as const` in the same file; a constant for the change-flow stories, read by nothing here.

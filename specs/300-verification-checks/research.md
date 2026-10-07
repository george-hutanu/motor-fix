# Research: ST-300 Store each file's checks and their results

No `NEEDS CLARIFICATION` was left in Technical Context; the decisions below are the ones the plan rests on, each with its evidence.

## R1. The 8 rows are created by submit and resend, in the caller's transaction

- Decision: `VerificationService.submit()` and `resend()` call `tx.verificationCheck.createMany({ data: KINDS.map(kind => ({ fileId, kind })), skipDuplicates: true })` right after the file row is written/moved and before `announce()`.
- Rationale: the same outcome as a consumer of `verification.submitted` with no new queue, and the rows exist when the event is relayed (spec Clarifications, Constitution VI). `skipDuplicates` makes the resend idempotent against the unique `(file_id, kind)` without a read.
- Alternatives considered: a consumer in the worker (a queue, a window where the event is out but the rows are not); a read-then-insert (a race on a double resend).
- Evidence: `libs/domain/src/garages/verification.service.ts:80-103` (submit), `:209-219` (resend); `libs/domain/src/generated/prisma/models/VerificationFile.ts:643` (`skipDuplicates?: boolean` on `createMany`).

## R2. One migration, hand-written, in the style of the file migration

- Decision: `libs/domain/prisma/migrations/20261007140000_verification_check/migration.sql`, written by hand (enums, tables, FK with cascade, unique index, CHECK, catalogue seed, column, back-fill), after a `prisma migrate diff`-shaped draft is checked against the schema.
- Rationale: the repo's migrations are hand-held SQL (`prisma.config.ts:5`; `20261007120000_verification_file/migration.sql`), and a CHECK, a seed and a back-fill cannot be expressed in the schema language.
- Alternatives considered: `prisma migrate dev` (interactive, and it would not write the seed or the back-fill); a seed script for `rar_activity` (`libs/domain/src/seed.ts` exists but runs only by hand; the catalogue must exist wherever the migration ran).
- Evidence: `libs/domain/prisma.config.ts:3-7`; `libs/domain/prisma/migrations/` (newest stamp `20261007130000_notification_sending`, so `20261007140000` sorts after it); `garages.prisma:33-35` (CHECKs in a migration, noted in the schema comment).

## R3. The RAR activity catalogue is a table seeded in the migration, with the five proposed codes

- Decision: `rar_activity (code text pk, name_ro, name_en)` seeded with `mechanics`/Mecanică/Mechanics, `brakes`/Frâne/Brakes, `steering`/Direcție/Steering, `suspension`/Suspensie/Suspension, `air_con`/Aer condiționat/Air conditioning; `garage.rar_activities text[] not null default '{}'` holds codes, validated by the service against the table (no array FK in PostgreSQL).
- Rationale: FR-005; the list is with the lawyer (T12), so a table the lawyer's list can replace by a later migration beats a constant in code; the garage's list is read as a whole by the file and queue stories, so an array column beats a join table.
- Alternatives considered: a `garage_rar_activity` join table (a second table and FK for a list of at most a handful of codes); an enum (a change needs a migration either way, and names in two languages do not fit an enum).
- Evidence: context.md Decisions ("Recording `activities` also stores `GARAGE.rar_activities` (RAR_ACTIVITY codes; code, name_ro, name_en)"); context.md Open Decisions (T12).

## R4. The record use case lives in its own service, called inside one transaction from the controller

- Decision: `VerificationChecksService.record(tx, actor, fileId, kind, body)` next to `VerificationService` (not a method on it: the file service is the state machine, this one never moves the file); the controller wraps it in `prisma.$transaction`, as the domain's other controllers do with their services.
- Rationale: one use case per rule (Constitution V); the three form stories (ST-203, ST-204, the address/photos/documents one) call this one method; the file service stays about the file's status.
- Alternatives considered: a method on `VerificationService` (one more concern in a 400-line file); a per-kind strategy (eight kinds, one of which differs by one optional field).
- Evidence: `libs/domain/src/garages/verification.service.ts:61-66` (ports injected, `tx` passed in); `garages.module.ts:45-56` (providers; `AUDIT_PORT` provided; `EVENT_PORT` from the imported notifications module).

## R5. Lamp and summary are pure functions in the contracts library

- Decision: `libs/contracts/src/verification-checks.ts` exports `VERIFICATION_CHECK_KINDS`, `VERIFICATION_CHECK_RESULTS`, `lamp(result)` and `checkSummary(checks, language)`; the kind names of the summary's second part are a table in the same file (`ro`: company "CUI", caen "cod CAEN", rar "autorizație RAR", activities "activități", representative "reprezentant", address "adresă", photos "fotografii", documents "documente"; `en`: "company ID", "CAEN code", "RAR licence", "activities", "representative", "address", "photos", "documents").
- Rationale: the queue story reads the same line (spec Clarifications: "one function builds it … the queue story calls the same function"), and the contracts library is what both the API and the web app compile (`garage-status.ts` precedent).
- Alternatives considered: a summary endpoint (a second read of what the queue already joins); building the line in the service only (the queue would copy it).
- Evidence: `libs/contracts/src/garage-status.ts:1-60` (constants and a pure derivation, with `GARAGE_STATUS_LABELS` in `ro` and `en`); spec FR-008, FR-009 and the Clarifications' exact texts.

## R6. Errors reuse the existing problem shapes

- Decision: malformed or unknown file id → `NotFoundException` (as `VerificationService.file()`); non-admin → `requireCapability(actor, 'admin.garages')` (404); unknown kind → `refusal(HttpStatus.UNPROCESSABLE_ENTITY, 'verification_check_kind_unknown', …)`; missing/long detail or unknown activity code → `refusal(HttpStatus.BAD_REQUEST, 'validation_failed', …, errors)`; decided file (`approved`, `rejected`, `more_requested`) → `refusal(HttpStatus.CONFLICT, 'verification_file_decided', 'Dosarul e deja decis')`. The `ValidationPipe` catches a malformed body (wrong result value, non-string detail, non-array activities) before the service, as 400 `validation_failed`.
- Rationale: spec FR-010/FR-011; A28/A42 problem details; the same helpers the file service uses.
- Alternatives considered: `ParseEnumPipe` on `:kind` (answers 400, the spec says 422); a `ParseUUIDPipe` on `:id` (answers 400 for a malformed id, the spec and the file service say 404).
- Evidence: `libs/domain/src/auth/sign-up.service.ts:24-29` (`refusal`); `libs/domain/src/auth/policy.ts:42-52`; `verification.service.ts:251-266` (`file()`); `apps/api/src/bootstrap.ts:38-44` (global pipe, `whitelist`, `forbidNonWhitelisted`).

## R7. The audit entry and the event

- Decision: one `AuditPort.record` per record call: `action: 'update'`, `subjectType: 'verification_check'`, `subjectId: <check id>`, `garageId`, `kind: 'verification_check_recorded'`, `field: <the check kind>`, `oldValue`/`newValue: { result, detail }` plus `activities` (the garage's list before and after) for the `activities` kind. One `EventPort.record`: `kind: 'verification.check_recorded'`, `subjectId: fileId`, `payload: { fileId, kind, result }`, `audience: { type: 'platform' }`.
- Rationale: FR-006, FR-007; the Clarifications fix the values; `platform` is the audience whose channels are `admin` and `system`, the admin channel the Build brief names without the garage's own channel.
- Alternatives considered: `recordChanges` (one entry per differing field; the spec wants one entry with both values); `{ type: 'verification', garageId }` (would also reach `garage:{id}`, which the clarification excludes).
- Evidence: `libs/domain/src/audit/audit.port.ts:4-22` (`AuditEntry`), `audit.service.ts:37-60`; `libs/domain/src/events/audience.ts:2-24,76-77`; `libs/contracts/src/events.ts` (`'verification.check_recorded'` already listed).

## R8. Regenerating the contract

- Decision: after the controller and DTOs compile, run `npx nx run data-access:generate` (which builds the API and writes `apps/api/openapi.json` through `api:openapi`, then the client) and commit both; `scripts/contract-check.sh` is what CI runs.
- Evidence: `libs/data-access/project.json:10-15`; `apps/api/project.json:8-12`; `scripts/contract-check.sh:5-12`.

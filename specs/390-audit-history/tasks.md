# Tasks: Audit history writer

**Input**: spec.md, plan.md, data-model.md, contracts/audit-writer.md, research.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

None: no new project, dependency or environment variable.

## Phase 2: Foundational (blocks every story)

- [X] T001 `libs/domain/prisma/schema/audit.prisma`: model `ActivityLog` @@map("activity_log") with `id` uuid PK, `at` timestamptz(6) default `dbgenerated("clock_timestamp()")`, `action` enum `AuditAction` "create, update, delete, open" (@@map audit_action), `subjectType` text, `subjectId` uuid, `field?`, `oldValue Json?`, `newValue Json?`, `actorId?` uuid (no FK), `actorRole` enum `AuditActorRole` "driver, owner, receptionist, mechanic, admin, system" (@@map audit_actor_role), `actorName` text, `viaAssistant` bool default false, `assistantGrantId?` uuid, `garageId?`/`carId?`/`jobId?` uuid (no FK), `isKeyChange` bool default false, `internal` bool default false, `kind?`, `text?`; indexes (garage_id, at), (car_id, at), (job_id, at), (actor_id, at) (FR-002, FR-005, FR-007, FR-008, FR-009, FR-010, FR-015)
- [X] T002 Migration `libs/domain/prisma/migrations/20261004120000_audit_history/migration.sql` (new) from `prisma migrate diff --from-schema <main's schema> --to-schema prisma/schema --script`, plus function `activity_log_refuse()` and triggers BEFORE UPDATE OR DELETE (row) and BEFORE TRUNCATE (statement) raising "activity_log is append-only"; apply with psql to `motorfix_390` and to a fresh database after the accounts migration; `prisma generate` (FR-011, SC-005)

## Phase 3: User Story 1 — every change written with its entry, same transaction (P1)

Independent test: change + entry in one transaction; a throw after the entry leaves none; a failing entry fails the change.

- [X] T003 [US1] `libs/domain/src/audit/audit.port.ts`: `AuditEntry` gains `action` `'open'`, `actorName?`, `assistantGrantId?`, `garageId?`, `carId?`, `jobId?`, `internal?`, `kind?`, `text?`; `AuditPort.recordChanges(tx, entry, before, after)`; remove `noAudit` (FR-001, FR-002, FR-003)
- [X] T004 [US1] `libs/domain/src/audit/audit.service.ts` (new): `@Injectable() AuditService implements AuditPort`; `record` inserts through `tx.activityLog.create` with values as JSON (null/undefined → SQL NULL, dates → ISO strings); `recordChanges` writes one `update` entry per key of `after` whose `JSON.stringify` differs from `before`, nothing when none differ (FR-001, FR-002, FR-003, FR-004)
- [X] T005 [US1] `libs/domain/src/auth/auth.module.ts`: bind `AUDIT_PORT` with `useClass: AuditService`; `libs/domain/src/auth/auth.api.spec.ts` and `libs/domain/src/auth/auth.adversary.http.spec.ts`: `noAudit` → `new AuditService()` (FR-013)

## Phase 4: User Story 2 — actor, scope and flags on every entry (P1)

Independent test: write entries for each actor kind and flag and read the columns.

- [X] T006 [US2] `libs/domain/src/audit/audit.service.ts`: actor role `garage` → `owner`; actor name = trimmed text before the first whitespace of the given name, else of `account.name` read through `tx`, else ""; `system` → "MotorFix"; `via_assistant` = `assistantGrantId` set; scope ids and `internal` copied (FR-005, FR-006, FR-007, FR-008)
- [X] T007 [US2] `libs/domain/src/audit/audit.service.ts`: `is_key_change` from the set `quote.from_bani`, `quote.to_bani`, `job.final_price_bani`, `job.status`, `job.eta_at`, `booking.starts_at`, `booking.mechanic_id` (FR-009)

## Phase 5: User Story 3 — nobody rewrites the history, no write use case skips it (P2)

Independent test: UPDATE/DELETE/TRUNCATE refused; the coverage check fails on a fixture service that writes without auditing.

- [X] T008 [US3] Triggers verified by `libs/domain/src/audit/audit.service.spec.ts` (delivered by T002) (FR-011)
- [X] T009 [US3] `libs/domain/src/audit/audit-coverage.spec.ts` (new): the check over `libs/domain/src/**/*.service.ts` and over a fixture source (FR-014, SC-004)

## Phase 6: Polish

- [X] T010 Fresh-database proof of both migrations and full `npm run typecheck && npm run lint && npm test` (SC-005)

## FR → test

| FR | Test |
| --- | --- |
| FR-001 | audit.service.spec.ts — "writes the entry in the change's transaction", "leaves no entry when the transaction rolls back", "fails the change when the entry cannot be written" |
| FR-002 | audit.service.spec.ts — "stores who, what, when, old and new" |
| FR-003 | audit.service.spec.ts — "writes one entry per changed field", "writes nothing when no field changed", "compares values by content" |
| FR-004 | audit.service.spec.ts — "keeps a deleted repair as its old value" |
| FR-005 | audit.service.spec.ts — "records the garage role as owner" |
| FR-006 | audit.service.spec.ts — "names a person by first name", "looks the name up", "names the system MotorFix" |
| FR-007 | audit.service.spec.ts — "marks an assistant change" |
| FR-008 | audit.service.spec.ts — "carries the job, car and garage ids" |
| FR-009 | audit.service.spec.ts — "marks each key change" (one case per row), "price list rows are not key changes" |
| FR-010 | audit.service.spec.ts — "stores kind and text" |
| FR-011 | audit.service.spec.ts — "refuses update", "refuses delete", "refuses truncate" |
| FR-012 | audit.service.spec.ts — "stores who, what, when, old and new" (the writer has one table, activity_log) |
| FR-013 | accounts.service.spec.ts — "stores the account entries in the audit history" |
| FR-014 | audit-coverage.spec.ts |
| FR-015 | audit.service.spec.ts — "keeps the write order within one transaction" |

## Dependencies

T001 → T002 → T003 → T004 → T005; T006, T007 after T004; T008 after T002; T009 independent of T001–T007.

## Implementation strategy

One slice per commit: (1) T001–T005 + T006–T008 writer, table and wiring (`feat(audit)`); (2) T009 coverage check (`test(audit)`).

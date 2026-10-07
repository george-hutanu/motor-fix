# Research: ST-207 garage approval flow

No `NEEDS CLARIFICATION` was left in Technical Context; every decision below is taken from the repository or the Notion digest, with its evidence. Clarify deferred R1 and R2 to this plan.

## R1. Two concurrent transitions on one file end with exactly one committed

- Decision: every transition is one compare-and-set `tx.verificationFile.updateMany({ where: { id, status: { in: FROM[transition] } }, data })`; `count === 0` is the refusal. PostgreSQL's default READ COMMITTED makes the second writer wait on the row lock, re-evaluate its `WHERE` on the committed row and update nothing; the audit entry and outbox row are written after the count check, in the same transaction, so a refused transition writes nothing. The 409 detail is built from a read of the row made after the failed update, which sees the committed winner (each statement takes a new snapshot under READ COMMITTED).
- Rationale: it is the repo's own pattern (`staff-invite.service.ts:141-147`, `:166-171`, `:224-231` with the comment "The row lock makes a second accept wait, then find it taken"), needs no version column, advisory lock or `SERIALIZABLE`, and gives SC-002's "exactly one committed" for free.
- Alternatives: `SELECT … FOR UPDATE` then `update` (two statements, same guarantee, more code); a `version` column (a column nobody else needs); `isolationLevel: Serializable` (retries on 40001, more code and slower).
- Evidence: `libs/domain/src/garages/staff-invite.service.ts:224-231`; PostgreSQL docs, READ COMMITTED: "the would-be updater will wait for the first updating transaction to commit or roll back … then re-evaluate the WHERE clause" (https://www.postgresql.org/docs/current/transaction-iso.html).

## R2. The 409 detail per status

- Decision: code `verification_transition_refused`, status 409, detail by the current status of the row read after the refusal (English, the front end translates by code): `submitted` → "already sent, waiting for review"; `in_review` → "already under review, opened by {first name}" (the reopener when `reopened_at` is later than `opened_at`); `approved` | `more_requested` | `rejected` → "already decided by {first name} ({status})". The first name is the account's name trimmed before its first whitespace, as the audit writer stores it; `null` (the system) is "MotorFix". A submit refused because a live file exists uses the same code and the same detail for that file. A second open of an `in_review` file is not refused (Clarification 2): it returns the row's `openedBy`, `openedAt` unchanged.
- Rationale: FR-002 asks for "the current status and who set it"; the row stores the setter for every status but `submitted` (FR-001 lists no `submitted_by`), so that one names no one. Reusing the writer's `firstName` (exported from `audit.service.ts:29`) keeps the name identical to the history.
- Alternatives: an extension field `by` on the problem (the filter passes only `attemptsLeft`/`inviteId`, `problem.filter.ts:19-25`; a new field for one consumer is bloat); reading the audit history for `submitted`'s author (a second table read for a sentence).
- Evidence: `libs/domain/src/auth/sign-up.service.ts:24-29` (`refusal(status, code, message)`); `libs/domain/src/audit/audit.service.ts:29,71-80`; `apps/api/src/problem.filter.ts:17-36`.

## R3. Garage status as a database enum, converted in place

- Decision: `enum GarageStatus { draft approved suspended }` and `Garage.status GarageStatus @default(draft)`, plus `approvedAt DateTime? @db.Timestamptz(3)`. The migration is Prisma's diff (`npx prisma migrate diff --from-migrations libs/domain/prisma/migrations --to-schema libs/domain/prisma/schema --shadow-database-url …`, or written by hand to the same shape) with the column change written as `ALTER TABLE "garage" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "garage_status" USING "status"::"garage_status", ALTER COLUMN "status" SET DEFAULT 'draft'`, since a text-to-enum cast needs `USING`. The seed inserts no status (`seed.ts:179-182`), so every row is `draft`.
- Rationale: FR-001 fixes the three values; the enum is the repo's pattern (`StaffInviteStatus`, `garages.prisma:70-76`) and types the generated client.
- Alternatives: keep `String` with a CHECK constraint (no client type; a second mechanism).
- Evidence: `libs/domain/prisma/schema/garages.prisma:11-22,70-76`; `libs/domain/src/seed.ts:178-183`; `libs/domain/prisma.config.ts`.

## R4. One live file per garage, enforced by a partial unique index

- Decision: `CREATE UNIQUE INDEX "verification_file_one_live" ON "verification_file" ("garage_id") WHERE "status" IN ('submitted', 'in_review', 'approved');` in the migration by hand. Two concurrent submits for one garage then end with one row; the loser's `P2002` (`Prisma.PrismaClientKnownRequestError`) is answered as the same 409.
- Rationale: the spec's Key Entities invariant and FR-004's refusal need a database guarantee, not a read-then-insert; one line of SQL. Prisma's schema cannot express a partial index; hand-written SQL in a migration has precedent.
- Alternatives: a read before the insert only (a race leaves two live files); a `live` boolean column with a plain unique (a column maintained by every transition).
- Evidence: `libs/domain/prisma/migrations/20261004120000_audit_history/migration.sql:46-58`; `libs/domain/src/auth/sign-up.service.ts:39-41` (the `P2002` check).

## R5. Use cases take the caller's transaction

- Decision: every use case signature starts with `tx: Prisma.TransactionClient` and the actor: `submit(tx, actor, garageId)`, `open(tx, actor, fileId)`, `decide(tx, actor, fileId, decision)`, `resend(tx, actor, fileId)`, `reopen(tx, actor, fileId)`. The service holds no transaction of its own.
- Rationale: ST-116 creates the account, the garage and the file in one transaction (context.md Constraints), and Constitution VI wants the change and its event together; `AccountsService.grantRole(tx, by, …)` is the precedent (`staff-invite.service.ts:230`). The API test of this story opens the transaction as a caller would.
- Alternatives: the service opens `prisma.$transaction` itself (ST-116 could not join it); both shapes (two code paths).
- Evidence: `libs/domain/src/garages/staff-invite.service.ts:222-231`; `libs/domain/src/audit/audit.port.ts:28-37` (`record(tx, …)`).

## R6. Actor, trust and the system actor

- Decision: the actor is `{ accountId: string | null; role: Role | 'system' }` narrowed from the existing `Actor` (`policy.ts:10-16`): `decide` and `reopen` call `requireCapability(actor, 'admin.garages')` for a person (404 for any other role, `policy.ts:41-52`) and accept `role: 'system'` only from server code (no endpoint exists; the test switch uses it). `submit` and `resend` check nothing but the row: who may submit is the submission story's rule. Reason: `{ code: string; note: string }`, required by the type for `more_requested` and `rejected` (a discriminated union, no runtime check); `[NEEDS CLARIFICATION]` for ST-303/ST-305: the code list waits on T12 (context.md Open Decisions).
- Rationale: FR-010; `admin.garages` is the capability the admin already holds (`capabilities.ts:44-51`); the audit writer resolves the actor's name itself and writes "MotorFix" for `system` (`audit.service.ts:71-80`).
- Alternatives: a new capability `admin.verification` (a row nobody else reads yet); a `systemActor` object exported for every module (one literal suffices).
- Evidence: `libs/domain/src/auth/policy.ts:10-16,41-52`; `libs/domain/src/auth/capabilities.ts:44-51`; `libs/domain/src/audit/audit.port.ts:5-7`.

## R7. The public scope and the bypass test

- Decision: `export const publicGarages = () => ({ status: 'approved' as const })`, spread into `where` (`prisma.garage.findFirst({ where: { slug, ...publicGarages() } })`). The scope's file also holds `PublicGaragesService.bySlug(slug)`: through the scope, else `findUnique({ where: { slug }, select: { status: true } })` to choose 410 `gone` (`suspended`) over 404 `not_found` (everything else, same body as an unknown slug). The test `public-garages.scope.spec.ts` parses `libs/domain/src/**/*.controller.ts` with the TypeScript API as `audit-coverage.spec.ts` does: for every handler under `@Public()` (on the method or its class) it follows `this.<field>.<method>()` to the field's class, and fails naming `File#method` when that method (or a method it calls in the same class) runs `garage.findMany | findFirst | findUnique | findFirstOrThrow | findUniqueOrThrow | count` without `publicGarages()` in its arguments; `public-garages.ts` is exempt for the status read.
- Rationale: FR-005 wants the method named; the scan covers search, map, sitemap and profile routes as they are added without a registry. The MCP server's tools have no controller; the scan is widened when the assistant story arrives (noted in quickstart).
- Alternatives: a Prisma client extension that forces the filter on every garage read (hides the rule from the code and breaks admin reads); a `PublicRead` decorator registry (a second list to keep).
- Evidence: `libs/domain/src/audit/audit-coverage.spec.ts:1-80`; `libs/domain/src/auth/actor.guard.ts:36` (`Public = () => SetMetadata(PUBLIC, true)`); `apps/api/src/public-routes.integration.spec.ts:25-50,70-76` (route paths with `{slug}` replaced by `SOME_ID`).

## R8. The test switch

- Decision: `verificationConfig(appEnv, source)` returns `{ skipManualApproval: appEnv === 'test' && ['1', 'true'].includes(source['SKIP_MANUAL_APPROVAL'] ?? '') }`, read in `app.module.ts` from `process.env` as `emailConfig(env.APP_ENV, process.env)` is (`app.module.ts:30`), given to `GaragesModule.register` and injected as `VERIFICATION_CONFIG`. When on, `submit` runs `decide(tx, { accountId: null, role: 'system' }, fileId, { outcome: 'approved' })` after the create, in the same transaction.
- Rationale: A33 and Clarification 3; `readEnv` stays untouched so the variable is never required (FR-009).
- Alternatives: adding it to `readEnv`'s list (would make it required or special-case it).
- Evidence: `libs/domain/src/notifications/email-config.ts:44-50`; `apps/api/src/app.module.ts:24-31`; `libs/contracts/src/env.ts:9-31`.

## R9. Audience of the outbox rows

- Decision: `audience: { type: 'verification', garageId }` for every event (`admin`, `garage:{id}`: `audience.ts:56-57`); `verification.decided` on an approval passes `{ type: 'verification', garageId, published: { brandIds: [] } }`, and `audienceOf` adds `public:garage:{garageId}` and one `public:search:{brandId}` per brand. Payload `{ garageId, fileId }` plus `decision` on `verification.decided`.
- Rationale: FR-008; the `verification` subject already exists and the event kinds are already listed (`events.ts:131-135`); the hub already hides `public:` keys from signed-in channels (`live.hub.ts:172`).
- Alternatives: a new subject type `published_garage` (a second case for the same subject).
- Evidence: `libs/domain/src/events/audience.ts:1-22,56-57`; `libs/contracts/src/events.ts:131-135`; `libs/domain/src/events/event.port.ts:24-36`.

## R10. The audit entries

- Decision: on the file, subject `verification_file`: `create` on submit (`newValue: { status: 'submitted', previousFileId }`); `update` with `field: 'status'`, `oldValue`/`newValue` the statuses, `kind: 'verification_opened' | 'verification_decided' | 'verification_resent' | 'verification_reopened'`, and `text: "{code}: {note}"` when a reason exists; `garageId` set. On the garage, subject `garage`, `field: 'status'`, `draft` → `approved`, `kind: 'garage_approved'` (an approval of a reopened file writes the entry with `approved` → `approved` through `record`, since `approved_at` moved).
- Rationale: FR-008 names actor, role, old and new status, reason code and note; the writer's `kind` and `text` columns hold them without a new column (`audit.port.ts:19-20`).
- Alternatives: `recordChanges` over the whole row (one entry per changed column: `opened_by`, `opened_at`… noise in the history).
- Evidence: `libs/domain/src/audit/audit.port.ts:5-21`; `libs/domain/src/garages/staff-invite.service.ts:171-183`.

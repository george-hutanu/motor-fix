---
description: "Task list for ST-207 Keep garages hidden until approved, with a status flow"
---

# Tasks: Keep garages hidden until approved, with a status flow

**Input**: `specs/207-garage-approval-flow/` (spec.md, plan.md, research.md, data-model.md, contracts/garage-verification.md, quickstart.md)
**Tests**: required by the constitution and the red-first gate: each story's specs are written and seen failing before its code. Specs are listed in quickstart.md.
**Format**: `[ID] [P?] [Story] Description`; `(new)` marks a file that does not exist yet.

## Phase 1: Setup

- [ ] T001 Replace `Garage.status String @default("draft")` with `enum GarageStatus (draft, approved, suspended) @default(draft)`, add `approvedAt DateTime? @map("approved_at") @db.Timestamptz(3)`, `enum VerificationFileStatus (submitted, in_review, approved, more_requested, rejected)` and `model VerificationFile` (fields, `previousFileId String? @unique`, `@@index([garageId, createdAt])`, every timestamp `@db.Timestamptz(3)`, no actor foreign keys) in `libs/domain/prisma/schema/garages.prisma`
- [ ] T002 Write `libs/domain/prisma/migrations/20261007120000_verification_file/migration.sql` (new): the two enums, `ALTER COLUMN status TYPE garage_status USING status::garage_status`, `approved_at`, the table, and by hand `CREATE UNIQUE INDEX verification_file_one_live ON verification_file (garage_id) WHERE status IN ('submitted','in_review','approved')`; then `npx prisma generate` and `migrate deploy` under `scripts/heavy.sh`

## Phase 2: Foundational (blocks every story)

- [ ] T003 [P] Export `firstName` (one word) from `libs/domain/src/audit/audit.service.ts` for the 409 detail; no copy
- [ ] T004 [P] Write the failing `published` case (`public:garage:{id}`, `public:search:{brandId}` per brand) in `libs/domain/src/events/audience.spec.ts`, then add `published?: { brandIds }` to the verification subject in `libs/domain/src/events/audience.ts`
- [ ] T005 [P] Write the failing specs `libs/contracts/src/garage-status.spec.ts` (new): every (garage status, newest file) pair maps to exactly one key, seven labels in `ro` and `en`, the ` · nepublicat` / ` · not published` suffix on every key but `approved`, `rejected` carries the reason; then implement `GARAGE_STATUSES`, `VERIFICATION_FILE_STATUSES`, `garageStatusKey()`, `GARAGE_STATUS_LABELS`, `statusLabel()` and `REAPPROVAL_FIELDS` (`cui`, `address`, `seat_address`, `business_kind`, `work_kinds`) in `libs/contracts/src/garage-status.ts` (new), and `PublicGarageDto { id, name, slug }` in `libs/contracts/src/garages.dto.ts` (new); export both from `libs/contracts/src/index.ts`

## Phase 3: User Story 1 - A driver never meets an unapproved garage (P1)

**Goal**: a garage is public only when `approved`; hidden and unknown slugs are indistinguishable.
**Independent test**: set a garage to each of the six non-public states and read its slug; then approve it and read again.

- [ ] T006 [P] [US1] Write the failing `libs/domain/src/garages/public-garages.api.integration.spec.ts` (new): the six non-public states answer the same 404 `not_found` body as an unknown slug, `suspended` answers 410 `gone`, the read right after an approval returns id, name, slug (FR-005, SC-001, SC-004)
- [ ] T007 [P] [US1] Write the failing `libs/domain/src/garages/public-garages.scope.spec.ts` (new): an AST scan of `@Public()` handlers that fails naming `File#method` when a garage read skips `publicGarages()`, with a fixture string proving the failure
- [ ] T008 [P] [US1] Add `'GET /api/v1/garages/<SOME_ID>'` to the list in `apps/api/src/public-routes.integration.spec.ts`
- [ ] T009 [US1] Implement the `publicGarages()` where fragment (`status = approved`, nothing else) and `PublicGaragesService.bySlug()` in `libs/domain/src/garages/public-garages.ts` (new); `GET garages/:slug` marked `@Public()` with the 404/410 problem details in `libs/domain/src/garages/public-garages.controller.ts` (new)
- [ ] T010 [US1] Register the controller and service in `libs/domain/src/garages/garages.module.ts`, export from `libs/domain/src/index.ts`; run `npx nx run api:openapi` (`apps/api/openapi.json`) and `npx nx run data-access:generate` (`libs/data-access/src/lib/**`, never by hand)

## Phase 4: User Story 3 - The file moves only along its allowed path (P2)

**Goal**: five use cases on one compare-and-set state machine, audited and evented in the caller's transaction. Placed before US2 because US1's approval and US4 depend on it.
**Independent test**: drive every ordered pair of file statuses and two concurrent transitions on a real database.

- [ ] T011 [US3] Write the failing `libs/domain/src/garages/verification.service.integration.spec.ts` (new): the 9 allowed transitions; every other ordered pair is 409 `verification_transition_refused` naming status and first name; second `open` of an `in_review` file succeeds unchanged with no audit or outbox row; a reopen of an older file, or while another file is live, is refused; one audit entry and one outbox row per commit and none after a thrown transaction; two concurrent `decide` or `submit` calls end with one commit; `previousFileId` after a rejection; an approved garage stays `approved` after a reopened file's rejection or "more requested"; a non-`admin`/`system` actor on `decide`/`open`/`reopen` gets 404 (SC-002, SC-003)
- [ ] T012 [US3] Implement `VerificationService` (`submit`, `open`, `decide`, `resend`, `reopen`, each taking the caller's `tx`) in `libs/domain/src/garages/verification.service.ts` (new): `FROM: Record<Transition, Status[]>` fed to `updateMany`'s `status: { in }`; `decide` to `approved` sets garage `approved` and `approvedAt`; audit and outbox rows with audiences `admin`, `garage:{garageId}` (plus the `published` ones on approval); reason code and note required for `more_requested` and `rejected`; `requireCapability(actor, 'admin.garages')`
- [ ] T013 [US3] Wire `VerificationService` with `AUDIT_PORT` and `EVENT_PORT` in `libs/domain/src/garages/garages.module.ts` and export it from `libs/domain/src/index.ts`

## Phase 5: User Story 2 - The garage sees where its file stands (P2)

**Goal**: one derived label per state in both languages, never stored.
**Independent test**: the unit spec of T005 over every state pair (SC-006); nothing further than T005's contracts code is owed here.

- [ ] T014 [US2] Confirm `libs/contracts/src/garage-status.spec.ts` passes against the T005 implementation and that no status column or label is stored in `libs/domain/prisma/schema/garages.prisma` (FR-006)

## Phase 6: User Story 4 - A test environment approves at once (P3)

**Goal**: `skip_manual_approval` approves a submission as `system`, only under `APP_ENV=test`.
**Independent test**: submit under each `APP_ENV` with the switch on.

- [ ] T015 [P] [US4] Write the failing `libs/domain/src/garages/verification-config.spec.ts` (new): `1`/`true` under `test` is on; `yes`, `0`, unset are off; on under `development`, `staging`, `production` is ignored; then implement `verificationConfig(appEnv, source)` in `libs/domain/src/garages/verification-config.ts` (new)
- [ ] T016 [US4] Add the switch cases to `libs/domain/src/garages/verification.service.integration.spec.ts` (submit approves as `system` "MotorFix" with the audit entries and outbox rows of both transitions under `test`; ignored elsewhere), then make `submit` call `decide` as `system` in the same transaction in `libs/domain/src/garages/verification.service.ts`
- [ ] T017 [US4] Provide `VERIFICATION_CONFIG` in `GaragesModule.register(email, notifications, verificationConfig(env.APP_ENV, process.env))` in `apps/api/src/app.module.ts`; the variable stays optional (no required env entry)

## Phase 7: Polish

- [ ] T018 Run typecheck, lint and the specs of `contracts`, `domain`, `api`, `data-access` under `scripts/heavy.sh`; confirm `apps/api/openapi.json` and the generated client are committed in step (FR-011)

## Dependencies

T001 → T002 → everything. T003, T004, T005 parallel after T002. US1 (T006-T010) needs T005. US3 (T011-T013) needs T003, T004; US1's approval cases in T006 use `VerificationService`, so T009-T010 can precede T012 but T006's approval case turns green only after T013. US4 needs T012. T018 last.

## Parallel examples

- After T002: T003, T004, T005 together.
- US1 specs T006, T007, T008 together.

## Strategy

MVP is US1 plus US3 (the scope and the machine that approves): T001-T013. Then US4's switch, then the polish run. Every spec is written and seen red before its implementation task.

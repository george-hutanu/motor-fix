# Tasks: Store each file's checks and their results

**Input**: `specs/300-verification-checks/` — plan.md, spec.md, research.md, data-model.md, contracts/verification-checks.md, quickstart.md
**Tests**: required (Constitution II, red first): Jest colocated in `libs/contracts`, `libs/domain` (integration, real PostgreSQL) and `apps/api`. No screen, so no Playwright.

## Phase 1: Setup

- [X] T001 Add the Prisma schema in `libs/domain/prisma/schema/garages.prisma`: enums `VerificationCheckKind` (company, caen, rar, activities, representative, address, photos, documents) and `VerificationCheckResult` (not_run, ok, warning, failed), models `VerificationCheck` (unique on file and kind, detail max 200, automatic default false, recorded_by, recorded_at) and `RarActivity` (code, name_ro, name_en), `Garage.rarActivities String[]`, `VerificationFile.checks`; add the hand-written `libs/domain/prisma/migrations/20261007140000_verification_check/migration.sql` (new) with the enums, tables, column, the five seeded activities (mechanics, brakes, steering, suspension, air_con), `CHECK (char_length(detail) <= 200)` and the back-fill of 8 `not_run` rows per existing file; regenerate the Prisma client — FR-002, FR-005

## Phase 2: Tests first (red)

- [X] T002 [P] [US3] Write `libs/contracts/src/verification-checks.spec.ts` (new): `lamp` maps ok/warning/failed/not_run to green/amber/red/grey; `checkSummary` returns the four Build-brief texts in Romanian and English ("CUI și autorizație RAR verificate", "Lipsește autorizația RAR", "CUI verificat · fotografii neclare", "Neverificat"), the capital, `failed` before `warning`, `rar` before other kinds, then the kinds' order — FR-008, FR-009
- [X] T003 [P] [US1] Extend `libs/domain/src/garages/verification.service.integration.spec.ts`: a submit leaves exactly 8 checks, one per kind, `not_run`, `automatic = false`, no audit entry per row; a resend after `rar = ok` and more requested keeps 8 with `rar` still `ok` and its detail, no duplicate — FR-001, FR-002, FR-006, SC-001
- [X] T004 [P] [US2] Write `libs/domain/src/garages/verification-checks.service.integration.spec.ts` (new): record `rar = ok` sets result, detail, `recorded_by`, `recorded_at`, writes one audit entry with old `not_run` and new `ok`, and one `verification.check_recorded` outbox event (fileId, kind, result); a thrown failure leaves none of the three; `activities = ok` with `mechanics`, `brakes` writes `garage.rar_activities` in the same save, an omitted list on a non-`ok` result leaves it unchanged; the last save wins and both saves are audited with the other's value as old; the returned body carries both summaries; a decided file (approved, rejected, more requested) gives 409 "Dosarul e deja decis" and a reopened one is accepted; an unknown kind 422; a `warning` or `failed` without detail, a detail over 200 characters, an unknown activity code, an activities list on another kind or a missing list on `activities = ok` give 400 `validation_failed`; an unknown file 404 — FR-003, FR-004, FR-006, FR-007, FR-010, SC-002, SC-004
- [X] T005 [P] [US2] Write `apps/api/src/verification-checks.api.integration.spec.ts` (new): `PUT /api/v1/admin/verification-files/:id/checks/:kind` as an admin answers 200 with the check and both summaries, 400, 409 and 422 as above; a signed-in non-admin and a missing file get 404; add the route to `KNOWN` in `apps/api/src/admin-routes.integration.spec.ts` — FR-010, FR-011, SC-004

## Phase 3: User Story 3 — Lamp and summary (P2)

- [X] T006 [US3] Implement `libs/contracts/src/verification-checks.ts` (new): `VERIFICATION_CHECK_KINDS`, `VERIFICATION_CHECK_RESULTS`, `lamp()`, `checkSummary()` (Romanian and English, no Node import), `RecordVerificationCheckDto` (detail max 200, activities list), `VerificationCheckDto`, `VerificationCheckRecordedDto`; export it from `libs/contracts/src/index.ts` — FR-008, FR-009, FR-010

## Phase 4: User Story 1 — The checks exist at submission (P1)

- [X] T007 [US1] In `libs/domain/src/garages/verification.service.ts`, make `submit()` and `resend()` create the 8 rows with one `createMany` with `skipDuplicates` inside the caller's transaction, before the event is announced — FR-001, FR-002

## Phase 5: User Story 2 — An admin records a result (P1)

- [X] T008 [US2] Implement `VerificationChecksService.record(tx, actor, fileId, kind, body)` in `libs/domain/src/garages/verification-checks.service.ts` (new): lock the check row, refuse a decided file (409 "Dosarul e deja decis"), unknown kind (422) and invalid bodies (400 `validation_failed`), update result, detail, `recorded_by`, `recorded_at`, write `activities` to `garage.rar_activities` after validating codes against `rar_activity`, write one audit entry with old and new values and emit `verification.check_recorded` to the `platform` audience, all in one transaction; return the check with both summaries — FR-003, FR-004, FR-006, FR-007, FR-010
- [X] T009 [US2] Add `VerificationChecksController` (`PUT admin/verification-files/:id/checks/:kind`, `@Requires('admin.garages')`, 404 to non-admins) in `libs/domain/src/garages/verification-checks.controller.ts` (new) and register it and the service in `libs/domain/src/garages/garages.module.ts` — FR-011
- [X] T010 Regenerate `apps/api/openapi.json` and the client with `npx nx run data-access:generate` (never edit `libs/data-access` by hand) and pass `scripts/contract-check.sh` — FR-010

## Dependencies & order

T001 → T002–T005 (red, parallel) → T006 → T007 → T008 → T009 → T010. T002–T005 must fail before T006–T009.
MVP: T001–T009 (the store and the write path); T010 closes the contract.

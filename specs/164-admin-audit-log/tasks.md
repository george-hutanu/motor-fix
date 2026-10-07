# Tasks: Admin actions in the audit history

**Input**: `specs/164-admin-audit-log/` (spec.md, plan.md, research.md, data-model.md, contracts/admin-audit-entries.md, quickstart.md)

**Tests**: Requested (FR-007) and written first: every spec below is red before the code that turns it green. No ids of requirements or tasks go in source code.

**Format**: `- [ ] T### [P?] [US?] Description with file path`. No new dependency, table, migration, DTO, endpoint or client regeneration, so there is no Setup or Foundational phase.

## Phase 1: Red specs (written before any source change)

**Goal**: the entries and the guard are specified and fail for the right reason.

- [ ] T001 [P] [US1] (FR-001, FR-002, FR-007) In `libs/domain/src/events/live.api.integration.spec.ts` add cases: a successful `POST /admin/live/test` leaves one `activity_log` row with `actor_id` the admin, `actor_role` `admin`, `actor_name` the admin's first name, action `create`, `subject_type` `account`, `subject_id` the target, kind `live.test`, no old value, new value `{ "accountId": … }`, `via_assistant` false, and the row commits with its `outbox_event`; a 404 (unknown target) and a 400 (bad body) leave none.
- [ ] T002 [P] [US1] (FR-001, FR-003, FR-007) In `libs/domain/src/notifications/notifications.service.integration.spec.ts` add cases: `sendTestMessage(actor, accountIds)` writes one `create` entry (kind `notification.test`, subject the admin's account, new value `{ "accountIds": [...] }`) before any `notification` row exists; a failing send keeps the entry; a failing entry queues nothing.
- [ ] T003 [P] [US1] (FR-003, FR-006, FR-007) In `libs/domain/src/notifications/notifications.api.integration.spec.ts` add cases: `POST /admin/notifications/test` answers 202 `{ queued }` and leaves the entry with the fields above, readable by an admin in `GET /audit-history` area `admin_actions`; a 400 `unknown_recipient` leaves none.
- [ ] T004 [US2] (FR-001, FR-004, FR-007) Create `apps/api/src/admin-audit.integration.spec.ts` (new): boot with `apiBoot()`, read every `admin/*` route and method from the OpenAPI document, keep a fixture table keyed `METHOD /api/v1/admin/<path>` (known-good bodies for `POST /admin/live/test`, `POST /admin/notifications/test`, `POST /admin/news`), call each changing route once, one at a time, as a seeded admin, and fail one case titled with the route when the answer is not 2xx (with its status), when the admin's `activity_log` count did not grow across that call, or when the table has no row for it. Count with the `pg` client as `apps/api/src/admin-routes.integration.spec.ts` does.
- [ ] T005 [US3] (FR-004) In `apps/api/src/admin-audit.integration.spec.ts` add the read half: every `GET` `admin/*` route (today `GET /admin/overview`) is called as the admin and the admin's entry count is unchanged; a table row may mark a logged read with an expected delta of 1.

**Checkpoint**: run the four spec files; T001 to T004 fail on the missing entries, T005 passes.

## Phase 2: User Story 1 - Every admin change leaves a trace (P1) MVP

**Goal**: both missing entries are written by the calling admin, in the transaction the plan names.

**Independent test**: T001 to T003 and the guard's changing-route cases (T004) go green.

- [ ] T006 [US1] (FR-002) In `libs/domain/src/events/events.module.ts` add the provider `{ provide: AUDIT_PORT, useClass: AuditService }`, as the other modules carry it.
- [ ] T007 [US1] (FR-001, FR-002) In `libs/domain/src/events/live.controller.ts` add `@CurrentActor() actor` and `@Inject(AUDIT_PORT) audit` to `test()` and one `audit.record` call inside the existing transaction (action `create`, subject `account`/target, kind `live.test`, new value the validated body, no old value).
- [ ] T008 [US1] (FR-001, FR-003) In `libs/domain/src/notifications/notifications.service.ts` change `sendTestMessage` to take the actor, and write one `audit.record` (action `create`, subject the admin's account, kind `notification.test`, new value `{ accountIds }`) in a transaction of its own after the recipient check (so a 400 `unknown_recipient` writes nothing) and before the per-account loop.
- [ ] T009 [US1] (FR-003) In `libs/domain/src/notifications/notifications.controller.ts` add `@CurrentActor() actor` and pass it to `sendTestMessage`.

**Checkpoint**: T001 to T004 are green; US1 is demonstrable on its own.

## Phase 3: User Story 2 and 3 - Guard and reads

**Goal**: nothing further to build: the guard (T004) and the read assertion (T005) are the deliverable of these stories.

- [ ] T010 [US2] (FR-004) Prove the guard by hand once: temporarily drop the `audit.record` call in `libs/domain/src/events/live.controller.ts`, confirm `apps/api/src/admin-audit.integration.spec.ts` fails naming `POST /api/v1/admin/live/test`, then restore it and confirm green (nothing from this step is committed).

## Phase 4: Polish

- [ ] T011 (FR-005, FR-007) Run `npx nx run-many -t typecheck,lint -p api,domain`, the existing verification and audit specs unchanged (`libs/domain/src/garages/verification*.spec.ts`, `libs/domain/src/audit/*.spec.ts`: ST-207's entries and rollback stay green), and the touched specs through `scripts/heavy.sh` (`npx nx test domain` and `npx nx test api`); confirm `apps/api/openapi.json` is unchanged and `quickstart.md`'s steps hold.

## Dependencies

- Phase 1 first: T001, T002, T003 are parallel (three files); T004 then T005 (same file).
- Phase 2 after Phase 1: T006 before T007; T008 before T009; T007 and T008 are independent of each other.
- T010 after T007; T011 last.

## Parallel example

T001, T002, T003 together; then T007 with T008.

## Implementation strategy

MVP is US1 (T001 to T003, T006 to T009). The guard (T004, T005) is written red in the same first pass so the entries land under it; T010 and T011 close the story.

## Counts

11 tasks: US1 7 (T001 to T003, T006 to T009), US2 2 (T004, T010), US3 1 (T005), Polish 1 (T011).

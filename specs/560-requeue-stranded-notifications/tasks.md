# Tasks: A queued notification with no job is re-queued

**Input**: `specs/560-requeue-stranded-notifications/` (plan.md, spec.md)
**Tests**: integration specs on real PostgreSQL and Redis, written first and red (Constitution II).
**Format**: `[ID] [P?] [Story] Description`. All paths are under `libs/domain/src/notifications/`.

## Phase 1: Tests first (red)

- [X] T001 [P] [US1] [US2] [US3] Write `requeue.integration.spec.ts` (new, own Redis db via `redisUrlFor`): `requeueStranded()` adds `send-<id>` for a stale `queued` row and returns the count; (FR-001, FR-002) leaves a row whose job exists (FR-003), a young row, a row with `claimedAt` (live and lapsed) (FR-004), an SMS row with `sendingAt` (FR-005), and `held`, `sent`, `failed` rows (FR-007); re-queues one row per channel (email, push, SMS, WhatsApp); a failing queue add or read logs and returns without touching rows (FR-008); the log names the ids (FR-009); `getJobSchedulers()` shows the `requeue` scheduler after the module's upsert.
- [X] T002 [P] [US2] Extend `send-claim.adversary.integration.spec.ts`: the provider accepts and every mark-sent write fails (`failWritesAfter`) -> the job resolves, the row keeps `claimedAt` (FR-006), and `requeueStranded()` adds nothing for it.
- [X] T003 [P] [US1] Extend `notifications.processor.integration.spec.ts`: `handle` of a `requeue` job reaches `requeueStranded()`; adjust any existing expectation of a released claim after an unrecorded send.

## Phase 2: Implementation

- [X] T004 [US1] [US2] [US3] In `notifications.service.ts` add a private `STRANDED_MS` (5 minutes), public `requeueStranded(now)` and `scheduleRequeue()` (`upsertJobScheduler('requeue', { every: STRANDED_MS })`, completed jobs removed): select queued rows with `claimedAt` null, `sendingAt` null, `createdAt` older than `STRANDED_MS`, add each through `queue(send(id))`, warn and end on a failed read or add, warn with the ids when the count is above zero, return the count.
- [X] T005 [US2] In `notifications.processor.ts` route the `requeue` job in `handle` to the service; make `sent()` answer whether it recorded, track unrecorded row ids, and skip the claim release in `send()`'s `finally` for such a row.
- [X] T006 [US1] In `notifications.module.ts` inject `NotificationsService` into the `WORKER` factory and call `scheduleRequeue()` before the worker is built, logging a failure and still returning the worker.

## Phase 3: Verify

- [X] T007 Run `npx nx test domain --testPathPattern 'notifications/(requeue|notifications.processor|send-claim|phone|push)'` under `scripts/heavy.sh` (`docker compose up -d`), then typecheck and Biome for `domain`; every spec green (SC-001..SC-003); `git diff --stat origin/main` shows nothing under `libs/contracts`, `libs/domain/prisma`, `apps/api` or `apps/web` (FR-010, SC-004).

## Dependencies

T001-T003 (parallel, red) -> T004 -> T005 -> T006 -> T007. T004..T006 touch different files but T005/T006 use what T004 adds, so they run in order.
MVP: all of it; one story set, three source files.

# Tasks: A queued notification with no job is re-queued

**Input**: `specs/560-requeue-stranded-notifications/` (plan.md, spec.md)
**Tests**: integration specs on real PostgreSQL and Redis, written first and red (Constitution II).
**Format**: `[ID] [P?] [Story] Description`. All paths are under `libs/domain/src/notifications/`.

## Phase 1: Tests first (red)

- [ ] T001 [P] [US1] [US2] [US3] Write `requeue.integration.spec.ts` (new, own Redis db via `redisUrlFor`): `requeueStranded()` adds `send-<id>` for a stale `queued` row and returns the count; leaves a row whose job exists, a young row, a row with `claimedAt` (live and lapsed), an SMS row with `sendingAt`, and `held`, `sent`, `failed` rows; re-queues one row per channel (email, push, SMS, WhatsApp); a failing queue add or read logs and returns without touching rows; the log names the ids; `getJobSchedulers()` shows the `requeue` scheduler after the module's upsert.
- [ ] T002 [P] [US2] Extend `send-claim.adversary.integration.spec.ts`: the provider accepts and every mark-sent write fails (`failWritesAfter`) -> the job resolves, the row keeps `claimedAt`, and `requeueStranded()` adds nothing for it.
- [ ] T003 [P] [US1] Extend `notifications.processor.integration.spec.ts`: `handle` of a `requeue` job reaches `requeueStranded()`; adjust any existing expectation of a released claim after an unrecorded send.

## Phase 2: Implementation

- [ ] T004 [US1] [US2] [US3] In `notifications.service.ts` add exported `STALE_MS` (5 minutes) and public `requeueStranded(now)`: select queued rows with `claimedAt` null, `sendingAt` null, `createdAt` older than `STALE_MS`, add each through `queue(send(id))`, warn and end on a failed read or add, warn with the ids when the count is above zero, return the count.
- [ ] T005 [US2] In `notifications.processor.ts` route the `requeue` job in `handle` to the service; make `sent()` answer whether it recorded, track unrecorded row ids, and skip the claim release in `send()`'s `finally` for such a row.
- [ ] T006 [US1] In `notifications.module.ts` inject `NOTIFICATIONS_JOBS` into the `WORKER` factory and `upsertJobScheduler('requeue', { every: STALE_MS }, { name: 'requeue' })` after the worker is built, inside try/catch that logs and still returns the worker.

## Phase 3: Verify

- [ ] T007 Run `npx nx test domain --testPathPattern 'notifications/(requeue|notifications.processor|send-claim|phone|push)'` under `scripts/heavy.sh` (`docker compose up -d`), then typecheck and Biome for `domain`; every spec green (SC-001..SC-003).

## Dependencies

T001-T003 (parallel, red) -> T004 -> T005 -> T006 -> T007. T004..T006 touch different files but T005/T006 import what T004 exports, so they run in order.
MVP: all of it; one story set, three source files.

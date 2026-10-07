# Implementation Plan: A queued notification with no job is re-queued

**Branch**: `560-requeue-stranded-notifications` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/560-requeue-stranded-notifications/spec.md`

## Summary

The worker runs a BullMQ job scheduler on the `notifications` queue every 5 minutes (`requeue`). Its job calls a new `NotificationsService.requeueStranded()`, which finds `queued` rows older than 5 minutes that carry no send claim and no SMS sending mark and adds each one's `send-<id>` job through the service's existing `queue()` (same `JOB` options, no delay); BullMQ ignores an id that already exists, so a live job is never doubled (FR-001..005, FR-007). The processor keeps a row's claim when the provider took the message and the mark-sent write never landed, so the sweep leaves that row alone (FR-006). No schema, contract, route or screen changes (FR-010).

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`, `package-lock.json` `node_modules/typescript`), target `es2023`, module `esnext` (`tsconfig.base.json:9,38`); Node `>=24.0.0` (`package.json` engines), v26.5.0 on this machine.

**Primary Dependencies**: `@nestjs/common` 12.1.2, `bullmq` 6.3.11, `ioredis` 6.0.0, `prisma`/`@prisma/client` 7.10.0 (`package-lock.json`). `Queue.upsertJobScheduler(id, { every }, { name })` is the installed API (`node_modules/bullmq/dist/esm/classes/queue.d.ts:205`); `removeOnFail: number` keeps that many failed jobs (`node_modules/bullmq/dist/esm/interfaces/base-job-options.d.ts:66`). No new dependency.

**Storage**: PostgreSQL through Prisma, table `notification` (`libs/domain/prisma/schema/notifications.prisma`): `status`, `claimedAt` (`claimed_at`), `sendingAt` (`sending_at`), `createdAt` (`created_at`) already exist; no migration. Redis holds the queue only; the row stays the truth (Principle VI).

**Testing**: Jest 30.5.2 from the root preset (`jest.preset.cjs`; `libs/domain/jest.config.cjs`, ts-jest, `testEnvironment: node`). Specs that need PostgreSQL and Redis are `*.integration.spec.ts`, colocated; each file takes its own Redis database (`redisUrlFor(n)`, `libs/domain/src/notifications/notifications.testing.ts`) and `serialDatabase(databaseUrl)`. Fixtures: `fixtures()`, `testConfig`, `testPhoneConfig`, `failWritesAfter` (same file), `BrevoMock` (`brevo-mock.testing.ts`).

**Target Platform**: the `worker` Nx app (NestJS, Node), where `NotificationsModule.registerWorker` builds the queue's `Worker` (`libs/domain/src/notifications/notifications.module.ts:154-175`). The API process (`register`) gets no scheduler.

**Project Type**: Nx monorepo lib `domain`, module `notifications`.

**Performance Goals**: SC-001: a stranded row is sent within one interval plus the window (10 minutes at the defaults). One `findMany` and one queue `add` per stranded row per pass; a pass with nothing stranded is one indexed-less scan of `queued` rows, which are few (a row leaves `queued` within minutes).

**Constraints** (`context.md` › Constraints): the module is `notifications`, worker queues `notifications`, `reminders`, `sms-counter`; timed work runs on the worker's scheduler (A9: BullMQ, "retries and schedules built in"). Messages must not be sent twice (Final rules 13): a duplicate would also start the fallback chain twice. Always-sent types must not be lost (Final rules 6). "Within a minute" (Acceptance criteria) is the normal path; the recovery path is SC-001. No schema, contract or dependency change; nothing under `libs/contracts`, `libs/domain/prisma`, `apps/api`, `apps/web` (SC-004). The 5-minute window and interval are the spec's autonomous defaults (not in Notion), the same value as `SWEEP_EVERY` in `libs/domain/src/scheduler/timers.ts:12` and `WINDOW_MS` in `notifications.service.ts:35`.

**Scale/Scope**: three source files in `libs/domain/src/notifications/`, two or three spec files; no cap on rows per pass (spec Assumptions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat**: one public service method, one job name in the processor's `handle`, one scheduler upsert in the worker factory, one boolean out of `sent()`. The add reuses `queue()` and `JOB`; no new class, port, option or config. No research.md, data-model.md, contracts or quickstart: nothing in them would go beyond this file (as in `specs/778-mark-sent-retry-no-delay`).
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing integration specs first, colocated, on real PostgreSQL and Redis; the sweep is unit-free by nature (it is a query plus a queue add). No FR id in source.
- [x] **III. The Given Stack**: NestJS, PostgreSQL, Redis, BullMQ already in the module.
- [x] **IV. One Repository, One Toolchain**: `domain` lib, `worker` app; Biome, root Jest.
- [x] **V. Rules Live in One Place**: the sweep lives in `NotificationsService` next to the add it repeats; the claim rule stays in the processor.
- [x] **VI. PostgreSQL Is the Truth**: the sweep reads rows and adds jobs; it writes nothing to the row (FR-008). The claim, kept on an unrecorded send, is a row field. No outbox event: nothing changes state.
- [x] **Notion choices**: A9 (BullMQ in a separate worker) and A37 (held rows handled once, in the worker) are the cited Architecture decisions; no To-decide item is touched.

Post-design re-check: unchanged. The one judgement call, a per-row `Set` in the processor to carry "unrecorded" from `sent()` to `send()`'s `finally`, is weighed below and kept.

## Design

### `libs/domain/src/notifications/notifications.service.ts`

- `STALE_MS = 5 * 60_000` next to `WINDOW_MS` (same value, different meaning: keep both names).
- `async requeueStranded(now = this.now()): Promise<number>`, public, after `release`:
  1. `findMany({ select: { id: true }, where: { claimedAt: null, createdAt: { lt: new Date(now.getTime() - STALE_MS) }, sendingAt: null, status: 'queued' }, orderBy: { createdAt: 'asc' } })` (FR-002, FR-004, FR-005, FR-007).
  2. For each id, `await this.queue(send(id))`: name `send`, `jobId` `send-<id>`, `delay: 0`, `...JOB` (FR-001). BullMQ ignores an add whose id exists in wait, delayed, active, prioritized or the kept-failed set (FR-003; the Clarifications settle the kept-failed case: no removal).
  3. A rejected add: `logger.warn(`stranded notifications not re-queued after ${n}: ${String(error)}`)` and return `n` (FR-008); nothing on the row changes.
  4. When `n > 0`: `logger.warn(`re-queued ${n} stranded notification(s): ${ids.join(', ')}`)` (FR-009). Return `n`.
- No change to `notify`, `fallBack` or `queue`.

### `libs/domain/src/notifications/notifications.processor.ts`

- `handle`: `if (job.name === 'requeue') return this.service.requeueStranded().then(() => undefined)` before the `send` branch. The job's `attemptsMade` and `data` are unused (the scheduler's template carries no data).
- `sent(rows, messageId)` answers `Promise<boolean>`: `true` when the transaction landed, `false` after the last failed try (the existing error line stays). Callers (`deliver`, `sendPush`, `sendSms`, `sendWhatsApp`) are reached from `send()` through `sendEmail` / `sendPush` / `sendPhone`, and from `flush` (no claim).
- `send(id, attemptsMade)`: a private `unrecorded = new Set<string>()` on the processor; `sent()` adds every row id it could not record. In `send()`'s `finally`, `if (this.unrecorded.delete(id)) return;` before the claim release: the claim stays, FR-004 keeps the sweep off, and 522-FR-003 (a *failed* release is logged and lapses) is untouched (FR-006). The Set is the smallest carrier: `sent()` has four callers and several `return`s between them and the `finally`, so threading a return value through `sendEmail`, `write`, `deliver`, `sendPhone`, `sendSms`, `sendWhatsApp` and `sendPush` would touch seven signatures for one bit. The Set is bounded by the concurrency (10) and emptied on the read.
- Simpler alternative rejected: skipping the release when `row.status` reads `sent` after the send is wrong, because the unrecorded case is exactly the one where the row still reads `queued`.

### `libs/domain/src/notifications/notifications.module.ts`

- In the `WORKER` factory, when `processor.ready()` holds: build the `Worker` as today, then `await queue.upsertJobScheduler('requeue', { every: STALE_MS }, { name: 'requeue' })` on the injected `NOTIFICATIONS_JOBS` `Queue` (add `NOTIFICATIONS_JOBS` to `inject`), inside `try/catch`: a rejection logs `new Logger('Notifications').error(`stranded-notification sweep not scheduled: ${String(error)}`)` and the factory still returns the worker (spec Edge Cases; `NEWS_WORKER`'s logged-and-continue factory in the same file is the local pattern; `ObjectTimers.startSweep` in `scheduler/timers.ts:48` is the upsert pattern). The API's `register` adds nothing.
- The scheduler's template passes no `opts`: `JOB`'s attempts and backoff are for send jobs; a failed pass is retried by the next tick, not by attempts. `STALE_MS` is exported from `notifications.service.ts` and imported by the module (one constant, one place).

### Tests (written by `/speckit-tests`, all integration, colocated)

- `libs/domain/src/notifications/requeue.integration.spec.ts` (new, own Redis db, pattern: `send-claim.adversary.integration.spec.ts`): a `queued` row older than the window with no job → `send-<id>` is in the queue after `requeueStranded()` and the count is 1 (US1-1); a row whose job exists (`queue.add` beforehand, `getJob` keeps the same job) → count 0 / job unchanged (US1-2); a young row → 0 (US1-3); one row per channel → 4 added (US1-4); a row with `claimedAt` set (live and lapsed), an SMS row with `sendingAt`, a `held` row, a `sent` and a `failed` row → 0 (US2-1, US2-2, US3-1, US3-2, SC-002); the queue closed or a failing `jobs.add` → the warning, `0`, rows untouched (FR-008); the log line names the ids (FR-009).
- `notifications.processor.integration.spec.ts` (or `send-claim.adversary.integration.spec.ts`, which already uses `failWritesAfter`): the provider accepts and all 3 mark-sent writes fail → the job resolves and the row keeps `claimedAt` (US2-3, FR-006); then `requeueStranded()` adds nothing for it.
- `notifications.module` wiring: `handle({ name: 'requeue', data: {}, attemptsMade: 0 })` reaches the service (a processor spec case); the upsert itself is verified by `queue.getJobSchedulers()` in the requeue spec on a `Queue` the test owns, since `registerWorker` boots Brevo and the key check (no Nest boot in the test).
- SC-003: the existing notifications, phone, push and send-claim suites pass unchanged apart from the FR-006 expectation (a claim that is now kept).

## Project Structure

### Documentation (this feature)

```text
specs/560-requeue-stranded-notifications/
├── plan.md              # This file
├── spec.md
├── context.md
├── design.md            # no screens
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

No research.md, data-model.md, contracts/ or quickstart.md: no unknown remained in Technical Context, no entity or interface changes, and the validation steps are the specs named above (`npx nx test domain --testPathPattern 'notifications/(requeue|notifications.processor|send-claim)'` under `scripts/heavy.sh`, with `docker compose up -d`).

### Source Code (repository root)

```text
libs/domain/src/notifications/
├── notifications.service.ts                      # + STALE_MS, requeueStranded()
├── notifications.processor.ts                    # + requeue job, sent() answers, claim kept when unrecorded
├── notifications.module.ts                       # + upsertJobScheduler('requeue') in the worker factory
├── requeue.integration.spec.ts                   # (new) the sweep's cases
├── notifications.processor.integration.spec.ts   # + requeue job routing
└── send-claim.adversary.integration.spec.ts      # + claim kept after an unrecorded send
```

**Structure Decision**: everything stays in the `notifications` module of the `domain` lib, where the add it repeats and the claim it guards already live; the worker app changes nothing (its `registerWorker` call is the entry point).

## Complexity Tracking

No constitution violation. The processor's `unrecorded` Set is the one addition that could look like state for state's sake; it is justified in Design (one bit across seven call frames) and is removed on read.

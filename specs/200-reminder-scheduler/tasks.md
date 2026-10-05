# Tasks: Set up the scheduler for timed reminders

**Input**: spec.md, plan.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 Prisma: `libs/domain/prisma/schema/cars.prisma` (new) `ReminderKind` and `Reminder`, `Account.reminders` in `auth.prisma`; migration `libs/domain/prisma/migrations/20261005160000_reminders/migration.sql` with one row per car and kind, one per booking, and a check that a reminder is about a car or a booking; regenerate the client (FR-001)

## Phase 2: Foundational

- [X] T002 `libs/domain/src/bucharest.ts` (new): local reading, `atLocal`, `addDays`, `daysBetween`; `notifications/quiet-hours.ts` uses it (FR-007)
- [X] T003 `libs/domain/src/scheduler/daily.ts` (new): `bucharestDaily`, `shortenedDaily`, `nextRun`, `runDue` (FR-007, FR-008, FR-011)

## Phase 3: User Story 1 — 30 and 7 days, once each (P1)

- [X] T004 [US1] `libs/domain/src/cars/reminders.ts` (new) `dueStage` for the 30/7 kinds (FR-002)
- [X] T005 [US1] `libs/domain/src/cars/reminders.service.ts` (new): `setCarDue`, `removeCar`, `run(day)` through `NotificationsService.notify` (FR-002, FR-005, FR-006)

## Phase 4: User Story 2 — local time, catch-up, retries (P1)

- [X] T006 [US2] `libs/domain/src/cars/reminders.module.ts` (new): the `reminders` queue and worker, the start-up schedule, retries and the failure log; `notifications.module.ts` exports; `apps/worker/src/main.ts` (FR-007, FR-008, FR-009)

## Phase 5: User Story 3 — booking and tyres (P2)

- [X] T007 [US3] `dueStage` for tyres and bookings; `setTyres`, `setBooking`, `cancelBooking` in `reminders.service.ts` (FR-003, FR-004, FR-006)

## Phase 6: User Story 4 — timers and sweep (P2)

- [X] T008 [US4] `libs/domain/src/scheduler/timers.ts` (new) `ObjectTimers` (FR-010)

## Phase 7: User Story 5 — shortened dates (P3)

- [X] T009 [US5] `libs/domain/src/cars/reminders-config.ts` (new) `reminderDayMs`; the module uses `shortenedDaily` when it is set; `libs/domain/src/index.ts` exports (FR-011)

## FR → test

| FR | Test |
| --- | --- |
| FR-001 | `cars/reminders.service.integration.spec.ts` (rows and uniqueness) |
| FR-002 | `cars/reminders.spec.ts`, `cars/reminders.service.integration.spec.ts` |
| FR-003 | `cars/reminders.spec.ts`, `cars/reminders.service.integration.spec.ts` |
| FR-004 | `cars/reminders.spec.ts`, `cars/reminders.service.integration.spec.ts` |
| FR-005 | `cars/reminders.service.integration.spec.ts` (concurrent runs, 23:15 held) |
| FR-006 | `cars/reminders.service.integration.spec.ts` |
| FR-007 | `scheduler/daily.spec.ts`, `cars/reminders.worker.integration.spec.ts` |
| FR-008 | `scheduler/daily.spec.ts`, `cars/reminders.worker.integration.spec.ts` |
| FR-009 | `cars/reminders.worker.integration.spec.ts` |
| FR-010 | `scheduler/timers.integration.spec.ts` |
| FR-011 | `cars/reminders-config.spec.ts`, `scheduler/daily.spec.ts`, `cars/reminders.worker.integration.spec.ts` |

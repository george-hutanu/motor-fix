# Implementation Plan: Set up the scheduler for timed reminders

**Branch**: `200-reminder-scheduler` | **Date**: 2026-10-05 | **Spec**: specs/200-reminder-scheduler/spec.md

## Summary

A `reminders` BullMQ queue in the worker runs one job a day at 09:00 Europe/Bucharest (job id `daily:<day>`), computed in local time; at start the worker runs a missed day at once. The run reads the REMINDER table and sends each due stage through `NotificationsService.notify` with an event id per reminder, stage and date, then sets the reminder's flag; the pipeline's one-message-per-event rule and its quiet hours do the rest. Registration hooks let later stories set and clear reminders. A small `ObjectTimers` class gives later queues stable-id timers and a sweep.

## Technical Context

- **Language/Version**: TypeScript (root `tsconfig.base.json`), Node 24, NestJS 12 (ESM-only; Jest with `--experimental-vm-modules`).
- **Primary Dependencies**: `bullmq` 6.3.11 and `ioredis` 6.0.0 (`package.json`), already used by the notifications queue; Prisma 7.10.0. No new dependency.
- **Storage**: PostgreSQL: migration `20261005150000_reminders` creates `reminder` (enum `reminder_kind`), with a foreign key to `account` (cascade) unique (car_id, kind) and unique booking_id, and a check that a row is about a car or a booking. Redis: the `reminders` queue.
- **Testing**: Jest from the root preset: unit specs for the local-time clock and the stage rule; `*.integration.spec.ts` for the run, the hooks, the timers and the worker against PostgreSQL and Redis (Redis databases 3 and 4).
- **Target Platform**: `apps/worker` (Railway).
- **Constraints**: Europe/Bucharest local time across 25 Oct 2026 and 28 Mar 2027; shortened days never in staging or production.

## Constitution Check

- **I. No bloated code**: one table, one queue, one run; only the `reminders` daily run is scheduled (the other runs have no job yet). The Bucharest local-time reading moves out of `quiet-hours.ts` into `libs/domain/src/bucharest.ts`, shared by both, rather than copied.
- **II. Tests first, real services**: every rule has a failing test first; the run, the hooks, the timers and the worker run against real PostgreSQL and Redis.
- **VII. Lifecycle**: draft PR #78, a push per commit, QA, merge on green.

## Project Structure

```
libs/domain/prisma/schema/cars.prisma                 (new) ReminderKind, Reminder
libs/domain/prisma/schema/auth.prisma                 Account.reminders
libs/domain/prisma/migrations/20261005150000_reminders/migration.sql (new)
libs/domain/src/bucharest.ts                          (new) local(), atLocal(), addDays(), daysBetween()
libs/domain/src/notifications/quiet-hours.ts          uses bucharest.ts
libs/domain/src/scheduler/daily.ts                    (new) DailyClock: bucharestDaily(), shortenedDaily(), nextRun(), runDue()
libs/domain/src/scheduler/timers.ts                   (new) ObjectTimers: set, clear, sweep
libs/domain/src/cars/reminders.ts                     (new) dueStage(): the stage rule
libs/domain/src/cars/reminders-config.ts              (new) reminderDayMs()
libs/domain/src/cars/reminders.service.ts             (new) hooks + run(day)
libs/domain/src/cars/reminders.module.ts              (new) queue, worker, start-up schedule
libs/domain/src/notifications/notifications.module.ts registerWorker exports NotificationsService and its Prisma
libs/domain/src/index.ts                              exports RemindersModule, reminderDayMs
apps/worker/src/main.ts                               imports RemindersModule
```

## Complexity Tracking

- `ObjectTimers` has no production caller in this story: the brief puts it in scope for the `quote-timers` and other queues, whose stories call it. Kept to set, clear and sweep, proved with a test kind.

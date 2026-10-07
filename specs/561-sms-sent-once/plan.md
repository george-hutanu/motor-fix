# Implementation Plan: An SMS that may have gone is never sent twice

**Branch**: `561-sms-sent-once` | **Spec**: [spec.md](./spec.md)

## Summary

A nullable `sending_at` column on `notification` (one migration). `NotificationsProcessor.sendSms()` sets it before taking the count and calling `brevo.sendSms` (FR-001); a row found already carrying it is failed `sms_unconfirmed` with fallback before any count or call (FR-002); a `provider_unreachable` error keeps the count and settles the row the same way (FR-003); any other refusal gives the count back, then clears the column and goes through `refused()` as today (FR-004).

## Technical Context

**Language/Version**: TypeScript, NestJS 12 · **Storage**: PostgreSQL via Prisma 7 (`libs/domain/prisma/schema/notifications.prisma`, migration `20261007130000_notification_sending`) · **Testing**: Jest integration specs on the worktree's PostgreSQL and Redis, Brevo mock (`hang` for a timeout) · **Project**: `libs/domain` (notifications) · **Constraints**: no new dependency; e-mail, WhatsApp and push unchanged.

## Constitution Check

I: one column and ~15 lines in `sendSms`; no new state machine or status value (a new `NotificationStatus` would touch every reader of the enum). II: tests first in `phone.processor.integration.spec.ts`. VI: the mark lives in PostgreSQL. Pass.

## Project Structure

- `libs/domain/prisma/schema/notifications.prisma`, `libs/domain/prisma/migrations/20261007130000_notification_sending/migration.sql`
- `libs/domain/src/notifications/notifications.processor.ts` — the fix
- `libs/domain/src/notifications/phone.processor.integration.spec.ts` — the tests

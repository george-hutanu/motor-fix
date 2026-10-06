# Implementation Plan: A message the provider accepted is never sent twice

**Branch**: `522-email-sent-once` | **Spec**: [spec.md](./spec.md)

## Summary

`NotificationsProcessor.sent()` retries its transaction up to 3 times and logs instead of throwing when all fail (FR-001, FR-002). The `finally` claim release in `send()` catches and logs (FR-003).

## Technical Context

**Language/Version**: TypeScript, NestJS 12 · **Storage**: PostgreSQL via Prisma · **Testing**: Jest integration specs against the worktree's PostgreSQL and Redis, Brevo mock (`brevo-mock.testing.ts`) · **Project**: `libs/domain` (notifications module) · **Constraints**: no schema change, no new dependency.

## Constitution Check

Principle I (simplest change): one loop in `sent()`, one try/catch in `send()`. Tests first (red-first gate). Pass.

## Project Structure

- `libs/domain/src/notifications/notifications.processor.ts` — the fix
- `libs/domain/src/notifications/sent-once.integration.spec.ts` — new tests

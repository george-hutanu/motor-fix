# Implementation Plan: The mark-sent write is retried without a delay

**Branch**: `778-mark-sent-retry-no-delay` | **Spec**: [spec.md](./spec.md)

## Summary

Drop the `setTimeout(200 * attempt)` from `sent()` in `libs/domain/src/notifications/notifications.processor.ts` (FR-001). Add a push case for a failed first mark-sent write to `push.processor.integration.spec.ts` (FR-002), and an e-mail case to `send-claim.adversary.integration.spec.ts` asserting the 3 tries run back to back.

## Technical Context

**Language/Version**: TypeScript · **Testing**: Jest integration specs on PostgreSQL and Redis · **Projects**: `domain` · **Constraints**: no schema, contract or dependency change.

## Constitution Check

Principle I: removes three lines. Principle II: the back-to-back test fails first (600 ms of waits today). Pass.

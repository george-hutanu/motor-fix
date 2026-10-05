# Tasks: Send a queued notification once when two send jobs run at once

**Input**: `specs/646-notification-send-claim/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `libs/domain/src/notifications/notifications.processor.integration.spec.ts` — two send jobs at once for a queued account e-mail call Brevo once; the row is sent (FR-001)
- [X] T002 [US1] Test: same file — two send jobs at once for a held row at its send time call Brevo once (FR-001)
- [X] T003 [US1] Test: same file — a row claimed within the lease: the job rejects, calls nobody, row stays queued (FR-002)
- [X] T004 [US1] Test: same file — a claim older than the lease is taken over and the row sent once (FR-003)
- [X] T005 [US1] Test: same file — a retryable Brevo refusal releases the claim; the next attempt sends at once; a held row grouped behind another holds no claim (FR-004)

## Phase 2: Implementation

- [X] T006 [US1] `libs/domain/prisma/schema/notifications.prisma` + migration: nullable `claimed_at` on `notification` (FR-001)
- [X] T007 [US1] `libs/domain/src/notifications/notifications.processor.ts`: `send()` claims the row before reading it, fails when another job holds it, releases its claim when it ends (FR-001–FR-004)

## Phase 3: Proof

- [X] T008 domain tests, `npm run typecheck` and `npm run lint` green (SC-001–SC-003)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | processor integration spec › T001, T002 |
| FR-002 | › T003 |
| FR-003 | › T004 |
| FR-004 | › T005 |

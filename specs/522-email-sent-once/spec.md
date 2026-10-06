# Feature Specification: A message the provider accepted is never sent twice

**Feature Branch**: `522-email-sent-once`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-522 (from ST-194): "a database error after Brevo accepted an e-mail makes the job retry and send a second e-mail" — https://app.notion.com/3ef607bff0d2810fb629cec5134fa890

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A driver gets one e-mail even when the database stumbles (Priority: P1)

Brevo accepts an e-mail, then the write that marks the row sent fails for a moment. Today the job throws, BullMQ retries it, and the driver gets the same e-mail again. After this change the processor retries the write in-process and, if it still fails, logs it and finishes the job without sending again.

**Independent Test**: make the first "mark sent" transaction fail after the Brevo mock accepted; run the send job; Brevo got one e-mail, the job resolved and the row reads `sent`.

**Acceptance Scenarios**:

1. **Given** a queued e-mail, **When** Brevo accepts it and the first write marking it sent fails, **Then** the job resolves, Brevo received one e-mail and the row is `sent` with its message id.
2. **Given** a queued e-mail, **When** Brevo accepts it and every write marking it sent fails, **Then** the job resolves (no retry, so no second e-mail) and an error naming the row and the message id is logged.
3. **Given** a queued SMS or WhatsApp message, **When** the provider accepts it and the first write fails, **Then** the same holds: one send, the job resolves.
4. **Given** a sent message, **When** releasing the send claim fails, **Then** the job resolves; the claim lapses on its own.

### Edge Cases

- A database error before the provider was called still fails the job, so the queue retries it as today (nothing was sent).
- A provider refusal still goes through the refusal path unchanged.
- Push records with no message id and follows the same rule.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Once the provider has accepted a message (e-mail, SMS, WhatsApp or push), a failure writing that it was sent MUST NOT fail the send job; the processor MUST retry the write in-process up to 3 times in all.
- **FR-002**: When every write of FR-001 fails, the processor MUST log an error naming the rows and the provider's message id, and the job MUST resolve, so the message is not sent again.
- **FR-003**: A failure releasing the send claim after a send MUST NOT fail the job; it is logged and the claim lapses after its window.

### Key Entities

- **Notification row**: `status`, `sentAt`, `providerMessageId`, `claimedAt` — unchanged schema.

## Clarifications

### Session 2026-10-07

- Q: Retry the write how many times? → A: 3 in all, no delay: a transient connection drop clears in-process, and a long outage is logged for the operator rather than turned into a resend. (autonomous)
- Q: Should a recording that never succeeds fall back to another channel? → A: No: the message was delivered to the provider; a fallback would be the duplicate this story removes. (autonomous)

## Assumptions

- A message logged as sent-but-unrecorded stays `queued`; nothing re-enqueues a queued row on its own (`notifications.service.ts` enqueues only on create and requeue).

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the first sent-write failing, one e-mail, one SMS and one WhatsApp message each reach the mock exactly once and every job resolves (integration tests, 3 of 3).
- **SC-002**: With every sent-write failing, the job resolves and the mock holds one e-mail (integration test).

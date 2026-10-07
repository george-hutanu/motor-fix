# Feature Specification: An SMS that may have gone is never sent twice

**Feature Branch**: `561-sms-sent-once`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-561 (from ST-392, code-reviewer MEDIUM on PR #73): "sendSms is at-least-once: if Brevo accepts the SMS and then the worker dies or the job fails before the sent write, the retry sends and counts a second SMS; a timeout after Brevo accepted gives back the count of an SMS that went" — https://app.notion.com/p/3f0607bff0d28100bcb4d12439ca1fc4

## Scope

ST-522 (`specs/522-email-sent-once`) already retries a failed sent-write in-process and lets the claim lapse on a failed release, so a failed write alone is covered on `main` (`notifications.processor.ts` `sent()`). What remains, and what this story fixes, is SMS only: a worker that dies, or a job that fails, between calling Brevo and the sent write, and a Brevo call that ends with no answer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A driver gets one SMS, and is charged one, even when the worker stumbles (Priority: P1)

The worker marks the SMS row as being sent just before it calls Brevo. If that attempt never records an answer (the worker died, or Brevo's answer never arrived), a later attempt sees the mark, does not call Brevo again and does not count another SMS: it fails the row as unconfirmed and the message goes on by the next channel.

**Independent Test**: queue an SMS, mark it as being sent as a dead worker would have left it, run the send job; Brevo receives no SMS, the month's count is unchanged, the row is `failed` `sms_unconfirmed` and a WhatsApp row follows it.

**Acceptance Scenarios**:

1. **Given** a queued SMS, **When** it is sent, **Then** the row carries the mark before Brevo is called, and the sent row reads `sent` as today.
2. **Given** an SMS row an earlier attempt marked as being sent (the worker died before recording Brevo's answer), **When** its send job runs again, **Then** Brevo gets no SMS, no SMS is counted, the row fails `sms_unconfirmed` and falls back to WhatsApp.
3. **Given** a queued SMS, **When** Brevo gives no answer before the timeout, **Then** the job resolves without a retry, the SMS stays counted, the row fails `sms_unconfirmed` and falls back to WhatsApp.
4. **Given** a queued SMS, **When** Brevo answers with a refusal (e.g. 503 or 400), **Then** the mark is cleared and the count given back, and it is retried or falls back as today.

### Edge Cases

- The mark is written before the month's count is taken: a failed mark fails the job with nothing sent or counted, and its retry starts afresh.
- After a refusal the count goes back before the mark is cleared: a failed clear fails the job, and the retry sees the mark and settles the row as unconfirmed (no second SMS, no count).
- A row that reaches the monthly cap, or has no text, never gets the mark: nothing was sent.
- E-mail, WhatsApp and push are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Before calling the provider for an SMS, the processor MUST record on the row that the SMS is being sent.
- **FR-002**: A send job for an SMS row that already carries that record MUST NOT call the provider and MUST NOT count another SMS; it MUST fail the row with `sms_unconfirmed` and fall back to the next channel.
- **FR-003**: When the provider call for an SMS ends with no answer (`provider_unreachable`: a timeout or a lost connection), the SMS MUST stay counted and MUST NOT be retried; the row MUST fail with `sms_unconfirmed` and fall back to the next channel.
- **FR-004**: When the provider answers an SMS with a refusal, the processor MUST clear the record and give the count back, so the retry and fallback rules apply as before.

### Key Entities

- **Notification row**: gains `sendingAt` (nullable timestamp), set just before an SMS goes to the provider.

## Clarifications

### Session 2026-10-07

- Q: What becomes of an SMS whose fate is unknown? → A: Failed `sms_unconfirmed`, falling back to the next channel (WhatsApp, then e-mail). A possible second message on another channel is preferred to a driver reached by nobody; a second SMS (the paid, capped channel) is what the finding rules out. (autonomous; evidence: `notifications.service.ts` `fail()` and `NEXT`)
- Q: Is the count of an unconfirmed SMS given back? → A: No: it may have gone and Brevo charges for it (the finding). (autonomous)
- Q: Tell a timeout apart from a refused connection? → A: No: `Brevo.call` reports both as `provider_unreachable` (`brevo.ts`), and telling them apart adds a reason code for a rare case; a refused connection also ends unconfirmed and falls back. (autonomous, Principle I)

## Assumptions

- Brevo's transactional SMS API takes no idempotency key, so the mark is the only guard.
- E-mail and WhatsApp keep their at-least-once retry: out of this story's scope (the finding names `sendSms`).

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A marked SMS row's send job makes 0 SMS calls and leaves the month's count unchanged (integration test).
- **SC-002**: A hanging Brevo makes 1 SMS call, the job resolves, the count stays 1 (integration test).
- **SC-003**: The existing SMS integration tests stay green.

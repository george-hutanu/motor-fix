# Feature Specification: The mark-sent write is retried without a delay

**Feature Branch**: `778-mark-sent-retry-no-delay`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-778 (tech debt from ST-522, pr-tester): "spec drift: the retry of the \"mark sent\" write waits `200 * attempt` ms between attempts, but the spec's clarification says \"3 in all, no delay\"; drop the delay or amend the spec" — https://app.notion.com/3f1607bff0d2813a87c1edadb743768a. Also ST-779 (same review): "push sends are not tested for a failed \"mark sent\" write, though FR-001 and the spec's edge case name push" — https://app.notion.com/p/3f1607bff0d281db8706fdb7f05689fb

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A stumbling database does not slow a send or send twice (Priority: P1)

The provider (Brevo, or a push service) accepts a message, then the write that marks the row sent fails. The worker tries the write again at once, three times in all, as ST-522 decided, instead of waiting 200 ms and then 400 ms between tries. Push follows the same rule as e-mail, SMS and WhatsApp.

**Acceptance Scenarios**:

1. **Given** a queued e-mail, **When** Brevo accepts it and every write marking it sent fails, **Then** the write is tried 3 times, back to back, and the job resolves.
2. **Given** a queued push message, **When** the push service accepts it and the first write marking it sent fails, **Then** the job resolves, the push service got it once and the row reads `sent`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The processor MUST retry a failed mark-sent write (522-FR-001) immediately, with no wait between the 3 tries.
- **FR-002**: A push the push service accepted MUST follow 522-FR-001: a failed first mark-sent write does not fail the job, the message is not sent again, and the row ends `sent`.

## Clarifications

### Session 2026-10-07

- Q: Drop the delay or amend the spec? → A: Drop the delay. ST-522's clarification chose "3 in all, no delay" (`specs/522-email-sent-once/spec.md:45`): a dropped connection clears in-process, a long outage is logged for the operator; a delay adds a knob the decision did not ask for (Principle I). (autonomous)
- Q: Where does the push case go? → A: `push.processor.integration.spec.ts`, which builds the processor with a push sender and a push service stand-in; the phone spec named by the finding builds none. (autonomous)

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No timer runs between the mark-sent tries (`notifications.processor.ts` holds no `setTimeout` in `sent`).
- **SC-002**: The push failed-write case passes beside the e-mail, SMS and WhatsApp ones.

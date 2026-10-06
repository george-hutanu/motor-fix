# Feature Specification: A bad PUBLIC_WEB_URL is named at start, not found one e-mail at a time

**Feature Branch**: `539-public-web-url-boot`
**Created**: 2026-10-07
**Status**: Archived (2026-10-07)
**Input**: ST-539 (from ST-195): "a worker started without a valid PUBLIC_WEB_URL boots and then fails every e-mail with a button as template_failed" — https://app.notion.com/3ef607bff0d2811da140f6088b263b10. ST-465 (from ST-21): "new URL(PUBLIC_WEB_URL) at import throws an unnamed TypeError on a malformed value" — https://app.notion.com/3ef607bff0d2811fb566df383fbdc442

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The worker does not burn e-mails it cannot build (Priority: P1)

With `EMAIL_SENDING=on` and `PUBLIC_WEB_URL` missing or not a URL, the worker today starts, takes each e-mail with a button and fails it as `template_failed` for good. After this change it refuses to process the notifications queue, as it already does for a missing Brevo key, and logs which variable is wrong; the e-mails wait in the queue until the address is set.

**Acceptance Scenarios**:

1. **Given** e-mail sending on and `PUBLIC_WEB_URL` unset, **When** the worker starts, **Then** `ready()` is false, an error naming `PUBLIC_WEB_URL` is logged and Brevo is not called.
2. **Given** e-mail sending on and `PUBLIC_WEB_URL` = `not a url`, **Then** the same.
3. **Given** e-mail sending off (phone only, or nothing), **Then** `PUBLIC_WEB_URL` is not required.

### User Story 2 - The web server names the variable it cannot read (Priority: P2)

A malformed `PUBLIC_WEB_URL` makes the web server throw an unnamed `TypeError: Invalid URL` at import. After this change it throws an error naming `PUBLIC_WEB_URL`, never echoing the value.

**Acceptance Scenarios**:

1. **Given** `PUBLIC_WEB_URL` = `not a url`, **When** it is read, **Then** the error says `PUBLIC_WEB_URL must be an absolute URL` and does not contain the value.
2. **Given** it is unset, **Then** the reader returns nothing (development and build keep working).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The notifications worker MUST NOT process its queue while e-mail sending is on and `PUBLIC_WEB_URL` is missing or not an absolute URL, and MUST log an error naming `PUBLIC_WEB_URL`.
- **FR-002**: With e-mail sending off, the worker's start MUST NOT depend on `PUBLIC_WEB_URL`.
- **FR-003**: Reading `PUBLIC_WEB_URL` for the web server MUST throw an error naming the variable, without its value, when it is set but not an absolute URL, and return nothing when it is unset.

## Clarifications

### Session 2026-10-07

- Q: Refuse to start, or keep running and not process the queue? → A: Not process the queue, the path `ready()` already takes for a missing Brevo key (`notifications.processor.ts:62`); the rest of the worker keeps running. (autonomous)
- Q: One PR for both stories? → A: Yes, same variable and both are start-time validation; both go Done. (orchestrator)

## Assumptions

- `apps/web/src/app/app.config.server.ts` reads the same variable after `server.ts` has; it uses the shared reader too.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

### Capability: `platform`

- **Adds**: FR-003
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `ready()` is false with sending on and the address unset or malformed, true with sending off (integration tests, 3 of 3).
- **SC-002**: The reader throws a named error without the value for a malformed address and returns undefined when unset (unit tests).

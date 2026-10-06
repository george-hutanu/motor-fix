# Feature Specification: One reader for PUBLIC_WEB_URL

**Feature Branch**: `780-one-public-web-url-parser`
**Created**: 2026-10-07
**Status**: Archived (2026-10-07)
**Input**: ST-780 (tech debt from ST-539, code-reviewer): "duplication: two parsers of PUBLIC_WEB_URL, `publicWebUrl()` in `libs/contracts/src/env.ts` throws on a malformed value while email-config's `webUrl()` silently returns undefined; have `webUrl()` use `publicWebUrl()` and decide whether a malformed value should stop the worker's config load" — https://app.notion.com/3f1607bff0d2817781dae9576b51b8bd

## User Scenarios & Testing *(mandatory)*

### User Story 1 - E-mail buttons and the web server read the address the same way (Priority: P1)

The e-mail settings read `PUBLIC_WEB_URL` through the same reader the web server uses, so both agree on what a valid address is and how it is written. A value with stray spaces around it (common when pasting into a host's variables) today ends up, spaces and all, in every e-mail button; after this change the button opens the address the web server serves.

**Acceptance Scenarios**:

1. **Given** `PUBLIC_WEB_URL` = ` https://motorfix.test/ ` (spaces around it), **When** the e-mail settings are read, **Then** the address is `https://motorfix.test`.
2. **Given** `https://motorfix.test/`, **Then** `https://motorfix.test` (no trailing slash, as today).
3. **Given** it is unset, empty or not an absolute URL, **Then** the e-mail settings carry no address and loading them does not throw; the worker's existing check (539-FR-001) refuses the queue with an error naming `PUBLIC_WEB_URL`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The e-mail settings MUST take the web app address from the shared `PUBLIC_WEB_URL` reader (539-FR-003): an absolute URL as that reader normalises it, without a trailing slash.
- **FR-002**: A `PUBLIC_WEB_URL` that is unset, empty or not an absolute URL MUST leave the e-mail settings without an address and MUST NOT stop the api or the worker from loading their configuration.

## Clarifications

### Session 2026-10-07

- Q: Should a malformed value stop the worker's config load? → A: No. ST-539 chose, and 539-FR-001/FR-002 record, that the worker keeps running and only refuses the notifications queue (and only while e-mail sending is on), with the error naming the variable; `emailConfig` is also loaded by the api (`apps/api/src/app.module.ts:31`), which does not need the address unless it sends. Throwing would reverse that decision and stop processes that do not need the value. (autonomous; evidence `.specify/capabilities/notifications.md:409-413`)

## Assumptions

- The OAuth return address (`libs/domain/src/auth/oauth/providers.ts:45`) reads the variable as text and checks nothing; it is not one of the two parsers the finding names and stays as it is.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Exactly one function in the repository parses `PUBLIC_WEB_URL` as a URL (`publicWebUrl`).
- **SC-002**: The e-mail settings unit tests pass for a padded, a trailing-slash, an unset and a malformed value.

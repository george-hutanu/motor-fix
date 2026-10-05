# Feature Specification: Keep the account link out of stored notification params

**Feature Branch**: `555-account-link-params`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-555 — https://app.notion.com/p/3f0607bff0d2811cb685cb87e21ad087
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: tech debt found by pr-tester on ST-81 (PR #71): the confirmation link, token included, is kept in `notification.params` of the e-mail and bell rows, so the token is not stored only as its hash (81-FR-002).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A database reader cannot use a stored account link (Priority: P1)

An e-mail check, a password reset and a password-changed notice each send a
link that carries a single-use token. The token is stored only as its hash, but
the whole link was also written into the params of the bell row and of the
e-mail row, and stayed there. Anyone who can read the `notification` table (a
backup, a support query, a leaked dump) could confirm an address or reset a
password with it while it is valid. After this change the bell row never holds
the link, and the e-mail row holds it only until the e-mail is sent or fails.

**Independent Test**: send an account e-mail through the processor against the
Brevo mock; the e-mail carries the link, and afterwards no notification row of
that event has a `link` param.

**Acceptance Scenarios**:

1. **Given** an account e-mail is issued, **When** its rows are written, **Then** the bell row's params hold the purpose and no link.
2. **Given** an account e-mail is queued, **When** Brevo accepts it, **Then** the e-mail carries the link and the row, now sent, holds no link.
3. **Given** an account e-mail is queued, **When** it fails (sending switched off since, Brevo refuses it for good, the account was deleted), **Then** the failed row holds no link.
4. **Given** sending is off or the address is not allowlisted, **When** the account e-mail is issued, **Then** its row is written failed without the link.
5. **Given** a password reset, **When** the reset e-mail is sent, **Then** its row holds no link either.

### Edge Cases

- An e-mail Brevo refuses for a retry keeps its link until the retry sends it or it finally fails.
- A row held for quiet hours keeps its link until it is sent (account e-mails are urgent, so this does not happen today).
- Rows written before this change keep their link; links expire (confirmation 72 hours, reset 1 hour), so no migration rewrites them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The bell (`in_app`) row of a notification MUST NOT store a `link` param.
- **FR-002**: An outside row that is sent MUST no longer store its `link` param once it is marked sent; the message itself MUST still carry the link.
- **FR-003**: An outside row that fails MUST no longer store its `link` param once it is marked failed, including a row written already failed because sending is off or the address is not allowlisted.
- **FR-004**: The end-to-end password reset flow MUST read the reset link from the e-mail as sent (a Brevo stand-in), not from the database.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: After an account e-mail is sent or fails, no `notification` row of its event has a `link` param, in every path the tests drive.
- **SC-002**: The confirmation, reset and password-changed e-mails still carry their links; the existing auth and notifications suites pass unchanged.

## Assumptions

- (autonomous default) "Drop it once sent" over "render it at send time": rendering at send time needs the raw token at send time, which only the issuer holds; the row is the only hand-over to the worker, so the link stays on it while the e-mail is in flight and is removed when the row is marked sent or failed. Evidence: `libs/domain/src/auth/email-confirmation.service.ts` `issue()` stores only the hash; `notifications.processor.ts` renders from `row.params`.
- (autonomous default) The rule is by param name (`link`), not by kind: only ACCOUNT_EMAIL uses `link` (`templates/account-email.ts`); news' `unsubscribe`/`oneClick` are out of scope (ST-556, ST-560, ST-561 own the rest of this module's debt).
- (autonomous default) A fallback row copies the failed row's params, link included: it is the same message still in flight, and it drops the link in turn when it is sent or fails. ACCOUNT_EMAIL has no fallback channel today.
- (autonomous default) The end-to-end suite turns e-mail sending on against a local Brevo stand-in (`apps/web-e2e/mailbox.mjs`) so the reset test reads the e-mail as sent; with sending off, the row is now failed without the link and there is nothing to read.
- (autonomous default) No migration for old rows: confirmation tokens expire within 72 hours and reset tokens within one, so old rows stop working on their own.

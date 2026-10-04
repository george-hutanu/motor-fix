# Feature Specification: Confirm my e-mail address

**Feature Branch**: `081-confirm-email`
**Created**: 2026-10-05
**Status**: Draft
**Input**: ST-81 "Confirm my e-mail address" — https://app.notion.com/p/3ee607bff0d281fbb2b2ed051f341579 (Build brief current as of 2026-10-03)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A new account gets a confirmation link and confirms it (Priority: P1)

Andrei signs up with andrei@example.ro. MotorFix queues, at once, an e-mail in his language with the button "Confirmă adresa". He opens the link within 72 hours: his address is marked confirmed and the page says "Adresa ta de e-mail este confirmată."

**Why this priority**: it is the story: MotorFix learns that its messages reach the person.

**Independent Test**: sign up through the API, take the link from the queued notification, open it, read `GET /me`.

**Acceptance Scenarios**:

1. **Given** a visitor signs up with an e-mail and password, **When** the account is created, **Then** one `ACCOUNT_EMAIL` e-mail (`email_check`) is queued for the account, in the account's language, with a link `<web>/<lang>/confirm-email/<token>`.
2. **Given** that link, opened within 72 hours, **When** the page opens, **Then** `email_verified_at` is set, the audit history of the account has an "e-mail confirmed" entry, and the page says "Adresa ta de e-mail este confirmată." / "Your e-mail address is confirmed."
3. **Given** the link was already used and the address is confirmed, **When** it is opened again, **Then** the page says the address is confirmed; nothing is written again.
4. **Given** an English account, **When** the link is sent, **Then** the e-mail and the link are in English (`/en/confirm-email/…`).

---

### User Story 2 - An expired link offers a new one (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a link older than 72 hours, or one voided by a newer link, **When** it is opened, **Then** the page says "Linkul a expirat" / "The link has expired" with "Trimite un link nou" / "Send a new link".
2. **Given** that page, **When** the person presses "Trimite un link nou", **Then** a new link is sent to the address the old one was made for and the page says so; every older link of the account stops working.
3. **Given** a link that was never issued, **When** it is opened, **Then** the page shows the expired state and sending a new link is refused the same way, so a made-up link learns nothing.

---

### User Story 3 - The dashboard reminds an unconfirmed account (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a signed-in account with an unconfirmed e-mail, **When** any dashboard opens, **Then** the banner "Confirmă-ți adresa de e-mail" / "Confirm your e-mail address" shows with "Retrimite" / "Send again".
2. **Given** the banner, **When** "Retrimite" is pressed, **Then** a new link is sent and a toast says so; pressed again within a minute, or a sixth time within the hour, a toast says to try again later.
3. **Given** the person has the dashboard open in another tab, **When** the link is opened, **Then** the banner disappears in that tab without a reload.
4. **Given** an account with a confirmed e-mail, or with no e-mail, **Then** no banner shows.

### Edge Cases

- Sending fails or Redis is down at sign-up: the account is still created and signed in; the banner lets the person ask again (Build brief, States and errors).
- The account's address changed after the link was made: the link confirms nothing (it confirms only the address it was made for) and shows the expired state.
- Brevo refuses or bounces: the existing pipeline marks the NOTIFICATION `failed` and retries (ST-194); nothing new here.
- A suspended or deleted account's link: the expired state; nothing is written.
- Two opens of the same link at once: one confirmation, one audit entry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Creating an account by sign-up MUST issue a confirmation link and queue one `ACCOUNT_EMAIL` e-mail with purpose `email_check` to the account, in the account's language, whose link is `<PUBLIC_WEB_URL>/<language>/confirm-email/<token>`.
- **FR-002**: A confirmation token MUST be 32 random bytes (base64url), stored only as its SHA-256 hash in `account_token` with purpose `email_confirm`, the address it was made for, an expiry 72 hours after issue, and single use.
- **FR-003**: `POST /api/v1/auth/confirm-email` with `{ token }` (no sign-in) MUST, for an unexpired, unused token of an active account whose e-mail is still the token's address, set `email_verified_at`, mark the token used, record an audit entry for the account (field `email_verified_at`), and answer 200 `{ status: "confirmed" }`.
- **FR-004**: The same route MUST answer 200 `{ status: "confirmed" }` without writing when the token's account still has the token's address as its e-mail and it is confirmed (a second, concurrent open of the same link included), and 410 `link_expired` for any other token (unknown, expired, voided, used while unconfirmed, other address, inactive account); a malformed body is 400 `validation_failed`.
- **FR-005**: `POST /api/v1/auth/confirm-email/resend` with `{ token }` (no sign-in) MUST, for any issued token whose active account still has that address unconfirmed, issue a new link to it and answer 202; an already confirmed address is 409 `email_already_confirmed`; any other token is 410 `link_expired`.
- **FR-006**: `POST /api/v1/me/email-confirmation` (signed in, any role) MUST issue a new link and answer 202 when the account has an unconfirmed e-mail; 409 `email_already_confirmed` when it is confirmed, 409 `no_email` when the account has none.
- **FR-007**: Issuing a link MUST void every older unused `email_confirm` token of the account.
- **FR-008**: Asking for a new link (FR-005, FR-006) MUST be limited per account to once a minute and 5 times an hour, each window starting at the first ask in it; only a link actually sent counts, the link sent at sign-up does not. The checks run token (410), then confirmed (409), then the limit: over it the answer is 429 `too_many_attempts` and nothing is sent. When Redis does not answer, the limit is skipped.
- **FR-009**: `GET /api/v1/me` MUST include `emailConfirmed`: true when the account's e-mail is confirmed, false otherwise.
- **FR-010**: Confirming MUST publish the live event `account.email_confirmed` (id: the account id; no personal data) to the account's channel `account:<accountId>`; a Redis that does not answer only skips the event.
- **FR-011**: An account created with a Google or Apple identity MUST have its e-mail confirmed at creation, with no link sent.
- **FR-012**: A failure to issue or queue the link MUST NOT fail the sign-up: it is logged and the account is created and signed in.
- **FR-013**: Every dashboard MUST show, for an account with an unconfirmed e-mail, the banner "Confirmă-ți adresa de e-mail" with "Retrimite"; pressing it asks for a new link (FR-006) and a toast tells the outcome: sent, too many (429), or failed.
- **FR-014**: The banner MUST disappear when the account's e-mail becomes confirmed: an open dashboard re-reads the account on the live event `account.email_confirmed`, and a dashboard opened later reads it from `GET /me`.
- **FR-015**: The page `/<lang>/confirm-email/<token>` MUST confirm on opening (FR-003) and show: confirming, "Adresa ta de e-mail este confirmată.", or "Linkul a expirat" with "Trimite un link nou" (FR-005), whose outcome — sent, already confirmed, too many, failed — it shows in place; a failed confirmation (network, 5xx) shows an error with "Încearcă din nou".
- **FR-016**: The seeded accounts MUST have their e-mail confirmed, so their dashboards show no banner.

### Key Entities

- **AccountToken** (`account_token`): id, account, purpose (`email_confirm`), token hash (unique), the e-mail it was made for, expires at, used at, created at.
- **Account.emailVerifiedAt**: already in the schema (ST-79); this feature is its first writer.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every sign-up with an e-mail queues exactly one confirmation e-mail (integration test).
- **SC-002**: A confirmation link works once, within 72 hours, for its own address only (integration tests).
- **SC-003**: The banner and the confirmation page have no horizontal scroll at 320 px, in RO and EN, light and dark (PR tester sweep).

## Clarifications

### Session 2026-10-05

- Q: Does "already confirmed" (FR-004) mean any confirmed e-mail, or the token's address? → A: the account's current e-mail must equal the token's address and be confirmed; otherwise 410. (spec-challenger recommendation)
- Q: Fixed or sliding windows for the resend limit, and what counts? → A: fixed windows that start at the first ask (as the sign-up limit, `attempts.ts`); only a sent link counts; the sign-up link does not. (spec-challenger, adjusted to the repo's existing limiter)
- Q: Which refusal wins when several apply to a resend? → A: token 410, then confirmed 409, then limit 429; nothing is sent before all pass. (spec-challenger)
- Q: Is the token written in the sign-up transaction? → A: no: issue and queue after the account's transaction commits, so a sending failure never undoes the account (FR-012); an orphan unused token is voided by the next issue. (spec-challenger)
- Q: The audit entry and two opens at once? → A: actor the account itself (its last role), field `email_verified_at`, old null, new the time; the token is taken with a conditional update on `used_at IS NULL`, and the loser answers 200 confirmed. (spec-challenger)
- Q: Which tab drops the banner? → A: the confirm page shows no banner; open dashboard tabs re-read `GET /me` on `account.email_confirmed`, whose id is the account id (FR-014, FR-010). (spec-challenger)
- Q: Google/Apple with no social sign-in yet? → A: `createAccount` marks the e-mail confirmed when the identity is `google` or `apple`; the social sign-in story uses it. (spec-challenger)
- Q: `emailConfirmed` with no e-mail? → A: false; the banner hides on `email == null`. (spec-challenger)
- Note: the brief names the template `email_confirm` *(proposed)*; the repo's catalogue already has `ACCOUNT_EMAIL` purpose `email_check` (ST-195, `libs/domain/src/notifications/templates.ts:205`), which is used. (context.md, contradiction 1)

## Assumptions

- The 72-hour expiry, the page and banner wording, the route `/{lang}/confirm-email/:token`, the 1-a-minute / 5-an-hour limit, `ACCOUNT_TOKEN`, and Google/Apple counting as confirmed are the brief's *(proposed)* defaults, taken as written. (autonomous default)
- Sending a new link from the expired page works by the expired token, without sign-in: the person who opened the e-mail may not be signed in on that device, and the token already proves they received a link for that address; the link still goes only to the account's own address. (autonomous default)
- Opening a used link of an address that is confirmed says it is confirmed, not expired: the person has nothing left to do. (autonomous default)
- The garage-listing path of scenario 5 does not exist yet (List your garage is another story); every account creation with an e-mail and password goes through sign-up today, so FR-001 covers it; the story that adds the listing form calls the same issue. (autonomous default)
- Scenario 7 (an unconfirmed account can request quotes, message and book) needs no code: nothing checks `email_verified_at` before those, and those routes do not exist yet. Scenario 8 (the review check, `email_not_confirmed`) is built with the review stories, as the brief says.
- Scenario 6's settings hint for an address that does not receive mail has no settings screen to live in yet; the bounce itself is recorded by ST-194 (`email_bounced_at`). Not built here.
- No test mailbox exists in the end-to-end setup, and it also runs against staging: the end-to-end test covers sign-up → banner → expired page; opening a real link is covered by the API integration tests, which read the link from the queued notification. (autonomous default)
- The e-mail's text is the existing `ACCOUNT_EMAIL.email_check` template (ST-195): button "Confirmă adresa" / "Confirm the address"; no template change.

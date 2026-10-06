# Feature Specification: Sign in with a phone number and a code sent by WhatsApp

**Feature Branch**: `393-whatsapp-phone-sign-in`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "ST-393 Sign in with a phone number and a code sent by WhatsApp (Notion story https://app.notion.com/p/3ee607bff0d28192afb9c5c7f7195b8c, epic EP-1 Foundations). As a visitor, I want to sign in with my phone number and a one-time code sent by WhatsApp, so that I can sign in without e-mail and password. Phone option in the sign-in dialog ('Continuă cu telefonul'), +40 prefilled, E.164; 6-digit code by WhatsApp through Brevo, valid 5 minutes, single use, void after 5 wrong attempts, resend after 60 s, at most 5 codes per number per hour, per-IP limit, new code voids the old one; a number matching an account signs in to it, any role; a number with no account asks for Nume and the terms tick, then creates a driver account; Brevo failure shows the fallback message; maintenance mode lets only admins in; POST /api/v1/auth/phone-code and POST /api/v1/auth/phone-sign-in; error codes code_invalid, code_expired, too_many_attempts, whatsapp_failed, maintenance; audit 'account created' method whatsapp_phone; emits account.created; Jest unit/API tests and a Playwright end-to-end test with a Brevo stub."

**Sources**: Notion story ST-393 (https://app.notion.com/p/3ee607bff0d28192afb9c5c7f7195b8c), read 2026-10-06; its Build brief (current as of 2026-10-03) wins over the criteria above it; the owner's decisions of 2026-10-03 (a new number creates a driver account on the spot; a code is valid 5 minutes). Epic EP-1 Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), build-timeline row https://app.notion.com/p/3ee607bff0d2814e8f58f3643ee45891. The repo: the sign-in, sign-up, consent, password-reset and e-mail-confirmation use cases in `libs/domain/src/auth`, the `accounts` capability (`.specify/capabilities/accounts.md`), the sign-in dialog in `apps/web/src/app/sign-in`, and ST-392's Brevo WhatsApp sending and templates in `libs/domain/src/notifications`. Design: the story's boards roll up from EP-1 (Sign in · dialog, Mobile · Sign-in sheet); the phone option itself is not designed (Build brief › Screens).

## Clarifications

### Session 2026-10-06

- Q: When the right code is given for a number held by an account whose phone is not verified, does `phone-sign-in` answer 409 at once, ask for the profile, or sign the account in? → A: 409 `phone_taken` at the right-code call, before the profile step; the phone is not verified by this flow.
- Q: During maintenance, is the 202-versus-503 difference on `phone-code` (which shows a number is an admin's) accepted, and is a non-admin's right code spent on `maintenance`? → A: Accepted, as the e-mail sign-in already does under maintenance; the right code is spent.
- Q: In what order does `phone-sign-in` check a code, and is a code at the 5-attempt cap voided or kept? → A: Attempts cap, then expiry, then the hash; a capped code is kept and answers 429 until a new code voids it; a voided or missing code answers 401.
- Q: When the number matches an account and the body also carries a name and consent, does the call sign in or answer 400? → A: It signs in and ignores the name and consent.
- Q: Are the per-number and per-address hourly windows fixed from the first request, and does the sixth digit send the code by itself? → A: Both windows are fixed from their first request (one Redis key with a time to live, as the password sign-in's limits); no auto-submit: the person taps "Intră în cont".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A person with an account signs in with their phone and a WhatsApp code (Priority: P1)

From the sign-in dialog, the person taps "Continuă cu telefonul", enters their number (+40 is filled in), asks for the code, gets a 6-digit code on WhatsApp within moments, types it, and is signed in to the account that holds that number, in the role they used last, exactly as a sign-in with e-mail and password would do.

**Why this priority**: it is the story: a sign-in without e-mail and password. Every other scenario is a guard around it.

**Independent Test**: seed a garage owner whose verified phone is +40722123456; request a code for 0722 123 456 against the Brevo stub, read the code from the stub, send it; the answer is a session for the garage role and the dashboard `/app/garage` opens.

**Acceptance Scenarios**:

1. **Given** the sign-in dialog, **When** "Continuă cu telefonul" is tapped, **Then** the dialog shows the phone step: a phone field with "+40" filled in and the button "Trimite codul", in place of the e-mail form; the e-mail form is one tap away.
2. **Given** 0722 123 456 typed in the phone field, **When** "Trimite codul" is tapped, **Then** one WhatsApp message holding a 6-digit code and how long it is valid goes to +40722123456 in the interface language, and the dialog shows the code step: a 6-digit code field, a 5:00 countdown and "Trimite din nou".
3. **Given** the right code within 5 minutes, **When** it is entered, **Then** the person is signed in to the account with that number, the dialog closes and the landing of the role used last opens, in the account's language; "Ține‑mă autentificat" was honoured as for a password sign-in.
4. **Given** the number belongs to an account of any role (driver, garage owner, receptionist, mechanic, admin), **When** the right code is entered, **Then** that account is signed in: no role is created, no account is created.
5. **Given** the number is written as +40 722 123 456, 0722-123-456 or 0040722123456, **When** the code is asked for, **Then** all three are the same number, +40722123456, and match the same account.

---

### User Story 2 - A new number creates a driver account after the code (Priority: P1)

A number that no account holds gets its code the same way. After the right code, the dialog asks for the person's name and the terms tick; on confirm, a driver account is created with the phone verified, and the person lands on the driver dashboard or goes back to the action that asked them to sign in.

**Why this priority**: the owner decided on 2026-10-03 that this path creates the account on the spot; without it every new driver would be turned away at the code step.

**Independent Test**: request a code for an unknown number, send the right code; the answer says a profile is needed; send the name and the current consent with the same code; a driver account exists with a `whatsapp_phone` identity, `phone_verified_at` set, the consent rows, one "account created" audit entry and one `account.created` event; the dashboard `/app/driver` opens.

**Acceptance Scenarios**:

1. **Given** no account holds the number, **When** the right code is entered, **Then** the dialog shows the profile step: "Nume" and the terms-and-privacy tick (the shared consent control), with the button "Creează contul"; nothing is created yet.
2. **Given** the profile step with a name of 2 to 80 characters and the tick on, **When** "Creează contul" is tapped, **Then** a `driver` account is created in the interface language with that name, the phone in E.164 marked verified now, a `whatsapp_phone` sign-in identity for that number, the `terms` and `privacy_notice` consent rows with method `whatsapp_phone`, one "account created" audit entry and one `account.created` event (method `whatsapp_phone`), all in one transaction; the person is signed in and the dialog closes.
3. **Given** the dialog was opened by "Autentificare" or the "Cont" tab, **When** the account is created, **Then** `/app/driver` opens; **Given** it was opened by an action that needed a session (the gate), **Then** the dialog resolves "signed in" and the action goes on where it was.
4. **Given** the tick is off or the name is missing or too long, **When** "Creează contul" is tapped, **Then** the problem shows under its field, nothing is sent, and the code stays valid.
5. **Given** the profile step, **When** the 5 minutes of the code run out before the person confirms, **Then** "Codul a expirat. Cere un cod nou." shows and the person is back at the code step with "Trimite din nou".

---

### User Story 3 - A code is single-use, short-lived and guarded against guessing (Priority: P1)

A code works once and for 5 minutes; a wrong code says so and counts; after 5 wrong attempts the code is void; a new code can be asked for after 60 seconds and at most 5 times an hour per number; a new code voids the old one; requests are limited per network address.

**Why this priority**: a 6-digit code is only as safe as these limits; without them the sign-in is a brute-force door.

**Independent Test**: API tests: a code used twice is refused the second time; a code 5 minutes old is `code_expired`; 5 wrong attempts then the right code is `too_many_attempts`; a second request within 60 s and a 6th within the hour are refused; a new code makes the old one `code_invalid`.

**Acceptance Scenarios**:

1. **Given** a wrong code, **When** it is entered, **Then** "Codul nu este corect." shows with the attempts left (4, 3, 2, 1), and nobody is signed in.
2. **Given** 5 wrong attempts on one code, **When** the right code is then entered, **Then** it is refused with `too_many_attempts` and the person is told to ask for a new code.
3. **Given** a code sent more than 5 minutes ago, **When** it is entered, **Then** "Codul a expirat. Cere un cod nou." shows.
4. **Given** a code that already signed someone in or created an account, **When** it is entered again, **Then** it is refused as invalid.
5. **Given** a code was sent less than 60 seconds ago, **When** "Trimite din nou" is tapped, **Then** the button is disabled in the dialog, and a direct request is refused with `too_many_attempts` and no message is sent.
6. **Given** 5 codes were sent to a number within the hour, **When** a 6th is asked for, **Then** it is refused with `too_many_attempts` and no message is sent.
7. **Given** a second code was sent to a number, **When** the first code is entered, **Then** it is refused as invalid and only the second works.
8. **Given** one network address asks for codes for many numbers, **When** it passes its hourly share, **Then** every further request from it is refused with `too_many_attempts` until the hour ends.

---

### User Story 4 - When WhatsApp cannot deliver, the other ways to sign in are one tap away (Priority: P2)

When Brevo refuses the message, the number has no WhatsApp, or WhatsApp sending is not available, the person sees "Nu am putut trimite codul pe WhatsApp." with links to signing in with e-mail and password (and to the other methods once they exist).

**Why this priority**: an outside service fails; the person must still be able to sign in.

**Independent Test**: the Brevo stub refuses the WhatsApp call; the code request answers `whatsapp_failed`, no code is stored, and the dialog shows the fallback message with the e-mail link.

**Acceptance Scenarios**:

1. **Given** Brevo refuses the message or does not answer in time, **When** the code is asked for, **Then** the answer is `whatsapp_failed`, no code is kept, the request does not count against the number's hourly share, and the dialog shows "Nu am putut trimite codul pe WhatsApp." with a link back to e-mail and password.
2. **Given** WhatsApp sending is switched off or the code template is not approved, **When** the code is asked for, **Then** the same `whatsapp_failed` answer and message show.
3. **Given** the device reports no connection, **When** the code is asked for or entered, **Then** the shared offline message shows, as in the e-mail form.

---

### User Story 5 - Maintenance keeps the admin door open (Priority: P3)

While maintenance is on, only an admin's number gets a code and signs in; everyone else, a new number included, is told MotorFix is down for maintenance.

**Why this priority**: the rule exists for every sign-in (082-FR-006, 080-FR-007); the phone door must not bypass it.

**Independent Test**: with maintenance reading on, a code request for a driver's number and for an unknown number answer 503 `maintenance` and send nothing; an admin's number gets its code and signs in.

**Acceptance Scenarios**:

1. **Given** maintenance is on and the number belongs to a non-admin account or to no account, **When** the code is asked for, **Then** 503 `maintenance`, no message is sent, nothing is stored, and the dialog shows the shared maintenance message.
2. **Given** maintenance is on and the number belongs to an admin, **When** the code is asked for and entered, **Then** the admin signs in.
3. **Given** maintenance turned on after a non-admin's code was sent, **When** the code is entered, **Then** 503 `maintenance` and nobody is signed in.

---

### Edge Cases

- A number held by a suspended account: the right code answers 403 `account_suspended`, as a password sign-in does; the code is spent.
- A number held by a deleted account: it cannot sign in and cannot be given to a new account (one number belongs to one account); the right code answers 409 `phone_taken`, and the code is spent.
- A number held by an account whose phone is not verified (`phone_verified_at` empty) and that has no `whatsapp_phone` identity: the right code answers 409 `phone_taken` at once, before any profile step, the code is spent, and the person is told to sign in with e-mail and password; the phone is not verified by this flow.
- A number that is not a possible phone number (letters, too few or too many digits, no country code and not a Romanian national number): refused before anything is sent, with the problem under the field.
- Two requests for the same number at the same second: one code lives afterwards; the other request is refused as too soon.
- Two sign-ins with the same right code at the same second: exactly one session is opened (one account created); the other is refused as invalid.
- Redis unreachable or not answering within 2 seconds: the resend, hourly and per-address limits are skipped and the failure logged, as for the password sign-in's limits; the 5-minute expiry, the single use and the 5 attempts still hold, because they live with the code in PostgreSQL.
- A code request with a number that reads as valid but is outside the allow-list in a non-production environment: Brevo is not called and the answer is `whatsapp_failed`.
- The code message never carries a link or a name: only the code and its validity.
- The dialog's countdown reaching 0:00: the code field is disabled and "Trimite din nou" is offered; the server is the authority on expiry, the countdown is a hint.
- The person switches to the e-mail form and back: the typed number stays within the open dialog.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /api/v1/auth/phone-code` MUST take a phone number and the interface language (`ro` or `en`), be reachable without a session, normalise the number to E.164 (a Romanian national number such as `0722123456` becomes `+40722123456`; a number starting with `+` or `00` keeps its country), refuse with 400 a value that is not a possible phone number (after normalisation, `+` then 7 to 15 digits, the first not 0), and, when allowed, generate a 6-digit code from a cryptographic random source, send it by WhatsApp through Brevo with the registered SIGN_IN_CODE template in that language, and store it as described in FR-003. It MUST answer the same body (202, no content that reveals whether an account holds the number) for a known and an unknown number.
- **FR-002**: The code message MUST hold only the code and how long it is valid, in the interface language, through one SIGN_IN_CODE WhatsApp template in Romanian and English registered like ST-392's templates; it MUST be sent from the request itself (not through the notifications outbox and without a NOTIFICATION record), so the request can answer whether it was sent; it MUST NOT count as an SMS against anyone's monthly SMS share.
- **FR-003**: A sign-in code MUST be stored in PostgreSQL, at most one live code per E.164 number, as: the number, a hash of the code (never the code), when it expires (5 minutes after it was sent), how many wrong attempts it took, and whether it was used or voided. Issuing a new code for a number MUST void the previous one in the same statement, so two concurrent requests leave exactly one live code.
- **FR-004**: A code MUST be refused before it is sent when the number had a code sent less than 60 seconds ago (429 `too_many_attempts`), when the number had 5 codes sent within the hour that began with its first (429 `too_many_attempts`), or when the requesting network address, keyed as 080-FR-016 says, had 20 code requests within the hour that began with its first (429 `too_many_attempts`); each window is fixed from its first request. These counts MUST live in Redis as counts only; a request answered `whatsapp_failed` MUST NOT count toward the number's hourly share. When Redis cannot be reached or does not answer within 2 seconds, the request MUST proceed without these limits and log the failure.
- **FR-005**: When Brevo refuses the message, does not answer within 5 seconds, WhatsApp sending is off, the number is outside the non-production allow-list, or the SIGN_IN_CODE template is not approved, the request MUST answer 502 `whatsapp_failed`, store no code, and log the kind of failure without the number.
- **FR-006**: `POST /api/v1/auth/phone-sign-in` MUST take the phone number, the code, "keep me signed in" (true by default) and, optionally, a name, the consent (ST-132's `termsVersion` and `privacyVersion`) and the interface language (`ro` or `en`, default `ro`, used only for a new account), be reachable without a session, and check the code against the number's current code (the one not used and not voided), in this order: a code with 5 wrong attempts MUST answer 429 `too_many_attempts` without checking the code (it stays until a new code voids it); a code past its expiry MUST answer 410 `code_expired` whatever was typed; then no current code or a hash mismatch MUST answer 401 `code_invalid` (a mismatch counts one wrong attempt). Whatever the answer, the body MUST NOT reveal whether an account holds the number before the right code is given.
- **FR-007**: With the right code, the number MUST be matched first to a `whatsapp_phone` sign-in identity whose subject is that E.164 number, then to an account whose phone is that number and whose phone is verified. A match MUST open a session for the account's role in use exactly as `POST /api/v1/auth/sign-in` does (082-FR-001, 082-FR-007: access token in the body, refresh-token cookie with the "keep me signed in" choice, last active time set), for an account of any role, and mark the code used in the same transaction. A suspended account MUST answer 403 `account_suspended`; a deleted account MUST answer 409 `phone_taken`; both spend the code.
- **FR-008**: With the right code and no matching account, a request without a name or without the current consent MUST answer 200 with `{ "next": "profile" }` and leave the code live (the right code does not count as an attempt); a request with a name of 2 to 80 trimmed characters and the current consent MUST create, through the one `createAccount` use case, an account holding only the role `driver`, that name, the request's language, the phone in E.164 with `phone_verified_at` set now, a `whatsapp_phone` identity whose subject is the number, the `terms` and `privacy_notice` consent rows with method `whatsapp_phone`, its "account created" audit entry (method `whatsapp_phone`) and its `account.created` event, mark the code used, and open a remembered-or-not session for `driver` as 080-FR-002 does, all in one transaction; when the number matches an account (FR-007), a name and consent in the body are ignored and the account is signed in; a stale consent MUST answer 400 `consent_required` and create nothing. A number another account already holds (unique) MUST answer 409 `phone_taken` and create nothing.
- **FR-009**: A code MUST sign in or create an account at most once: two concurrent `phone-sign-in` calls with the same right code MUST open exactly one session, the other answering 401 `code_invalid`. Codes and sign-ins MUST NOT be written to the audit history; the "account created" entry is the only audit of this flow.
- **FR-010**: While maintenance reads as on, `phone-code` MUST answer 503 `maintenance` and send nothing unless the number matches (as FR-007 matches) an account holding `admin` (that this tells a caller a number is an admin's is accepted, as for the e-mail sign-in under maintenance); `phone-sign-in` with the right code MUST answer 503 `maintenance` for a non-admin account and for a new number, spending the code, and sign an admin in.
- **FR-011**: Both routes MUST refuse a body not sent as JSON and a body with a key naming the prototype chain as 080-FR-015 says, answer 400 for a missing or non-text phone, a code that is not exactly 6 digits, a language other than `ro` or `en`, a name outside 2 to 80 characters or holding control characters, or any other field; the code and the phone number MUST never be logged, and a refused call MUST be logged with its code only. Both routes MUST join the API's public-route list.
- **FR-012**: The sign-in dialog MUST offer, under its main button and a "sau" divider, the button "Continuă cu telefonul" (English "Continue with phone"); tapping it MUST show the phone step inside the same dialog: the field "Număr de telefon" with "+40" filled in (`type=tel`, `autocomplete=tel`), "Ține‑mă autentificat" ticked by default, the main button "Trimite codul", and a link back to e-mail and password. Before sending, the dialog MUST check that the number is a possible phone number and show the problem under the field as 082-FR-014 does (modifies 080-FR-009, which lists the dialog's controls under its main button).
- **FR-013**: After the code is sent, the dialog MUST show the code step: the number it went to, a 6-digit code field (`inputmode=numeric`, `autocomplete=one-time-code`), a countdown from 5:00, the main button "Intră în cont", and "Trimite din nou", disabled for 60 seconds after each send and after the countdown reaches 0:00 offered as the only action; entering the sixth digit MUST NOT send the code by itself: the person taps "Intră în cont". While a request is on its way the main button MUST be disabled with progress and a second tap MUST send nothing. Each step MUST move keyboard focus to its first field and announce its heading to screen readers, and every field MUST have a visible label.
- **FR-014**: The dialog MUST show, in the person's language and in a region screen readers announce, the message for each answer: `code_invalid` — "Codul nu este corect." with the attempts left; `code_expired` — "Codul a expirat. Cere un cod nou."; `too_many_attempts` — one text for too many codes or attempts, asking to wait or ask for a new code; `whatsapp_failed` — "Nu am putut trimite codul pe WhatsApp." with a link to sign in with e-mail and password (and to Google and Apple once those exist); `account_suspended`, `phone_taken`, `maintenance`, offline and the shared messages for a failed call and any other code as 082-FR-016 does. The typed number MUST stay; the code field MUST be cleared after `code_invalid`.
- **FR-015**: When the answer is `{ "next": "profile" }`, the dialog MUST show the profile step in the same dialog: "Nume", the shared consent control (ST-132) and the main button "Creează contul"; it MUST check the name's length and the tick as 080-FR-010 does before sending, and send the same code with the name and the consent. After a session is opened by any step, the dialog MUST close and behave as 082-FR-017 and 080-FR-013 say: the role's landing opens (`/app/driver` for a new account) in the account's language, or the dialog resolves "signed in" to the action that opened it.
- **FR-016**: Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011, and text the person typed MUST never be shown back as markup. The screens MUST hold at 320 px and 390 px phones, tablet and desktop, light and dark, without sideways scrolling.
- **FR-017**: Tests MUST cover, in Jest on real PostgreSQL and Redis: the 5-minute expiry; single use, also under two concurrent uses; the 5-attempt cap; the 60-second, 5-per-hour and per-address limits and their fail-open when Redis is down; a new number creating `driver` only, with its identity, consent, audit entry and event; a garage owner's number signing in to the garage account; a suspended and a deleted account's number; Brevo failure answering `whatsapp_failed` and storing nothing; maintenance; the number normalisation. A Playwright end-to-end test with a Brevo stub MUST sign in with a new number: tap the phone option, send the code, read it from the stub, enter it, fill in the name and the tick, and land on the driver dashboard.

### Key Entities

- **Sign-in code** (new, PostgreSQL): one live code per E.164 number: the number, the code's hash, sent and expiry times, wrong attempts, used or voided. It holds only the number, the hash, the times and the counts, never the code; the row is overwritten by the next request for that number and nothing sweeps it, so at most one row per number ever asked for remains (accepted: the number is as sensitive as the account's own phone and is never logged).
- **Account** (exists, 079-FR-001): gains, for a new number, a phone in E.164 with `phone_verified_at`.
- **Sign-in identity** (exists, 079-FR-003): the `whatsapp_phone` method with the E.164 number as its subject.
- **Account consent** (exists, ST-132): the `terms` and `privacy_notice` rows with method `whatsapp_phone`.
- **Code request counters** (Redis, not a table): per number (60-second and hourly) and per address (hourly), counts only, expiring with their window.
- **SIGN_IN_CODE** (exists in the catalogue, 194-FR-001; gains its WhatsApp text): the message holding the code and its validity, in Romanian and English.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-013, FR-014, FR-015, FR-016, FR-017
- **Modifies**: 080-FR-009 → FR-012
- **Removes**: none

### Capability: `notifications`

- **Adds**: FR-002
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person with an account signs in from the phone option with one code, in at most three steps (number, code, done); the end-to-end test does the new-number path, four steps (number, code, name and tick, done), and lands on the driver dashboard.
- **SC-002**: A code older than 5 minutes, a code used once, a code after 5 wrong attempts, a second code within 60 seconds and a 6th code within the hour are each refused in the API tests, with the code named in the brief (5 minutes, 5 attempts, 60 seconds, 5 per hour: Build brief).
- **SC-003**: Two concurrent uses of one right code open exactly one session, and two concurrent code requests for one number leave exactly one live code (integration tests).
- **SC-004**: Every refusal named in the scenarios (`code_invalid`, `code_expired`, `too_many_attempts`, `whatsapp_failed`, `maintenance`, `account_suspended`, `phone_taken`, `consent_required`) has a test and a message in both languages, and the PR QA sweep shows the three dialog steps at 320 px without sideways scrolling.

## Assumptions

- The Build brief's `*(proposed)*` defaults are taken as decided: the button label "Continuă cu telefonul", the number and code steps in the same dialog, the 5:00 countdown, 5 wrong attempts, 60-second resend, 5 codes per number per hour, a per-address limit, the error codes, the match order (identity first, then verified phone). (Build brief, autonomous default)
- **Where the code lives**: the brief puts SIGN_IN_CODE in Redis (`signin:code:{phone}`); Constitution VI says Redis never holds the only copy, and the repo keeps every comparable short-lived secret in PostgreSQL as a hashed row with expiry and used time (`AccountToken` for e-mail confirmation and password reset), with Redis holding only counts that fail open (`Attempts`). The code is therefore a PostgreSQL row keyed by the E.164 number (a new number has no account to hang a token on), with its attempts on the row; Redis holds only the resend, hourly and per-address counters. (autonomous default, Constitution VI)
- **How the code is sent**: the brief says "straight to the `notifications` queue, not through the outbox". A NOTIFICATION record needs an account and a new number has none, and the request must answer `whatsapp_failed` at once (scenario 9). The code therefore goes through the shared Brevo WhatsApp sender synchronously from the request, with the SIGN_IN_CODE template registered like ST-392's, and no NOTIFICATION record is written (the brief: codes are not recorded). The plan decides how the API reaches the sender, which today is wired in the worker. (autonomous default)
- The SIGN_IN_CODE template's Brevo approval is an outside step started by the owner, as for ST-392's templates; until it is approved, every code request answers `whatsapp_failed` and the e-mail door stays open. (Build brief, outside)
- Google and Apple sign-in do not exist yet (082-FR-013), so "Continuă cu telefonul" is the only button under "sau" and the `whatsapp_failed` message links only to e-mail and password until those stories land. (autonomous default)
- The per-address limit is 20 code requests an hour, mirroring the password sign-in's 20 failures per address (082-FR-005); the brief names no number. (autonomous default)
- A code request answers the same for a known and an unknown number, as the password reset does, so the phone door does not say which numbers have accounts; the account's existence is revealed only after the right code, which is the point where the person has proven they hold the number. (autonomous default)
- Status codes: 202 for a sent code, 401 `code_invalid`, 410 `code_expired` (as the reset's `token_expired`), 429 `too_many_attempts`, 502 `whatsapp_failed`, 503 `maintenance`, 409 `phone_taken` (as `email_taken`), 403 `account_suspended`, 400 `consent_required`. (autonomous default, repo conventions)
- A profile-needed answer is `200 { "next": "profile" }` with the code left live, and the completing call carries the same code with the name and the consent, so "single use" means one session or one account per code. (autonomous default)
- The code is six digits with leading zeros allowed, from a cryptographic random source, and only its hash is stored; the plan decides whether the hash is keyed, given six digits and five attempts. (autonomous default)
- Other countries' numbers are accepted when written with their country code; without one, the number is read as Romanian. (Build brief *(proposed)*, autonomous default)
- A matched account whose number came from `ACCOUNT.phone` does not gain a `whatsapp_phone` identity on sign-in: the match rule finds it each time, and nothing asks for the extra row (Constitution I). (autonomous default)
- Adding or changing a phone number in settings, and codes by SMS, are out of scope (Build brief › Out of scope). AI assistants cannot sign in this way: there is no such role to match.
- The design check of the story's boards (`design.md`) runs with the plan's before-hook: the phone option is not designed, so it is built from the brief inside the existing dialog shape.
- The success criteria's numbers come from the Build brief (5 minutes, 5 attempts, 60 seconds, 5 per hour, 320 px from AGENTS.md); the step counts of SC-001 are a reading of the brief's scenarios, not a measured figure. (autonomous default)

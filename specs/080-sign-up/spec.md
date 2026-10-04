# Feature Specification: Create an account with e-mail and password

**Feature Branch**: `080-sign-up`

**Created**: 2026-10-04

**Status**: Agreed (2026-10-04)

**Input**: User description: "ST-80 Create an account with e-mail and password (Notion story https://app.notion.com/p/3ee607bff0d2813a9bd4d4acd406ca56, epic EP-1 Foundations). Reuse ST-82's argon2id hashing, refresh cookie, Redis attempt limits, JSON-only auth and the sign-in dialog on libs/overlays and taskSave; signing up ends signed in like sign-in. Wire the sign-in dialog's hidden create-account path. Include ST-494's sign-up 'e-mail taken' end-to-end flow."

**Sources**: Notion story ST-80 (https://app.notion.com/p/3ee607bff0d2813a9bd4d4acd406ca56), read 2026-10-04, no open discussions; its Build brief (current as of 2026-10-03) wins over the criteria above it. Foundations build-timeline row https://app.notion.com/p/3ee607bff0d281138985fa9c4da465b7 (lane C · Auth, W4, 5 points; "createAccount first; ST-132 adds the terms tick to this form"). Debt task ST-494 (https://app.notion.com/p/3ef607bff0d2819faf63ebbbbeb59415): the end-to-end flow "sign up with an e-mail that is taken; the error shows next to the button and the typed name stays". Blockers merged: ST-79 (account model, `AccountsService.createAccount`), ST-82 (sign-in, sessions, PR #45), ST-157 (overlays), ST-159 (`taskSave`). Design: `design.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a driver account from the sign-in dialog and land signed in (Priority: P1)

A visitor opens "Autentificare", taps "Creează un cont" next to "Ești nou pe MotorFix?", and the dialog becomes "Cont nou" with "Nume", "E‑mail" and "Parolă". They fill them in and tap "Creează contul". A driver account is created, they are signed in, and the driver dashboard opens.

**Why this priority**: everything a driver does later needs an account; until now only seeded accounts exist.

**Independent Test**: from a public screen, open the dialog, switch to sign-up, create an account with a new e-mail, read the address the browser ends on and "who am I".

**Acceptance Scenarios**:

1. **Given** the sign-in dialog, **When** the visitor taps "Creează un cont", **Then** the dialog titled "Cont nou" shows "Nume", "E‑mail" and "Parolă", the button "Creează contul", and "Ai deja cont? Intră în cont"; the e-mail already typed stays.
2. **Given** the sign-up dialog, **When** "Intră în cont" is tapped, **Then** the sign-in dialog shows again with the e-mail typed so far.
3. **Given** the name "Andrei Marin", a new e-mail and a valid password, **When** "Creează contul" is tapped, **Then** an account is created with the role `driver` only, a `password` identity, the interface language and the last role `driver`; Andrei is signed in and `/app/driver` opens.
4. **Given** the account was just created, **When** the page is reloaded, **Then** Andrei is still signed in (the same session as sign-in).
5. **Given** a signed-in person, **When** they choose "Autentificare" or "Cont", **Then** their dashboard opens and no dialog does (unchanged from sign-in).

---

### User Story 2 - A taken e-mail, a weak password or a bad form says so (Priority: P1)

**Why this priority**: a sign-up that fails silently or loses the typed text is abandoned.

**Independent Test**: call sign-up with a taken e-mail (any letter case), a short password, a common password, an empty body, and eleven attempts from one address within an hour; drive the dialog with an empty form, a bad e-mail and a short password.

**Acceptance Scenarios**:

1. **Given** an e-mail that already has an account, in any letter case, **When** submitted, **Then** "Există deja un cont cu acest e‑mail." ("An account with this e-mail already exists.") shows next to the button, the typed name and e-mail stay, and nothing is created.
2. **Given** a password shorter than 8 characters, **When** "Creează contul" is tapped, **Then** the field says it needs at least 8 characters and nothing is sent.
3. **Given** a password of 8 or more characters that is on the list of common passwords, **When** submitted, **Then** the password field says to choose one that is harder to guess, and nothing is created.
4. **Given** an empty name, e-mail or password, or an e-mail without "@" and a domain, **When** "Creează contul" is tapped, **Then** each field says what is missing, nothing is sent, and the focus goes to the first wrong field.
5. **Given** a request is on its way, **When** the button is tapped again, **Then** nothing more is sent; the button shows progress and is disabled.
6. **Given** one network address has tried to sign up 10 times within an hour, **When** it tries again, **Then** it is refused with "Prea multe încercări. Încearcă din nou peste o oră." ("Too many attempts. Try again in an hour.").
7. **Given** maintenance mode is on, **When** sign-up is tried, **Then** it is refused with the shared maintenance message.
8. **Given** the device is offline, **When** "Creează contul" is tapped, **Then** the shared offline message shows and the typed text stays.

---

### Edge Cases

- The e-mail is typed with capitals or surrounding spaces: it is trimmed and stored lower-case, so "Andrei@Example.test" and "andrei@example.test" are one address.
- Two sign-ups for one new e-mail at the same moment: one account is created, the other answers `email_taken`.
- An e-mail held by a suspended account: the same `email_taken`, never a hint about the account's state. Freeing a deleted account's e-mail is account deletion's (MF-6 edge cases).
- The name has surrounding spaces: it is trimmed; a name that is only spaces is empty.
- A body that tries to choose a role, a status or any field the endpoint does not take: 400, nothing created.
- Redis cannot be reached: sign-up works without the limit, and the failure is logged.
- The dialog is closed while the sign-up is on its way: the account may be created, but nothing navigates (as sign-in).
- The fields changed and the dialog is closed: the shared overlay asks before discarding (ST-157); switching between sign-in and sign-up does not ask, it carries the e-mail.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /api/v1/auth/sign-up` MUST take a name, an e-mail, a password and the interface language (`ro` or `en`); it MUST create, through the one `createAccount` use case, an account holding only the role `driver`, a `password` identity with the argon2id hash of the password, that language and the last role `driver`, with its audit entry and `account.created` event in the same transaction.
- **FR-002**: A successful sign-up MUST answer 201 with an access token for the role `driver` in the body and set the refresh-token cookie of a new remembered session family, exactly as a remembered sign-in does, and set the account's last active time.
- **FR-003**: The e-mail MUST be trimmed and stored lower-case; an e-mail that already belongs to any account, compared without regard to case and whatever that account's state, MUST answer 409 `email_taken` with the same body every time, and create nothing — also when two sign-ups for one e-mail race.
- **FR-004**: The password MUST be 8 to 128 characters (code points) and not on the list of common passwords (compared without regard to case); otherwise the answer MUST be 400 `weak_password` with a field error on `password`, and nothing is created.
- **FR-005**: A body without a name, an e-mail or a password, with values that are not text, with a name that is not 2 to 80 characters once trimmed, an e-mail longer than 254 characters or without text, "@" and a domain with a dot, control characters in the name or the e-mail, a language other than `ro` or `en`, or any other field, MUST answer 400; a sign-up or a sign-in not sent as JSON (a form post, a text body) MUST be refused with 415 before its body is checked, and no key naming the prototype chain (`__proto__`, `constructor`, `prototype`) is accepted (400); neither sets a cookie.
- **FR-006**: Sign-up attempts with a valid body MUST be counted per network address in Redis; once an address has 10 within its hour, every further attempt from it MUST be refused with 429 `too_many_attempts` before anything is checked, until the hour that began with its first counted attempt ends. An address MUST count as one client however it is written — an IPv4 address also in its IPv4-mapped IPv6 form, an IPv6 address in any spelling, grouped by its /64 — for this limit and for sign-in's per-address count alike. When Redis cannot be reached or does not answer within 2 seconds, sign-up MUST proceed without the limit and log the failure.
- **FR-007**: While maintenance mode reads as on, sign-up MUST answer 503 `maintenance` and create nothing.
- **FR-008**: The password MUST never be logged; a refused sign-up MUST be logged with its code and no name, e-mail, password or address, and a created account with no personal data.
- **FR-009**: The sign-in dialog MUST show "Ești nou pe MotorFix?" and the button "Creează un cont" under its main button; it MUST open the sign-up dialog — the shared `dialog` shape titled "Cont nou", "MotorFix" and the driver blurb under the title, "Nume", "E‑mail", "Parolă" with a show/hide control, the main button "Creează contul", and "Ai deja cont?" with "Intră în cont", which opens the sign-in dialog again. Each switch MUST carry the typed e-mail and MUST NOT ask before discarding.
- **FR-010**: Before sending, the sign-up dialog MUST check, through the shared task saving of `libs/overlays`, that the name has 2 to 80 characters, the e-mail is filled in and looks like an address, and the password has 8 to 128 characters; each problem MUST show under its field, tied to it by `aria-describedby`, with the focus on the first wrong field.
- **FR-011**: While a sign-up is on its way the main button MUST be disabled and show progress, and a second tap MUST send nothing.
- **FR-012**: The dialog MUST show the message for the answer's code in the person's language — `email_taken` and `too_many_attempts` (its own texts), `weak_password` under the password field, and the shared texts for `maintenance`, offline, a failed call and any other code — in a region screen readers announce; the typed name, e-mail and password MUST stay.
- **FR-013**: After a successful sign-up the dialog MUST close and the driver landing `/app/driver` MUST open, in the interface language; the dialog MUST resolve with "signed in" like the sign-in dialog, so whoever opened it can go back to the action that asked for an account.
- **FR-014**: Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011, and text the person typed MUST never be shown back as markup.

### Key Entities

- **Account** (exists, ST-79): gains nothing; sign-up writes ACCOUNT, ACCOUNT_ROLE `driver`, ACCOUNT_IDENTITY `password` and REFRESH_TOKEN.
- **Sign-up attempt counter** (Redis, not a table): attempts per hashed network address, expiring an hour after the first.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014
- **Modifies**: 082-FR-013 → FR-009; 082-FR-011 → FR-005 (any non-JSON body is a 415, before validation); 082-FR-005 → FR-006 (one key per client address)
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A visitor creates a driver account from the dialog on a public screen and lands on `/app/driver` signed in, in one submit (end to end).
- **SC-002**: A taken e-mail in another letter case, a short password, a common password and a racing duplicate create nothing (API test, 4 of 4).
- **SC-003**: The eleventh sign-up attempt from one address within an hour is refused (API test).
- **SC-004**: The sign-up dialog passes the automated accessibility check with no violations at 320 px, 390 px, 820 px and 1440 px, light and dark, Romanian and English (assumption: the axe-core check the e2e suite already runs).

## Clarifications

### Session 2026-10-04

- Q: Is the sign-up limit 10 attempts an hour per network address (the Build brief's *proposed* value)? → A: Yes, unchanged. (owner's decision, 2026-10-04)
- Q: How is "one network address" keyed, when the same client can arrive as `198.51.100.7`, `::ffff:198.51.100.7` or an IPv6 address spelled several ways? → A: One key per client: IPv4-mapped forms fold to IPv4, IPv6 is canonicalised and grouped by its /64 (one subscriber's usual allocation), for sign-up and sign-in alike; otherwise the 10 could be doubled, or multiplied by 2^64 on IPv6 (FR-006). (autonomous, from test-adversary's findings)
- Q: Does a form post with unrelated fields get 415 or 400? → A: 415: the JSON check is a guard that answers before the body is validated, for sign-in too, so every non-JSON body is refused the same way; prototype-chain keys are refused with 400 (FR-005). (autonomous, from test-adversary's findings)
- Q: When the visitor switches sign-in → sign-up and then creates an account, what does the opener's promise resolve with? → A: One entry (`SignInDialog.start`) owns the loop: a task that closes with a switch makes it open the other task, carrying the e-mail; the opener's promise resolves "signed in" or "cancelled" only from the last task (FR-009, FR-013). (autonomous, recommended by spec-challenger)
- Q: In what order are a sign-up's checks made, and which count toward the limit? → A: 415 → 400 (body) → count and 429 → 503 → `weak_password` → `email_taken` → create; every request that passes the body check is counted, whatever its answer (FR-006). (autonomous, recommended)
- Q: A taken e-mail and a weak password together? → A: `weak_password` first: it needs no database read and is fixed in place; `email_taken` only for an otherwise acceptable body (FR-003, FR-004). (autonomous, recommended)
- Q: Is `language` required? → A: Yes; the client always knows its language, and a missing one is a 400 like any missing field (FR-005). (autonomous, recommended)
- Q: The dialog closes while a sign-up is on its way and the answer then lands? → A: The session is kept (token, then "who am I"), since the cookie is already set; only the navigation is skipped, as sign-in does. (autonomous, recommended)
- Resolved from the challenge and context.md without a question: password length is counted in code points on the server, which is the authority (the client's `minlength` counts UTF-16 units and only pre-checks); the common-password list is `common-passwords.ts` in `libs/domain` with its source named; only the e-mail moves between sign-in and sign-up, never the password or the name; SC-004's sizes are the sign-in suite's (320, 390, 820 and 1440 px); the session is issued after the account's transaction commits, as sign-in issues it, so a session failure answers 500 and leaves the account; a suspended account's e-mail answers `email_taken`, and a deleted account's e-mail is freed by account deletion (ST-129 removes the personal fields, MF-6), not here.

## Assumptions

- Revealing that an e-mail is taken is the Build brief's own scenario 4 (`email_taken`, "Există deja un cont cu acest e-mail."), so sign-up does tell whether an address has an account; the per-address limit of 10 an hour (Build brief, *proposed*) is what keeps that from being a cheap way to list accounts, together with sign-in's own limits. The answer never says more than "taken": not the account's state, role or name. (autonomous default)
- The terms tick, the consent row and `consent_required` are ST-132's (timeline ordering note: "createAccount first; ST-132 adds the terms tick to this form"). (autonomous default)
- The confirmation e-mail (scenario 6) belongs to the story "Confirm my e-mail address" (https://app.notion.com/p/3ee607bff0d281fbb2b2ed051f341579); `account.created` is recorded for it, and no e-mail is sent here. (autonomous default)
- "Am un service" and the driver/garage switch are not shown: public sign-up creates drivers only (superseded 2026-10-03), and List your garage has no route and its button no design yet ("the button to List your garage is not designed", Screens); the brief's scenario 3 and its end-to-end check wait for the story that builds List your garage. This deviates from scenario 3 and is named in the PR and in a comment on the story. (autonomous default)
- Until ST-132 adds the terms tick, sign-up creates accounts without a consent row, against MF-6 rule 17 ("consent is required on every path that creates an account"); the timeline's ordering note (2026-10-04) accepts that gap for the time between the two stories. (autonomous default)
- The common-password list is a short list kept in the domain library — the passwords of 8 or more characters that lead the public breach lists, plus Romanian ones built on "parola" and "motorfix" — not a download or a breach service (Principle I; no new dependency). (autonomous default)
- The client's "at least 8 characters" message is the shared `minlength` text ("Scrie cel puțin 8 caractere.") rather than the brief's *proposed* "Parola trebuie să aibă cel puțin 8 caractere.": the shared task saving words a message by its validator, and the name's 2-character minimum uses the same validator. (autonomous default)
- A new account's session is remembered (30 days), the sign-in default; the sign-up mode has no "Ține‑mă autentificat" row (mock). (autonomous default)
- Every sign-up attempt with a valid body counts toward the hourly limit, whether it creates an account or not, so `email_taken` answers are limited too; the window is fixed, starting at the first counted attempt. (autonomous default)
- Switching between sign-in and sign-up closes one task and opens the other, carrying the e-mail, instead of retitling one open dialog: the shared overlay takes its title at open, and ST-158 is reworking `libs/overlays` now. (autonomous default)
- "Reset the password" next to `email_taken` is not shown: that flow does not exist yet ("Reset a forgotten password", https://app.notion.com/p/3ee607bff0d2810a99fffb2a805dc619), and "Intră în cont" sits just under the button, carrying the e-mail. (autonomous default)
- The sign-up dialog is opened from the sign-in dialog only; there is no separate "Creează un cont" entry on the public screens yet (design.md). (autonomous default)

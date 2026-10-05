# Feature Specification: Reset a forgotten password

**Feature Branch**: `127-password-reset`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-127 Reset a forgotten password (Notion story https://app.notion.com/p/3ee607bff0d2810a99fffb2a805dc619, epic EP-1 Foundations). \"Ai uitat parola?\" in the sign-in dialog: the person enters an e-mail, gets a link in their language, sets a new password, and is signed in. The old password stops working and every other session of the account ends."

**Sources**: Notion story ST-127 (https://app.notion.com/p/3ee607bff0d2810a99fffb2a805dc619), read 2026-10-05; its Build brief (current as of 2026-10-03) wins over the criteria above it. Blockers on the Foundations build timeline, all Merged: ST-82 "Sign in with e-mail and password" (the dialog, sessions, refresh-token families), ST-194 "Set up e-mail sending" (the `notifications` queue, `ACCOUNT_EMAIL`), ST-195 "Set up message templates" (`ACCOUNT_EMAIL.password_reset` in Romanian and English). Epic: https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707.

**Built on**: ST-81 "Confirm my e-mail address" (in flight, PR #71) adds the `account_token` table (single-use link tokens stored as SHA-256 hashes, by purpose) and its token helpers; this story adds the `password_reset` purpose to it rather than a second table (Principle I).

## Clarifications

### Session 2026-10-05

- Q: Which calls does the web app make, given the link page must say "Linkul a expirat" when it is opened (scenario 6), before any password is typed? → A: Three public JSON calls under `/api/v1/auth/password-reset`: `POST` with `{ email }` asks for a link and always answers 202; `POST …/check` with `{ token }` answers 204 for a link that still works, 410 otherwise; `POST …/complete` with `{ token, password }` sets the password and answers 200 with a session, exactly as sign-in does (cookie included).
- Q: What does the reset answer for a link that is not valid, given the Build brief names `token_invalid` and `token_expired`? → A: Both are 410. `token_expired` for a link that was issued for this purpose but is used or older than 60 minutes; `token_invalid` for anything else (malformed, never issued, voided by a newer link, another purpose, an account no longer active). The screen shows "Linkul a expirat" for both.
- Q: Which accounts get a link? → A: An active account whose e-mail matches (trimmed, lower case). A suspended or deleted account, or an unknown address, gets nothing and the same answer. An active account with no `password` identity (Google, Apple, phone) and an e-mail gets one too; completing it adds the `password` identity (Build brief, *(proposed)*).
- Q: What does "the role used last opens" mean in a dialog over Home? → A: The session is opened with the account's last role, the "Keep me signed in" lifetime (30 days), and the web app navigates to that role's landing, as sign-in does.
- Q: What does the audit entry look like, given the actions are create/update/delete/open? → A: One `update` entry on subject `account` (the account itself), actor = the account with its last role, field `password`, kind `password_reset`, no old or new value — written in the transaction that replaces the password and revokes the sessions.
- Q: In which order does the complete call judge its input, given an expired link with a weak password could answer either 410 or 400? → A: The body's shape (400 `validation_failed`), then the token (410), then the maintenance rule of sign-in (503 `maintenance` for a non-admin account while it is on), then the password's strength (400 `weak_password`). Nothing is written before all four pass, and a weak password is refused before any hashing.
- Q: Which e-mail is counted by the request limit, and do malformed requests count? → A: The trimmed, lower-cased address that FR-002 matches, as a SHA-256 digest; a request refused with 400 is not counted. One new method on the existing `Attempts`, a 60-minute window.
- Q: What happens when the account's last role is no longer one of its roles, which sign-in refuses? → A: The same rule as sign-in (`roleInUse`): no usable role makes the token `token_invalid` on check and complete, and nothing changes.
- Q: How do two completes of one link at once leave one winner? → A: The token is taken by a conditional write (`used_at` still empty → set); the call that finds it taken answers 410 `token_expired` and rolls back. A failure after the commit (opening the session) answers 5xx; the password stays changed and the new one signs in.
- Q: What do the account's open dashboards do on `session.revoked` now that a reset sends it, given ST-128 has them sign out "as Ieși din cont does", which calls sign-out with the browser's cookie and tells the other tabs? → A: They forget the session locally and open Home, asking the server nothing and telling no tab: the server already ended every session, and in the browser where the reset happened that cookie now holds the new session, which an old tab's sign-out would end (FR-013, modifying ST-128's FR-009; the outcome of "all devices" is unchanged).
- Q: Does an account whose e-mail is not yet confirmed (ST-81) get a link, and does a reset confirm the address? → A: It gets a link (only the status filters); the reset does not touch the confirmation, which is ST-81's.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask for a reset link (Priority: P1)

Andrei forgot his password. In the sign-in dialog he taps "Ai uitat parola?", types his e-mail and taps "Trimite linkul". The dialog says the same thing whether or not an account uses that address, and an e-mail with a link valid 60 minutes reaches him in his account's language.

**Why this priority**: without the link nothing else of the story can happen; it is the story's first two acceptance criteria.

**Independent Test**: open the sign-in dialog, tap "Ai uitat parola?", send an address; the neutral message shows; for an existing account one `ACCOUNT_EMAIL` `password_reset` notification is queued in the account's language with a `/{lang}/reset-password/<token>` link; for an unknown address none is.

**Acceptance Scenarios**:

1. **Given** the sign-in dialog, **When** "Ai uitat parola?" is tapped, **Then** the dialog shows one field "E-mail" (holding what was typed in sign-in) and the button "Trimite linkul".
2. **Given** any well-formed e-mail, **When** it is sent, **Then** the dialog shows "Dacă există un cont cu această adresă, ți-am trimis un link." whether or not an account exists.
3. **Given** an active account uses the address, **Then** `ACCOUNT_EMAIL` `password_reset` is queued for it, in its language, with a link valid 60 minutes; any older unused reset link of the account stops working.
4. **Given** more than 3 requests in an hour for one e-mail, or 10 from one IP address, **When** another is sent, **Then** the same answer shows and nothing is sent.

---

### User Story 2 - Set a new password from the link (Priority: P1)

Andrei opens the link. The dialog over Home asks for a new password. He saves one of 8 to 128 characters; his old password stops working, every other session of his account ends, he is signed in on this device and his dashboard opens. An e-mail tells him his password was changed.

**Why this priority**: it is the point of the story (acceptance criterion 3).

**Independent Test**: request a link for a seeded account, open it, save a new password; the dashboard of the last role opens; signing in with the old password fails with "E-mailul sau parola nu sunt corecte."; the new one works; a refresh token held before the reset no longer renews.

**Acceptance Scenarios**:

1. **Given** a working link, **When** it is opened, **Then** the dialog over Home shows the field "Parolă nouă" and the button "Salvează parola".
2. **Given** the link, **When** a new password of 8 to 128 characters that is not a common one is saved, **Then** the password is replaced (or a `password` identity is added), every refresh token of the account is deleted, the link is used up, the person is signed in on this device and the landing of the role used last opens.
3. **Given** the old password, **When** it is tried afterwards, **Then** "E-mailul sau parola nu sunt corecte." shows.
4. **Given** a password shorter than 8 or longer than 128 characters, or a common one, **When** saved, **Then** it is refused with `weak_password` on the field and nothing changes.
5. **Given** the password changed, **Then** `ACCOUNT_EMAIL` `password_changed` "Parola ta a fost schimbată" is queued for the account, and the account's other open dashboards sign out.

---

### User Story 3 - A link that no longer works (Priority: P2)

Andrei opens an old link, or one he already used. The dialog says "Linkul a expirat" and offers to ask again.

**Why this priority**: the safety of the flow depends on it, but it is a refusal path.

**Independent Test**: open `/ro/reset-password/<a token never issued>`; "Linkul a expirat" shows with "Cere un link nou", which opens the e-mail step.

**Acceptance Scenarios**:

1. **Given** a link that was used, voided or is older than 60 minutes, **When** it is opened, **Then** "Linkul a expirat" shows with the button "Cere un link nou".
2. **Given** "Cere un link nou", **When** it is tapped, **Then** the e-mail step of User Story 1 opens.
3. **Given** a link that stops working while the new-password step is open, **When** the password is saved, **Then** "Linkul a expirat" shows and nothing changes.

### Edge Cases

- Two saves of one link at once: one replaces the password; the other answers `token_expired`.
- An address typed with spaces or capitals finds the same account.
- The e-mail cannot be queued (the queue, Redis or the web address is missing): the same 202 answer; the failure is logged without the address.
- Redis is down: the request limits are skipped, as sign-in's are, and the link is still sent.
- The account was suspended or deleted after the link was sent: the link answers `token_invalid`.
- The link's e-mail address no longer matches the account's: the link answers `token_invalid`.
- The page is opened on the English address `/en/reset-password/<token>`: every text is English.
- A signed-in person opens a reset link: the reset still works; their new session replaces the old one.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /api/v1/auth/password-reset` with a JSON `{ email }` MUST answer 202 with no body for any well-formed address, whether or not an account uses it, and MUST answer 400 `validation_failed` for a missing or malformed one.
- **FR-002**: For an active account whose e-mail matches (trimmed, lower case), the request MUST store a new single-use token (32 random bytes, only its SHA-256 hash kept, purpose `password_reset`, valid 60 minutes), delete the account's older unused `password_reset` tokens, and queue `ACCOUNT_EMAIL` with purpose `password_reset` and the link `{PUBLIC_WEB_URL}/{account language}/reset-password/{token}`. For an unknown, suspended or deleted account it MUST store and queue nothing.
- **FR-003**: Beyond 3 requests in an hour for one e-mail, or 10 in an hour from one client address, a request MUST answer 202 and store and queue nothing; the e-mail counted is the trimmed, lower-cased one, and a 400 is not counted; a down Redis MUST skip the limits, and the counts MUST NOT hold the e-mail or the address in clear.
- **FR-004**: `POST /api/v1/auth/password-reset/check` with `{ token }` MUST answer 204 for a token that would complete, 410 `token_expired` for a `password_reset` token that is used or past its 60 minutes, and 410 `token_invalid` for any other token (malformed, unknown, another purpose, an account not active or with no usable role, an address that changed).
- **FR-005**: `POST /api/v1/auth/password-reset/complete` with `{ token, password }` MUST, for a token that FR-004 would accept and a password of 8 to 128 characters (counted in code points, as sign-up does) that is not a common one, in one transaction: take the token with a conditional write (mark it used only while unused), replace the account's `password` identity hash (or add a `password` identity), delete every refresh token of the account, and write one audit entry (action `update`, subject `account` = the account, actor = the account with its last role, field `password`, kind `password_reset`, no old or new value); then open a session for the account's last role kept for 30 days, set the refresh cookie as sign-in does, and answer 200 with the access token.
- **FR-006**: The complete call MUST judge in this order and change nothing on any refusal: 400 `validation_failed` for a malformed body, then 410 `token_expired` / `token_invalid` for a token FR-004 would refuse, then 503 `maintenance` for a non-admin account while maintenance is on (as sign-in), then 400 `weak_password` (with the field `password`) for a weak password, and of two completes of one token at once only one MUST change the password.
- **FR-007**: After a completed reset, the API MUST queue `ACCOUNT_EMAIL` with purpose `password_changed` for the account and publish a `session.revoked` live event to `account:{accountId}`; a failure of either MUST be logged and MUST NOT change the answer.
- **FR-008**: `ACCOUNT_EMAIL.password_changed` MUST exist in Romanian and English: subject "Parola ta a fost schimbată" / "Your password was changed", a line saying so, a button to MotorFix and a reason line telling the holder to reset it again if it was not them.
- **FR-009**: The sign-in dialog MUST show "Ai uitat parola?" / "Forgot your password?" next to "Ține-mă autentificat"; tapping it MUST replace sign-in with the reset task, carrying the typed e-mail.
- **FR-010**: The reset task MUST show the field "E-mail" and the button "Trimite linkul" / "Send the link"; after a 202 it MUST show "Dacă există un cont cu această adresă, ți-am trimis un link." / "If an account uses this address, we have sent a link." and a button "Înapoi la autentificare" / "Back to sign in" that returns to sign-in with the e-mail.
- **FR-011**: `/{lang}/reset-password/:token` MUST show Home with the dialog over it; the dialog MUST check the token (FR-004) and show either the field "Parolă nouă" / "New password" with "Salvează parola" / "Save the password", or "Linkul a expirat" / "The link has expired" with "Cere un link nou" / "Ask for a new link", which opens the reset task.
- **FR-013**: On a `session.revoked` live message a dashboard MUST forget the tab's session, close its live connection and open Home without calling sign-out and without telling the browser's other tabs: the server already ended the session, and a sign-out sent with the browser's cookie could end the session a password reset just started in another tab of the same browser.
- **FR-012**: Saving a new password that completes MUST sign the tab in with the answer's session and open the landing of its role; a `token_expired` or `token_invalid` answer MUST switch the dialog to "Linkul a expirat"; `weak_password` MUST show under the field.

### Key Entities

- **Account token** (from ST-81, `account_token`): a single-use link, its SHA-256 hash, purpose, the address it was sent to, expiry and use; this story adds the purpose `password_reset`.
- **Password identity** (existing, `account_identity` with method `password`): its hash is replaced or it is added.
- **Refresh token** (existing): deleted for the whole account by a completed reset.
- **Audit entry** (existing): one per completed reset, without any password data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a completed reset, the old password never signs in and the new one does (story acceptance criterion 3).
- **SC-002**: The request answer for an unknown address and for an existing one is the same status and body (Build brief scenario 2).
- **SC-003**: A link more than 60 minutes old, or used once, never changes a password (Build brief scenarios 3 and 6).
- **SC-004**: The reset e-mail is in the account's language (story acceptance criterion 4).

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013
- **Modifies**: none

FR-013 narrows ST-128's FR-009, which `accounts.md` does not hold yet (ST-128 is not archived); its archive takes FR-013's wording.
- **Removes**: none

## Assumptions

- (autonomous default) The three calls and their shapes are as in Clarifications Q1; the check call exists so that scenario 6 holds when the link is opened.
- (autonomous default) FR-001 fixes the answer's body, not its timing: a known address also writes the token and queues the e-mail before the 202, so response time can hint that an account exists. Accepted for now (the per-address and per-e-mail limits of FR-003 cap how often anyone can ask); answering before the work is recorded in `deferred.md`.
- (autonomous default) The reset task's title is "Resetează parola" / "Reset your password"; the link page's dialog title is "Parolă nouă" / "New password"; the English texts are this run's, the Build brief gives only the Romanian.
- (autonomous default) `password_changed`'s button is "Intră în cont" / "Sign in" and opens `{PUBLIC_WEB_URL}/{language}`.
- (autonomous default) Every request counts against its client address and its e-mail digest, sent or not, so the limit cannot be used to learn whether an account exists.
- (autonomous default) The request does its database work only for an existing account; the difference in answer time is accepted, as sign-up's "address taken" already reveals an account.
- (autonomous default) The request and check calls ignore the maintenance flag; the complete call applies sign-in's rule (the flag reads off until ST-261 exists).
- (autonomous default) Neither check nor complete has its own rate limit: a 256-bit token cannot be guessed, and a weak password is refused before any hashing.
- `ACCOUNT_EMAIL` is a direct, transactional notification that cannot be turned off (ST-194 catalogue); the link lives in the queued notification's params, as ST-81's confirmation link does.
- Out of scope, per the Build brief: changing the password while signed in, an admin resetting someone's access.

# Feature Specification: Sign in with e-mail and password

**Feature Branch**: `082-sign-in`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-82 Sign in with e-mail and password (Notion story https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908, epic EP-1 Foundations)."

**Sources**: Notion story ST-82 (https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908), read 2026-10-04, no open discussions; its Build brief wins over the criteria above it. Foundations build-timeline row https://app.notion.com/p/3ee607bff0d2811a874be7f55749ed96 (critical path, lane C · Auth, W3, 5 points). Feature MF-6 "Accounts, roles and sign-in" (https://app.notion.com/p/3ee607bff0d28194880afef05a6b30fc) and the Security page (https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3) for the session rules. Sibling ST-128 (sign-out, https://app.notion.com/p/3ee607bff0d2819d83d4c981dc0ac1e7) read for the boundary. Blockers merged: ST-79 (accounts, roles, guards), ST-157 (`libs/overlays`, a27b286), ST-16 (i18n runtime). Design: `design.md` (mock v22, `Overlays.dc.html` sign-in task, `SignIn.dc.html`, `MSignIn.dc.html`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in from the screen I am on and land on my dashboard (Priority: P1)

A visitor with an account taps "Autentificare" on any public screen. A dialog opens over that screen, titled "Autentificare" with the name MotorFix, and the address does not change. They type their e-mail and password and tap "Intră în cont". They are signed in and the dashboard of the role they used last opens.

**Why this priority**: every signed-in feature depends on a real session; until now "who am I" always answers 401.

**Independent Test**: seed one account per role; from a public screen, open the dialog, sign in, and read the address the browser ends on.

**Acceptance Scenarios**:

1. **Given** a visitor on the garages screen on a phone, **When** they tap "Cont", **Then** a dialog opens over the garages screen with the title "Autentificare" and the name MotorFix, and the address stays the same.
2. **Given** a visitor on a tablet or a computer, **When** they press "Autentificare" at the top of a public screen, **Then** the same dialog opens and the address stays the same.
3. **Given** Andrei has a driver account, **When** he enters his e-mail and password and taps "Intră în cont", **Then** he is signed in and `/app/driver` opens.
4. **Given** an account with the roles driver and garage whose last role is `garage`, **When** it signs in, **Then** `/app/garage` opens.
5. **Given** a garage owner, a receptionist or a mechanic signs in, **Then** `/app/garage` opens (the receptionist's menu without settings, prices or team; the mechanic's menu with only what their permissions allow); **Given** an admin signs in, **Then** `/app/admin` opens.
6. **Given** a signed-in person, **When** they choose "Autentificare" or "Cont", **Then** their dashboard opens instead of the dialog.
7. **Given** nobody is signed in, **When** a dashboard address is typed, **Then** Home opens with the sign-in dialog over it; after signing in, the person's own dashboard opens.

---

### User Story 2 - A wrong password, an unknown e-mail or a bad form says so, and nothing more (Priority: P1)

Whatever is wrong with the credentials, the dialog shows one message, "E‑mailul sau parola nu sunt corecte.", and the typed e-mail stays. An empty or malformed field is pointed out before anything is sent. Repeated failures are slowed down: after 5 failures for one e-mail within 15 minutes, sign-in for that e-mail is refused for 15 minutes; one address that fails too often is refused too.

**Why this priority**: the message must not tell an attacker which e-mails have accounts, and the limits are the defence against guessing (Security page, "Stolen sign-in").

**Independent Test**: call sign-in with a wrong password, an unknown e-mail, an account with no password, and six failures in a row; read the status, the problem code and the time each answer took.

**Acceptance Scenarios**:

1. **Given** a wrong password or an unknown e-mail, **When** submitted, **Then** the same message shows, "E‑mailul sau parola nu sunt corecte." ("The e-mail or password is not correct."), and the typed e-mail stays.
2. **Given** an account that has no password (only another sign-in method), **When** someone tries e-mail and password, **Then** the same message shows.
3. **Given** 5 failed attempts for one e-mail within 15 minutes, **When** a sixth is tried, even with the right password, **Then** it is refused for 15 minutes with "Prea multe încercări. Încearcă din nou în 15 minute." ("Too many attempts. Try again in 15 minutes.").
4. **Given** one network address has failed 20 times within 15 minutes, **When** it tries again with any e-mail, **Then** it is refused the same way.
5. **Given** an empty e-mail, an e-mail without an "@" and a domain, or an empty password, **When** "Intră în cont" is tapped, **Then** the field says what is missing, nothing is sent, and the focus goes to the first wrong field.
6. **Given** a suspended account with the right password, **When** it signs in, **Then** it is refused with "Contul tău este suspendat." ("Your account is suspended.").
7. **Given** the device is offline, **When** "Intră în cont" is tapped, **Then** "Nu ești conectat. Încearcă din nou când revine conexiunea." ("You are offline. Try again when the connection is back.", ST-159's shared text) shows and the typed text stays.
8. **Given** a request is on its way, **When** the button is tapped again, **Then** nothing more is sent; the button shows progress and is disabled.

---

### User Story 3 - The session survives a reload and, when asked, a closed browser (Priority: P1)

The access token lives only in the page's memory for 15 minutes; a refresh token in a cookie the page cannot read renews it. Reloading a dashboard keeps the person signed in. With "Ține-mă autentificat" ticked (the default) the session also survives closing the browser for 30 days of use; unticked, it ends when the browser closes. A refresh token that is used twice closes its whole session family.

**Why this priority**: without renewal every reload or every 15 minutes would sign the person out.

**Independent Test**: sign in, reload, read "who am I"; expire the access token and call a protected endpoint; replay an old refresh token and try the new one.

**Acceptance Scenarios**:

1. **Given** a signed-in person on their dashboard, **When** they reload the page, **Then** they are still signed in on the same dashboard.
2. **Given** "Ține-mă autentificat" was ticked, **When** the browser is closed and reopened within 30 days, **Then** the person is still signed in; **Given** it was unticked, **Then** the session ends when the browser closes.
3. **Given** the access token has expired, **When** the app calls the API, **Then** it renews the token once and repeats the call without the person noticing.
4. **Given** a refresh token that was already used, **When** it is presented again, **Then** every token of its family stops working and that session is signed out everywhere it was copied.
5. **Given** two tabs renewing at the same moment, **When** the second presents the token the first just rotated, **Then** it gets a new access token too, its cookie is left as the first answer set it, and the family stays open.

---

### User Story 4 - "Ieși din cont" really signs out on this device (Priority: P2)

Now that a session survives a reload, "Ieși din cont" at the bottom of the dashboard menu must end it on the server and clear the cookie, or the next reload would sign the person back in.

**Why this priority**: the frame's existing sign-out only forgot the session in memory, which is no longer enough.

**Independent Test**: sign in, sign out, reload; present the old refresh token.

**Acceptance Scenarios**:

1. **Given** a signed-in person, **When** they tap "Ieși din cont", **Then** Home opens, and reloading or typing a dashboard address does not sign them back in.
2. **Given** a session that already expired, **When** "Ieși din cont" is tapped, **Then** the local session is still cleared and Home opens; signing out twice is harmless.

---

### User Story 5 - Maintenance keeps the admin door open (Priority: P3)

While maintenance mode is on, only an account holding `admin` signs in; everyone else gets the downtime message. The switch arrives with ST-261; until then maintenance reads as off.

**Why this priority**: no switch exists yet, but the sign-in use case is where the rule lives.

**Independent Test**: with maintenance read as on, sign in as an admin and as a driver.

**Acceptance Scenarios**:

1. **Given** maintenance mode is on, **When** a driver, a garage owner, a receptionist or a mechanic signs in with the right password, **Then** it is refused with "MotorFix este în mentenanță. Încearcă din nou puțin mai târziu." ("MotorFix is down for maintenance. Try again a little later.").
2. **Given** maintenance mode is on, **When** an admin signs in, **Then** it works.

---

### Edge Cases

- The e-mail is typed with capitals or surrounding spaces: it is trimmed and compared case-insensitively.
- An unknown e-mail takes as long to answer as a known one with a wrong password: the password check runs either way (tested by the check running, not by a clock).
- A deleted account signs in: the "not correct" message, never a hint that it existed.
- The correct password while the e-mail is locked out: still refused until the 15 minutes pass.
- A successful sign-in clears the e-mail's failure count; the address count is not cleared by it.
- The counter store (Redis) is unreachable: sign-in still works without the limits, and the failure is logged (PostgreSQL is the truth; emptying Redis loses nothing).
- A refresh token that expired, was revoked, or was never issued: 401 `sign_in_required`, and the cookie is cleared.
- An account suspended while signed in: its next renewal answers 403 `account_suspended` and the app signs out.
- A role removed so that the account holds none: the guard already answers 401 (ST-79); renewal answers 401 too.
- A sign-in or renewal while the dialog is closed half-way: the result is ignored, nothing navigates.
- The dialog's fields changed and it is closed: the shared overlay asks before discarding (ST-157).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /api/v1/auth/sign-in` MUST take an e-mail (trimmed, compared lower-case), a password and "keep me signed in" (true by default); with the right credentials it MUST answer an access token for the account's role in use (signed as ST-79's guard checks, valid 15 minutes) in the body, set the refresh token cookie, open a new refresh-token family, and set the account's last active time.
- **FR-002**: A wrong password, an unknown e-mail, an account with no password identity and a deleted account MUST all answer 401 with code `invalid_credentials` and the same body, and the password check MUST run in every case (against a fixed decoy hash when there is no account), so the answer does not reveal whether the e-mail exists.
- **FR-003**: Passwords MUST be checked against an argon2id hash in PHC string form; the comparison MUST be constant-time.
- **FR-004**: The right password for a suspended account MUST answer 403 `account_suspended`.
- **FR-005**: Failed attempts MUST be counted per e-mail and per network address in Redis; only an `invalid_credentials` answer counts, and each counted failure restarts the key's 15 minutes. Once an e-mail has 5 counted failures, or an address 20, every attempt for that e-mail or from that address MUST be refused with 429 `too_many_attempts` before the password is checked, without being counted, until 15 minutes after the last counted failure. Only a successful sign-in (200) MUST clear the e-mail's count; 400, 403 and 503 answers neither count nor clear. When Redis cannot be reached or does not answer within 2 seconds, sign-in MUST proceed without the limits and log the failure.
- **FR-006**: While maintenance mode reads as on, a sign-in with the right credentials by an account not holding `admin` MUST answer 503 `maintenance`; an admin MUST sign in. Maintenance MUST read as off until the platform rule exists.
- **FR-007**: The refresh token MUST be a random value stored only as its hash, sent in a cookie that is `HttpOnly`, `Secure`, `SameSite=Strict` and scoped to `/api/v1/auth`; with "keep me signed in" it MUST carry a 30-day lifetime and the server MUST accept it for 30 days from its issue; without, it MUST be a browser-session cookie the server accepts for 12 hours from its issue. Every token issued by renewal keeps its family's choice.
- **FR-008**: `POST /api/v1/auth/refresh` MUST, for a valid unused token of an active account, mark it used, issue its successor in the same family (new cookie), and answer a new access token for the role in use; it MUST update the last active time at most once an hour. An unknown, expired or revoked token MUST answer 401 `sign_in_required` and clear the cookie (only a refusal clears it: a server error, such as the database being unreachable, keeps the cookie); for a suspended account (403 `account_suspended`), a deleted account or an account holding no role (401 `sign_in_required`) it MUST also revoke the family and clear the cookie.
- **FR-009**: A refresh token presented again after it was used MUST revoke every token of its family and answer 401 `sign_in_required`, unless it was rotated less than 20 seconds earlier (two tabs renewing at once), which MUST answer a new access token like a rotation does, without a new cookie and without revoking anything.
- **FR-010**: `POST /api/v1/auth/sign-out` MUST revoke the family of the presented refresh token, clear the cookie and answer 204, also when no or an unknown token is presented.
- **FR-011**: A sign-in body without an e-mail or a password, with values that are not text, or with an e-mail holding control characters MUST answer 400 with the validation problem; a sign-in that is not sent as JSON MUST be refused (415 for a form post) without a cookie, so another site cannot sign the browser into an account it chose; the password MUST never be logged, and a failed attempt MUST be logged with its reason and no e-mail, password or address.
- **FR-012**: Signed out, the "Cont" tab of the phone tab bar and an "Autentificare" button at the top of every public screen on tablets and computers (≥ 768 px) MUST open the sign-in dialog over the current screen without changing the address; signed in, both MUST open the person's dashboard.
- **FR-013**: The dialog MUST be the shared overlay's `dialog` shape titled "Autentificare" with the name MotorFix under it, and hold "E‑mail" (placeholder "tu@exemplu.ro"), "Parolă" (placeholder "Parola ta"), "Ține‑mă autentificat" ticked by default, and the main button "Intră în cont"; it MUST NOT show the controls of flows not built yet (Apple, Google, "Ai uitat parola?", "Creează un cont", the driver/garage switch).
- **FR-014**: Before sending, the dialog MUST check that the e-mail is filled in and looks like an address (text, "@", a domain with a dot) and that the password is filled in, through the shared task saving of `libs/overlays`; each problem MUST show under its field, be tied to the field by `aria-describedby`, and move the focus to the first wrong field.
- **FR-015**: While a sign-in is on its way the main button MUST be disabled and show progress, and a second tap MUST send nothing.
- **FR-016**: The dialog MUST show the message for the answer's code in the person's language — `invalid_credentials`, `too_many_attempts`, `account_suspended`, `maintenance`, offline (no answer while the device reports no connection), and the shared messages for a failed call while online and for any other code — in a region screen readers announce; the typed e-mail MUST stay, and the password MUST be cleared after `invalid_credentials`.
- **FR-017**: After a successful sign-in the dialog MUST close and the role's landing (`/app/driver`, `/app/garage` for garage owner, receptionist and mechanic, `/app/admin`) MUST open, in the account's language.
- **FR-018**: The web app MUST hold the access token in memory only and send it as a bearer token on every API call except the three `auth` calls; on a 401 from a call that carried the token it MUST renew once (one renewal shared by concurrent calls) and repeat the call, and when renewal fails forget the token and the "who am I" answer in memory (navigation stays with the guards and FR-020). The sign-in and renewal answers carry only the access token; landing and language come from "who am I".
- **FR-019**: When the app needs the session and holds no access token (a reload, a reopened browser), it MUST renew from the cookie before asking "who am I"; a failed renewal means signed out.
- **FR-020**: "Ieși din cont" MUST call sign-out, forget the session in memory even when the call fails, and open Home.
- **FR-021**: A signed-out visit to `/app/driver`, `/app/garage` or `/app/admin` MUST end on Home with the sign-in dialog open; after signing in, the person's own landing opens (modifies 079-FR-017).
- **FR-022**: Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011, and text the person typed MUST never be shown back as markup.
- **FR-023**: The seed MUST add, outside production, one account per role (driver; garage owner of a seeded garage; receptionist and mechanic of that garage; admin), one driver-and-garage account whose last role is `garage`, and one suspended driver, all with e-mails under `example.test` and the password `parola-de-test` in development and test, which MUST come from `SEED_PASSWORD` in every other environment, an unset or unknown `APP_ENV` included (refused without it); an account whose e-mail exists is left as it is, so running it twice changes nothing.

### Key Entities

- **Refresh token** (exists, ST-79): one rotating session credential; gains whether its family was opened with "keep me signed in".
- **Sign-in attempt counter** (Redis, not a table): failures per e-mail hash and per address, expiring after 15 minutes.
- **Session** (web, memory only): the access token and the "who am I" answer.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023
- **Modifies**: 079-FR-017 → FR-021
- **Removes**: none

### Capability: `phone-layout`

- **Adds**: none
- **Modifies**: 287-FR-006 → FR-012
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person of each of the five roles, and the two-role account, reaches their own dashboard from a public screen in one dialog submit (end to end, 6 of 6).
- **SC-002**: Wrong password, unknown e-mail, no-password account and deleted account give the same status and the same body, and every one of them runs the password check (API test, 4 of 4).
- **SC-003**: The sixth failure for one e-mail within 15 minutes is refused, also with the right password (API test).
- **SC-004**: A reload of a dashboard keeps the person signed in, and a replayed refresh token signs the whole family out (end to end and API test).
- **SC-005**: After "Ieși din cont", a reload opens no dashboard (end to end).
- **SC-006**: The dialog passes an automated accessibility check with no violations at 320 px, 390 px and desktop, in Romanian and English (assumption: the axe-core check the e2e suite already runs).

## Clarifications

### Session 2026-10-04

- Q: What does the server render for a dashboard address, and where does the renewal run? → A: `/app/**` stays client-rendered (ST-79's server routes); the guard runs in the browser and awaits the renewal before deciding. (autonomous, recommended by spec-challenger)
- Q: How does a test turn maintenance on before ST-261? → A: The sign-in use case reads maintenance through one injectable bound to "off", overridden in the tests, as ST-79's audit and event ports are. (autonomous, recommended)
- Q: Which answers count toward the limits, and does a refusal extend the lock? → A: Only `invalid_credentials` counts and restarts the 15 minutes; a 429 is not counted; only a 200 clears the e-mail's count (FR-005). A third party cannot keep an account locked by retrying. (autonomous, recommended)
- Q: Do the sign-in and renewal answers carry the account? → A: No, only the access token; landing and language come from "who am I" (FR-018), one source (Principle V). (autonomous, recommended)
- Q: Is the family revoked when renewal meets a suspended, deleted or role-less account? → A: Yes, and the cookie is cleared (FR-008). (autonomous, recommended)
- Resolved from context.md and the challenge without a question: two tabs renewing at once get a usable answer (Sequence diagrams: hot paths §3) — a new access token, no new cookie, within 20 seconds (FR-009); the offline text is ST-159's shared sentence; the interceptor renews only after a 401 to a call that carried the token (FR-018); any other failure shows one generic message (FR-016) until ST-159's shared errors land; timing equality is tested by the decoy check running (SC-002); the seed inserts missing accounts only and names its password (FR-023); sign-out on this device stays in this story, with its reason recorded under Assumptions (ST-128 keeps all devices and cross-tab); failing open on the limits when Redis is down stays (constitution VI: emptying Redis loses nothing, and a sign-in outage is worse than an unthrottled minute), logged.

## Assumptions

- The Notion texts win where the mock and the brief differ: the dialog's main button is "Intră în cont" and the title "Autentificare" (Build brief), the password label is "Parolă" with "Parola ta" as placeholder (mock, brief lists only "Parola ta"). (autonomous default)
- Apple, Google, "Ai uitat parola?", "Creează un cont" and the driver/garage switch are not shown: each opens a flow another story builds (sign-up ST-80, Google and Apple, password reset, the role switch ST-394), and a control that does nothing is worse than none (Principle I). Each story adds its control. (autonomous default)
- The name MotorFix sits at the top of the dialog body, not in the overlay's header: the shared overlay has a title only, and ST-159 is changing `libs/overlays` now; a subtitle option can move it later. (autonomous default)
- The public screens have no header yet (the desktop header is the Home story's, EP-4), so on ≥ 768 px a small top bar in the public frame holds "Autentificare" until that header exists; on phones the "Cont" tab opens the dialog, as ST-287's Build brief proposed. (autonomous default)
- The bottom sheet on phones is another story; on a phone the dialog keeps ST-157's 16 px gutter. (design.md, ST-157)
- Sign-out on this device is included (User Story 4) because a persistent session makes the existing "Ieși din cont" a lie otherwise; signing out on all devices, the cross-tab sign-out and the settings row stay ST-128's. (autonomous default)
- Scenario 5 of the brief (return to the action that asked for sign-in) belongs to the sign-in gate story; the dialog resolves with "signed in" so that story can resume instead of navigating. (autonomous default)
- The per-address limit is 20 failures in 15 minutes: the Security page asks for one and gives no number; 20 leaves room for carrier-grade NAT, where many phones share one address. (autonomous default, *proposed*)
- A session without "keep me signed in" is accepted by the server for 12 hours from its last renewal, so a restored browser session on a shared computer does not live for 30 days. (autonomous default, *proposed*)
- The 20-second grace for a just-rotated token covers two tabs renewing at once ("a few seconds", Sequence diagrams: hot paths §3); a replay inside it obtains one 15-minute access token but never a refresh token, and a replay after it closes the family. (autonomous default)
- The access token lifetime stays the 15 minutes ST-79's signer already uses; the brief's `ACCESS_TOKEN_MINUTES` is not added as a setting nobody changes (Principle I). (autonomous default)
- argon2id parameters: 19 MiB memory, 2 passes, 1 lane, 16-byte salt, 32-byte tag (OWASP's minimum), with Node's built-in `crypto.argon2` (Node 24, `.nvmrc`), so no new dependency. (autonomous default)
- The network address is the client's, read through the web app's edge proxy, which appends the address it saw to `X-Forwarded-For`; the API trusts only private and loopback hops. (autonomous default)
- Failed attempts are logged as structured log lines (`JsonLogger`); the SYSTEM_LOG_ENTRY table does not exist yet. (autonomous default)
- The generic failure text is "Ceva nu a mers. Încearcă din nou." ("Something went wrong. Try again."); like the e-mail validation messages it is minimal, and will move to ST-159's shared validation when it lands. (autonomous default)
- The seed's fake default password lives in `libs/domain/src/seed.ts` and the end-to-end fixture only; staging's comes from a secret, and the end-to-end flows that sign in for real need `E2E_PASSWORD` when they run against a deployed address. (autonomous default)

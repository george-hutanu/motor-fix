# Feature Specification: Set up e-mail sending

**Feature Branch**: `194-email-sending`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-194 Set up e-mail sending (Notion story https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f, epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Core of the notifications platform module with e-mail as its first channel: NOTIFICATION table, NOTIFICATION_TYPES catalogue in code, worker notifications queue, Brevo transactional e-mail adapter, always-sent flag, grouping, retries and fallback hook, quiet hours 22:00–08:00 Europe/Bucharest for non-urgent types [X25], admin-only test message endpoint, signed Brevo bounce webhook, and direct ACCOUNT_EMAIL sends for e-mail check and password reset. Cycle cut (build timeline): the outbox relay wiring into this queue belongs to ST-257; this story builds the queue entry point the relay will call. Production sending stays off until the sending domain (S10) is chosen; non-production sends only to allow-listed addresses."

**Sources**: Notion story ST-194 (https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f), read 2026-10-04; its Build brief wins over the criteria above it. Foundations build-timeline row https://app.notion.com/p/3ee607bff0d281459f43fe5920c809d2 (lane D · Messaging, W2, 8 points, blocked by ST-79 only, merged): "Cycle cut with ST-257: build the queue, the Brevo adapter and the direct sends (e-mail check, password reset) now; ST-257 wires the outbox relay into this queue. Needs a Brevo account and API key. Sending domain (S10) is open, so production sending stays off." Feature page MF "Notifications" (https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1), Build brief: final rules 1–17, the states, and the notification catalogue (75 rows). No screens (Build brief › Screens: none designed).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A feature hands over an event and the person gets an e-mail (Priority: P1)

A feature never sends e-mail itself. It hands the notifications service a type, the people concerned, what it is about and the event's id. The service writes one bell row per person and one row per outside channel, and the worker sends the e-mail through Brevo in the person's language.

**Why this priority**: every later story that tells someone something (sign-up, password reset, quotes, bookings, verification) goes through this entry point; without it none of them can reach a person whose app is closed.

**Independent Test**: with a recorded Brevo mock, hand the service a QUOTE_RECEIVED for one driver, wait for the job, read the NOTIFICATION rows and the calls the mock received.

**Acceptance Scenarios**:

1. **Given** a QUOTE_RECEIVED for driver "Andrei M." handed to the service with an event id, **When** it is sent, **Then** within 60 seconds a NOTIFICATION row with channel `in_app` and one with channel `email` exist for that type, Brevo's transactional e-mail API is called once, and the e-mail row is `sent` with its sent time set.
2. **Given** the same event (same type, recipient and event id) is handed over twice, **When** both are handled, **Then** only one e-mail goes and only one row per channel exists.
3. **Given** a VERIFICATION_RESULT for a garage owner, **When** it is sent, **Then** it always includes e-mail, even when e-mail is muted for that person.
4. **Given** an account whose language is `en`, **When** it is sent a message, **Then** the e-mail is in English; with `ro`, in Romanian.
5. **Given** a recipient account that is `deleted`, **When** the job runs, **Then** no row is written and nothing is sent; **Given** a recipient with no e-mail address, **Then** only the `in_app` row is written.
6. **Given** a bell row is saved, **Then** `notification.created` is published on the live events channel for the audience `account:{accountId}`.

---

### User Story 2 - An admin sends a test message to people of every role (Priority: P1)

A MotorFix admin checks that e-mail works by sending a test message to chosen accounts: a driver, a garage owner, a mechanic and an admin. Nobody else may call it.

**Why this priority**: the epic's "done when" is "receives a test e-mail"; it is the only message this story can fire end to end before the owning stories exist.

**Independent Test**: call the test endpoint as an admin with four account ids and read the rows and the mock's calls; call it as a driver, a garage owner and a mechanic.

**Acceptance Scenarios**:

1. **Given** an admin, **When** they send the test message to one driver, one garage owner, one mechanic and one admin, **Then** each gets an e-mail of type TEST_MESSAGE, and 4 `email` rows plus 4 `in_app` rows are written.
2. **Given** a driver, a garage owner, a receptionist or a mechanic, **When** they call the test endpoint, **Then** it answers 404; **Given** no session, **Then** it answers 401.
3. **Given** an admin sends to an id that is not an existing, non-deleted account, **Then** it answers 400 and nothing is sent.

---

### User Story 3 - Sign-up and password reset can send their e-mail at once (Priority: P1)

The auth module sends the e-mail check and the password reset itself through the service, straight to the queue, not through the outbox. These messages cannot be muted, are never grouped and never wait for quiet hours.

**Why this priority**: ST-81 (confirm my e-mail) and ST-127 (reset a forgotten password) are waiting on it.

**Independent Test**: call the direct send for an account with each purpose at 23:10 Bucharest time and read the row and the mock's call.

**Acceptance Scenarios**:

1. **Given** a person asks for an e-mail check or a password reset, **When** the auth module calls the service with the account, the purpose and the link, **Then** an ACCOUNT_EMAIL e-mail carrying the link goes to that account's address, with an `in_app` row.
2. **Given** it is 23:10 Europe/Bucharest, **When** an ACCOUNT_EMAIL is sent, **Then** it goes at once.
3. **Given** two ACCOUNT_EMAIL sends for the same account within a minute, **Then** two e-mails go (never grouped).

---

### User Story 4 - Brevo trouble never loses a message silently (Priority: P2)

When Brevo answers with a server error or does not answer, the send is retried on a fixed schedule. After the last failure the row is `failed`, the bell row stays, and the fallback hook runs (ST-196 plugs push into it). A hard bounce reported by Brevo marks the row and the account's address.

**Why this priority**: an outside service will fail; the record must say so and the next channel must be able to take over.

**Independent Test**: make the mock answer 503 and advance through the retry schedule; post a signed and an unsigned bounce to the webhook.

**Acceptance Scenarios**:

1. **Given** Brevo answers 5xx, **When** the job runs, **Then** it retries after 1, 5, 15, 60 and 240 minutes; after the last failure the row is `failed`, the `in_app` row stays, and the fallback hook is called with the failed row.
2. **Given** Brevo answers a 4xx other than 429, **Then** the row is `failed` at once, without retries, and the fallback hook is called.
3. **Given** Brevo's webhook reports a hard bounce for a driver's address with the right secret, **When** `POST /api/v1/webhooks/brevo` receives it, **Then** the row with that message id is `failed` and the account's `email_bounced_at` is set; **Given** a wrong or missing secret, **Then** it answers 401 and changes nothing.

---

### User Story 5 - Several of the same message in a few minutes arrive as one (Priority: P2)

The first notification of a groupable type goes at once; the ones that follow it for the same person within 5 minutes go out as one e-mail ("2 oferte noi"), while the bell lists each one. Urgent, always-sent and transactional types are never grouped.

**Why this priority**: three quotes in a minute must not mean three e-mails.

**Independent Test**: hand over three QUOTE_RECEIVED for one driver within 5 minutes, close the window, count the mock's calls and the bell rows; hand over a JOB_READY in between.

**Acceptance Scenarios**:

1. **Given** three QUOTE_RECEIVED for the same driver within 5 minutes, **When** the window closes, **Then** the first went at once, the other two go as one e-mail naming the count ("2 oferte noi"), all three `email` rows are `sent`, Brevo was called twice, and the bell has three `in_app` rows.
2. **Given** a JOB_READY and a QUOTE_RECEIVED for the same driver a minute apart, **When** they are sent, **Then** JOB_READY goes at once and is never grouped.

---

### User Story 6 - Messages that are not urgent wait for the morning (Priority: P2)

Between 22:00 and 08:00 Europe/Bucharest, the outside send of a type that is not urgent waits until 08:00; its bell row is written at once. Urgent types go at any time [X25].

**Why this priority**: decided by the owner on 2026-10-03 [X25]; reminders at night would wake people.

**Independent Test**: build a REQUEST_REMINDER, a JOB_READY, a SIGN_IN_CODE and a BOOKING_CONFIRM_REMINDER at fixed clock times, including the night of the clock change on 25 October 2026.

**Acceptance Scenarios**:

1. **Given** it is 23:10 Europe/Bucharest and a REQUEST_REMINDER is built for garage owner Ion, **Then** the `in_app` row is written at once and the `email` row is `held` with `send_after` = 08:00 the next morning, and it is sent at 08:00.
2. **Given** it is 23:10 and a JOB_READY is built, **Then** it goes at once.
3. **Given** it is 02:00 and a BOOKING_CONFIRM_REMINDER is built, **Then** it goes at once.
4. **Given** it is 23:10 on 24 October 2026 (the clocks go back at 04:00 on 25 October), **Then** `send_after` is 08:00 Bucharest time on 25 October, which is 06:00 UTC after the clocks went back (not 05:00 UTC, the summer offset).
5. **Given** a held row whose account was deleted before 08:00, **When** it is released, **Then** nothing is sent and the row is `failed`.

---

### User Story 7 - No real person is mailed from a test environment (Priority: P1)

Outside production, only allow-listed addresses get e-mail. In production, sending stays off until the sending domain (S10) is chosen and it is switched on by configuration.

**Why this priority**: staging and test data hold real-looking addresses; a mistaken send cannot be called back.

**Independent Test**: send to an allow-listed and a non-listed address with the allow-list set; send in production mode with sending off.

**Acceptance Scenarios**:

1. **Given** a non-production environment with an allow-list, **When** a message goes to an address that is not on it, **Then** Brevo is not called and the `email` row is `failed` with the reason `not_allowed`; an allow-listed address is sent.
2. **Given** production with sending not switched on, **When** a message is built, **Then** Brevo is not called and the `email` row is `failed` with the reason `sending_off`; the bell row is written.
3. **Given** sending is on and the Brevo key is missing or Brevo refuses it at start-up, **Then** the worker does not start sending and logs an error; its health check still answers.

---

### Edge Cases

- An unknown type is handed to the service: refused at once with an error to the caller; nothing is queued.
- A type whose allowed channels do not include e-mail (for example SIGN_IN_CODE, W only): only the `in_app` row is written in this story; WhatsApp, SMS and push arrive with ST-196 and ST-198.
- Redis publish of `notification.created` fails: the rows stay, the failure is logged, the job succeeds (PostgreSQL is the truth).
- Brevo does not answer within 10 seconds: counted as a failure and retried like a 5xx.
- Brevo answers 429: retried like a 5xx.
- A retry of a job whose e-mail row is already `sent` (worker crash after Brevo accepted, before the job was acknowledged): no second e-mail.
- A grouped window where one of the rows' accounts was deleted meanwhile: that account's rows are not sent.
- A bounce for a message id this system did not send: answered 204, nothing changes.
- A webhook event that is not a hard bounce (delivered, opened, soft bounce): answered 204, nothing changes.
- 07:59:59 and 08:00:00 Bucharest: 07:59:59 is quiet, 08:00:00 is not; 22:00:00 is quiet.
- Sending a notification is not a change in the app: nothing is written to the audit history.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The catalogue MUST list, in code, every type of the feature's notification catalogue plus TEST_MESSAGE, each with its trigger kind (`event`, `timer` or `direct`), its allowed outside channels (a subset of `email`, `push`, `sms`, `whatsapp`; empty for a bell-only type), whether it is always sent, transactional, groupable and urgent, its driver group (`offers`, `bookings`, `due_dates`, `news`, `reviews_history`, or none), and its template key. Always-sent and transactional types MUST NOT be groupable; the types the feature lists as not urgent (DUE_ITP, DUE_RCA, DUE_ROVINIETA, TYRES_SEASON, SERVICE_DUE, BOOKING_REMINDER, REQUEST_REMINDER, DOCUMENT_DUE, LISTING_REMINDER, NEWS, REVIEW_INVITE) MUST be not urgent and every other type urgent.
- **FR-002**: The notifications service MUST offer one entry point that takes a type, the recipient account ids, the subject id, an event id and the message's parameters; it MUST write the rows of FR-003 in PostgreSQL before putting the send jobs on the worker's `notifications` queue, so a job lost from Redis leaves a `queued` row behind rather than nothing; an unknown type MUST be refused before anything is written.
- **FR-003**: For each recipient, the service MUST skip a `deleted` account, write one `in_app` row with status `sent`, and write one `email` row when the type allows e-mail and the account has an e-mail address; it MUST NOT write rows for the other outside channels in this story.
- **FR-004**: A type that is always sent MUST include e-mail whenever it allows e-mail, whatever channels are muted; the channel choice MUST take the muted channels as input (empty until ST-197 stores preferences).
- **FR-005**: Rows MUST be unique on (type, recipient, channel, event id); a job handed the same event twice MUST write no second row and send no second e-mail, and a job whose `email` row is already `sent` MUST NOT call Brevo again.
- **FR-006**: After each `in_app` row is saved, the service MUST publish `notification.created` with the row's id and creation time to the live events channel with the audience `account:{accountId}` (the wire format of the live connection, ST-253); a publish failure MUST be logged and MUST NOT fail the send.
- **FR-007**: The e-mail MUST go through Brevo's transactional e-mail API, with a 10-second timeout, from the configured sender, to the account's address, in the account's language (`ro` when not set); a 2xx answer MUST set the row `sent` with its sent time and Brevo's message id.
- **FR-008**: A Brevo 5xx, a 429, a timeout or a network error MUST be retried after 1, 5, 15, 60 and 240 minutes; any other 4xx, or the failure of the last retry, MUST set the row `failed` with the reason and call the e-mail fallback with the failed row. The fallback does nothing in this story; ST-196 makes it send push.
- **FR-009**: For a groupable type, the first `email` row for a (type, recipient) MUST be sent at once and open a 5-minute window; every further row of the same type and recipient built within that window MUST be held, and when the window closes one e-mail MUST go naming the count of held rows (a single held row goes as an ordinary e-mail), with every held row set `sent` together; when that e-mail fails for good, every held row is set `failed` and the fallback is called for each. A row built after the window closed opens a new window. Non-groupable types MUST NOT open a window. A row released from quiet hours MUST go through this rule as if it were built at its release.
- **FR-010**: An `email` row of a type that is not urgent, built between 22:00 (inclusive) and 08:00 (exclusive) Europe/Bucharest, MUST be `held` with `send_after` set to the next 08:00 Europe/Bucharest (correct across daylight-saving changes) and sent then; its `in_app` row MUST be written at once. Urgent types MUST go at any hour.
- **FR-011**: When a held or grouped row is released, it MUST be sent only if it is still `held` or `queued` and its account is not `deleted`; otherwise it MUST be set `failed` (account deleted) or left as it is.
- **FR-012**: The service MUST offer a direct send of ACCOUNT_EMAIL for an account with the purpose `email_check` or `password_reset` and a link; it MUST go straight to the service (not through the outbox), never be grouped, never be held, and ignore muted channels. Each direct send MUST carry a fresh event id and the account as its subject, so two requests send two e-mails.
- **FR-013**: `POST /api/v1/admin/notifications/test` with 1 to 20 distinct account ids MUST, for an admin, send a TEST_MESSAGE to each, with one fresh event id per call and each account as its subject, and answer 202; for any other signed-in role it MUST answer 404, without a session 401, and with an id that is not an existing non-deleted account 400 with nothing queued.
- **FR-014**: `POST /api/v1/webhooks/brevo` MUST accept only a request carrying the configured webhook secret (compared in constant time), else answer 401 and change nothing; for a `hard_bounce` event it MUST set the matching `email` row (by Brevo's message id) `failed` with the reason `bounced`, set `email_bounced_at` on the account with that address, and call the e-mail fallback with the row; every other event or unknown message id MUST answer 204 and change nothing.
- **FR-015**: Sending MUST stay off unless switched on by configuration, in every environment; while off, the row MUST be `failed` with the reason `sending_off`. Outside production, an e-mail to an address not on the configured allow-list (exact addresses or `@domain` entries; an empty or missing list allows nobody) MUST NOT reach Brevo and MUST set the row `failed` with the reason `not_allowed`. Neither reason calls the fallback.
- **FR-016**: With sending switched on, the worker MUST check the Brevo key at start-up; a missing key or one Brevo refuses MUST stop it from processing the `notifications` queue and log an error, while its health check keeps answering.
- **FR-017**: The queue MUST process up to 10 jobs at once.
- **FR-018**: TEST_MESSAGE and ACCOUNT_EMAIL MUST have a Romanian and an English subject and body; the ACCOUNT_EMAIL body MUST carry the link. The grouped e-mail MUST name the count in the recipient's language.
- **FR-019**: Sending a notification MUST NOT write to the audit history.
- **FR-020**: Logs about a notification MUST carry its id, type, channel and outcome only, never the address, the link, the message text or the Brevo key.

### Key Entities

- **Notification** (new, NOTIFICATION): one row per recipient and channel — account, type (kind), subject id, channel (`in_app`, `email`, `push`, `sms`, `whatsapp`), status (`queued`, `held`, `sent`, `failed`), event id, send after, sent at, read at, fallback of, failure reason, Brevo message id, parameters, created at.
- **Account** (exists): gains `email_bounced_at`.
- **Notification type** (code, not a table): the catalogue entry of FR-001.
- **Notifications queue** (Redis, not a table): jobs the worker runs; emptying it loses nothing a row does not record, except jobs not yet built (the outbox of ST-257 is what makes those durable).

## Clarifications

### Session 2026-10-04

- Q: Does the first of a burst of groupable messages go at once, with the rest grouped, or are all held for one e-mail? → A: First at once, the rest of the 5-minute window as one e-mail (FR-009); it is the only reading that meets both the 60-second scenario and the grouping scenario without a second window value. Owner may overturn; the window is *(proposed)*. (autonomous, recommended by spec-challenger)
- Q: What are the event id and subject of a direct ACCOUNT_EMAIL and of a test message? → A: A fresh event id per call and the account as subject, so idempotency never drops them (FR-012, FR-013). (autonomous, recommended)
- Q: Outside production, what does an empty allow-list allow, and when does the start-up key check run? → A: Nobody (fail closed); one switch, `on` or `off`, in every environment, and the key check runs only when it is `on` (FR-015, FR-016). (autonomous, recommended)
- Q: When several held rows of one groupable type are released at 08:00, how do they go? → A: Each release goes through the grouping rule as if just built: the first at once, the rest in one e-mail 5 minutes later (FR-009). (autonomous, recommended)
- Q: Is the fallback hook kept although nothing plugs into it yet? → A: Kept as one injectable e-mail fallback that does nothing, because the Build brief names it and scenario 6 asserts it runs; a bounce also calls it (feature rule 13, "e-mail bounces → push"). Recorded in the plan's Complexity Tracking. (autonomous; spec-challenger recommended deferring, overridden by the brief's explicit scenario)
- Resolved from context.md without a question: rows are written in PostgreSQL before the job is queued, so a direct send survives an emptied Redis as a `queued` row (FR-002; Security, Backups); BullMQ (A9, *proposed*) is confirmed in the plan; complaint (spam) events stay with ST-279; exposing `email_bounced_at` to Setări is the settings story's; `notification.created` uses the live connection's wire format (ST-253, PR #57) so the bell receives it once ST-253 lands.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A message handed to the service is accepted by the e-mail provider within 60 seconds when it is urgent and not grouped (API test against the recorded mock).
- **SC-002**: The admin's test message reaches a driver, a garage owner, a mechanic and an admin: 4 e-mail rows `sent`, 4 bell rows (API test, 4 of 4); the three other roles get 404 (3 of 3).
- **SC-003**: The same event relayed twice sends one e-mail (API test).
- **SC-004**: Three of the same groupable message within 5 minutes send two e-mails (the first, then one naming the other two) and three bell rows (API test).
- **SC-005**: Every catalogue type has channels, flags and a template key, and no always-sent or transactional type is groupable (unit test over the whole catalogue).
- **SC-006**: Quiet hours hold a non-urgent message built at 23:10 until 08:00 and release an urgent one at once, also across the clock change of 25 October 2026 (unit tests).
- **SC-007**: No e-mail reaches the provider for an address off the allow-list outside production, or at all in production while sending is off (API tests).

## Assumptions

- The Build brief contradicts itself on grouping: scenario 1 sends a QUOTE_RECEIVED within 60 seconds, scenario 4 sends three QUOTE_RECEIVED within 5 minutes as one e-mail. This spec sends the first at once and groups the ones that follow (FR-009), which keeps the feature's "within a minute of a garage sending a quote" test and still collapses a burst; a burst of three is two e-mails, not one. Owner decision recorded in the run report. (autonomous default)
- The cycle cut with ST-257 stands (build timeline): the entry point takes the recipients already resolved; resolving recipients from an outbox event, and the relay itself, are ST-257's and the owning stories'. QUOTE_RECEIVED in the scenarios is handed to the entry point directly. (timeline row)
- Only e-mail is sent in this story; types allowed only on push, SMS or WhatsApp get their `in_app` row and nothing else until ST-196 and ST-198 add those channels. (Build brief › Out of scope)
- The bounce webhook is authenticated with a shared secret the webhook URL carries in a header, because Brevo's transactional webhooks do not sign their body; this is the "signed" of the brief. (autonomous default)
- A deleted account gets nothing; a suspended account still gets its messages (a suspended garage owner must get GARAGE_SUSPENDED). (autonomous default, from rule 6)
- TEST_MESSAGE is e-mail only and transactional (never grouped, never held), and not in the feature's catalogue; the brief proposes it. (Build brief, *proposed*)
- The templates are plain subjects and bodies written in code for TEST_MESSAGE, ACCOUNT_EMAIL and the grouped count only; the template store and every other type's text are ST-195's. (Build brief › Out of scope)
- The admin test endpoint takes at most 20 account ids, enough for one of every role with room, and small enough to stop it being used as a mass mailer. (autonomous default)
- The end-to-end check "an admin sends the test message; the e-mail arrives in the test mailbox; the driver's bell shows it" is covered by API integration tests against a recorded Brevo mock; the bell is ST-199's, and there is no screen to drive in this story. (autonomous default)
- The production switch and the allow-list are configuration (environment variables), so the owner can switch production on once S10 is chosen without a code change. (Build brief › States and errors)
- A held message's "reason has gone" check at 08:00 (feature rule, *proposed*) needs the owning story's notion of reason; this story re-checks only that the row is still held and the account still exists. (autonomous default)

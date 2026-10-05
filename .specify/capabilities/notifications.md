---
capability: notifications
updated: 2026-10-05
features:
  - 194-email-sending
  - 195-message-templates
  - 199-notification-bell
---

# Capability: Notifications

The one way MotorFix tells a person something: the type catalogue, the NOTIFICATION record per recipient and channel, the worker queue that sends through Brevo with retries, grouping and quiet hours, the admin test message, the bounce webhook and the direct account e-mails.

## Requirements

### 194-FR-001 — The catalogue MUST list, in code, every type of the feature's notification catalogue plus TEST_MESSAGE, each with its trigger kind (`event`, `timer` or `direct`), its allowed outside channels (a subset of `email`, `push`, `sms`, `whatsapp`; empty for a bell-only type), whether it is always sent, transactional, groupable and urgent, its driver group (`offers`, `bookings`, `due_dates`, `news`, `reviews_history`, or none), and its template key. Always-sent and transactional types MUST NOT be groupable; the types the feature lists as not urgent (DUE_ITP, DUE_RCA, DUE_ROVINIETA, TYRES_SEASON, SERVICE_DUE, BOOKING_REMINDER, REQUEST_REMINDER, DOCUMENT_DUE, LISTING_REMINDER, NEWS, REVIEW_INVITE) MUST be not urgent and every other type urgent.

_From 194-email-sending._

### 194-FR-002 — The notifications service MUST offer one entry point that takes a type, the recipient account ids, the subject id, an event id and the message's parameters; it MUST write the rows of FR-003 in PostgreSQL before putting the send jobs on the worker's `notifications` queue, so a job lost from Redis leaves a `queued` row behind rather than nothing; an unknown type MUST be refused before anything is written.

_From 194-email-sending._

### 194-FR-003 — For each recipient, the service MUST skip a `deleted` account, write one `in_app` row with status `sent`, and write one `email` row when the type allows e-mail and the account has an e-mail address; it MUST NOT write rows for the other outside channels in this story.

_From 194-email-sending._

### 194-FR-004 — A type that is always sent MUST include e-mail whenever it allows e-mail, whatever channels are muted; the channel choice MUST take the muted channels as input (empty until ST-197 stores preferences).

_From 194-email-sending._

### 194-FR-005 — Rows MUST be unique on (type, recipient, channel, event id); a job handed the same event twice MUST write no second row and send no second e-mail, and a job whose `email` row is already `sent` MUST NOT call Brevo again.

_From 194-email-sending._

### 194-FR-006 — After each `in_app` row is saved, the service MUST publish `notification.created` with the row's id and creation time to the live events channel with the audience `account:{accountId}` (the wire format of the live connection, ST-253); a publish failure MUST be logged and MUST NOT fail the send.

_From 194-email-sending._

### 195-FR-005 — The e-mail MUST go through Brevo's transactional e-mail API, with a 10-second timeout, from the configured sender, to the account's address, carrying the rendered subject, HTML part and plain-text part in the account's language (`ro` when not set); a 2xx answer MUST set the row `sent` with its sent time and Brevo's message id.

_From 195-message-templates._

### 194-FR-008 — A Brevo 5xx, a 429, a timeout or a network error MUST be retried after 1, 5, 15, 60 and 240 minutes; any other 4xx, or the failure of the last retry, MUST set the row `failed` with the reason and call the e-mail fallback with the failed row. The fallback does nothing in this story; ST-196 makes it send push.

_From 194-email-sending._

### 194-FR-009 — For a groupable type, the first `email` row for a (type, recipient) MUST be sent at once and open a 5-minute window; every further row of the same type and recipient built within that window MUST be held, and when the window closes one e-mail MUST go naming the count of held rows (a single held row goes as an ordinary e-mail), with every held row set `sent` together; when that e-mail fails for good, every held row is set `failed` and the fallback is called for each. A row built after the window closed opens a new window. Non-groupable types MUST NOT open a window. A row released from quiet hours MUST go through this rule as if it were built at its release.

_From 194-email-sending._

### 194-FR-010 — An `email` row of a type that is not urgent, built between 22:00 (inclusive) and 08:00 (exclusive) Europe/Bucharest, MUST be `held` with `send_after` set to the next 08:00 Europe/Bucharest (correct across daylight-saving changes) and sent then; its `in_app` row MUST be written at once. Urgent types MUST go at any hour.

_From 194-email-sending._

### 194-FR-011 — When a held or grouped row is released, it MUST be sent only if it is still `held` or `queued` and its account is not `deleted`; otherwise it MUST be set `failed` (account deleted) or left as it is.

_From 194-email-sending._

### 194-FR-012 — The service MUST offer a direct send of ACCOUNT_EMAIL for an account with the purpose `email_check` or `password_reset` and a link; it MUST go straight to the service (not through the outbox), never be grouped, never be held, and ignore muted channels. Each direct send MUST carry a fresh event id and the account as its subject, so two requests send two e-mails.

_From 194-email-sending._

### 194-FR-013 — `POST /api/v1/admin/notifications/test` with 1 to 20 distinct account ids MUST, for an admin, send a TEST_MESSAGE to each, with one fresh event id per call and each account as its subject, and answer 202; for any other signed-in role it MUST answer 404, without a session 401, and with an id that is not an existing non-deleted account 400 with nothing queued.

_From 194-email-sending._

### 194-FR-014 — `POST /api/v1/webhooks/brevo` MUST accept only a request carrying the configured webhook secret (compared in constant time), else answer 401 and change nothing; for a `hard_bounce` event it MUST set the matching `email` row (by Brevo's message id) `failed` with the reason `bounced`, set `email_bounced_at` on the account with that address, and call the e-mail fallback with the row; every other event or unknown message id MUST answer 204 and change nothing.

_From 194-email-sending._

### 194-FR-015 — Sending MUST stay off unless switched on by configuration, in every environment; while off, the row MUST be `failed` with the reason `sending_off`. Outside production, an e-mail to an address not on the configured allow-list (exact addresses or `@domain` entries; an empty or missing list allows nobody) MUST NOT reach Brevo and MUST set the row `failed` with the reason `not_allowed`. Neither reason calls the fallback.

_From 194-email-sending._

### 194-FR-016 — With sending switched on, the worker MUST check the Brevo key at start-up; a missing key or one Brevo refuses MUST stop it from processing the `notifications` queue and log an error, while its health check keeps answering.

_From 194-email-sending._

### 194-FR-017 — The queue MUST process up to 10 jobs at once.

_From 194-email-sending._

### 195-FR-010 — The system MUST carry the Romanian and English texts of TEST_MESSAGE and ACCOUNT_EMAIL (e-mail check and password reset, whose e-mail carries the link), for the e-mail and the bell, and of the generic and QUOTE_RECEIVED grouped e-mails, with the Romanian "de" plural.

_From 195-message-templates._

### 194-FR-019 — Sending a notification MUST NOT write to the audit history.

_From 194-email-sending._

### 194-FR-020 — Logs about a notification MUST carry its id, type, channel and outcome only, never the address, the link, the message text or the Brevo key.

_From 194-email-sending._

### 195-FR-001 — The system MUST keep one template per notification type and channel (e-mail, push, SMS, WhatsApp, bell), each with a Romanian and an English text, in the repository.

_From 195-message-templates._

### 195-FR-002 — The system MUST render a message in the language its caller passes (the worker passes the recipient account's language), and in Romanian when that language is not `ro` or `en`.

_From 195-message-templates._

### 195-FR-003 — The system MUST render price, number, date and time values in the format of the message's language, with dates and times in Europe/Bucharest local time, reusing the app's shared formatters.

_From 195-message-templates._

### 195-FR-004 — An e-mail template MUST render a subject, an HTML part and a plain-text part with the MotorFix wordmark, one amber button that links to the screen in question, and a footer that says why the person gets it (a per-template text in both languages); only NEWS may carry an unsubscribe link.

_From 195-message-templates._

### 195-FR-006 — A push template MUST render a title of at most 50 characters, a body of at most 120 and a link to the screen in question.

_From 195-message-templates._

### 195-FR-007 — An SMS template MUST render to at most 70 characters, link included.

_From 195-message-templates._

### 195-FR-008 — A WhatsApp template MUST render to the name of its approved WhatsApp template and its ordered parameter values.

_From 195-message-templates._

### 195-FR-009 — A check that runs in CI MUST fail the build when a template lacks a language, uses an undeclared value, belongs to an unknown type, uses a `plate` or `phone` value against the privacy rule, writes ş or ţ with a cedilla, breaks a push, SMS or WhatsApp limit with its example values, or does not render with its example values.

_From 195-message-templates._

### 195-FR-011 — When a template cannot render, the system MUST NOT send the message; it MUST set the row `failed` with the reason `template_failed`, log the type, channel and missing value, and answer a generic bell text in the person's language.

_From 195-message-templates._

### 199-FR-001 — `GET /api/v1/notifications?cursor&language` MUST return the signed-in person's own `in_app` rows of the last 90 days, newest first (created, then id), 20 per page, with `nextCursor`; each item has `id`, `kind`, `subjectId`, `text`, `at` and `readAt`.

_From 199-notification-bell._

### 199-FR-002 — Each item's `text` MUST be the kind's bell template rendered from the row's params in the requested language (`ro` or `en`), else the account's language, falling back to the generic text.

_From 199-notification-bell._

### 199-FR-003 — `GET /api/v1/notifications/unread-count` MUST return the number of the person's unread `in_app` rows of the last 90 days.

_From 199-notification-bell._

### 199-FR-004 — `POST /api/v1/notifications/:id/read` MUST set `read_at` once (a second call keeps the first time) and return the item; a row that is not the caller's own `in_app` row answers 404.

_From 199-notification-bell._

### 199-FR-005 — `POST /api/v1/notifications/read-all` MUST set `read_at` on every unread `in_app` row of the caller and no one else's.

_From 199-notification-bell._

### 199-FR-006 — Marking read (one or all) MUST publish `notification.read` on `account:{accountId}`; a Redis failure is logged and does not fail the call.

_From 199-notification-bell._

### 199-FR-007 — Every dashboard's header MUST show the bell button "Notificări" / "Notifications" with the unread badge ("9+" above 9, none at 0), its count also in the button's accessible name.

_From 199-notification-bell._

### 199-FR-008 — The bell MUST open the list in the Overlays drawer (a bottom sheet on a phone) with the empty, loading and error states, relative times up to 24 hours then the date in Europe/Bucharest, an unread mark per row, "Marchează tot ca citit" and loading more on demand.

_From 199-notification-bell._

### 199-FR-009 — Tapping a row MUST mark it read.

_From 199-notification-bell._

### 199-FR-010 — On `notification.created` the bell MUST show a 5-second toast with the row's text and refresh its badge and list without a reload; on `notification.read` it MUST refresh them.

_From 199-notification-bell._

### 199-FR-011 — The bell MUST refresh its badge every 60 seconds while a dashboard is shown, and each time it opens.

_From 199-notification-bell._

## Retired

- `194-FR-007` — superseded by `195-FR-005` (2026-10-04)
- `194-FR-018` — superseded by `195-FR-010` (2026-10-04)

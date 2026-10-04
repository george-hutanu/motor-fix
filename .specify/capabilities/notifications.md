---
capability: notifications
updated: 2026-10-04
features:
  - 194-email-sending
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

### 194-FR-007 — The e-mail MUST go through Brevo's transactional e-mail API, with a 10-second timeout, from the configured sender, to the account's address, in the account's language (`ro` when not set); a 2xx answer MUST set the row `sent` with its sent time and Brevo's message id.

_From 194-email-sending._

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

### 194-FR-018 — TEST_MESSAGE and ACCOUNT_EMAIL MUST have a Romanian and an English subject and body; the ACCOUNT_EMAIL body MUST carry the link. The grouped e-mail MUST name the count in the recipient's language.

_From 194-email-sending._

### 194-FR-019 — Sending a notification MUST NOT write to the audit history.

_From 194-email-sending._

### 194-FR-020 — Logs about a notification MUST carry its id, type, channel and outcome only, never the address, the link, the message text or the Brevo key.

_From 194-email-sending._

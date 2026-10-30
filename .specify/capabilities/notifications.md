---
capability: notifications
updated: 2026-10-30
features:
  - 194-email-sending
  - 195-message-templates
  - 199-notification-bell
  - 555-account-link-params
  - 196-push-notifications
  - 646-notification-send-claim
  - 571-news-fan-out-worker
  - 393-whatsapp-phone-sign-in
  - 198-staff-notification-preferences
  - 540-email-link-scheme
  - 522-email-sent-once
  - 539-public-web-url-boot
  - 780-one-public-web-url-parser
  - 778-mark-sent-retry-no-delay
  - 114-save-draft
  - 561-sms-sent-once
  - 560-requeue-stranded-notifications
  - 802-sms-count-throw-clears-mark
  - 806-requeue-sweep-batched
  - 138-notification-switches
  - 260-rule-off-confirm
  - 343-live-quote-requests
  - 312-report-garage
  - 344-send-quote
  - 139-edit-my-details
  - 345-decline-request
  - 209-status-change-emails
  - 251-monitoring-backups
  - 032-notifications-bell
  - 222-booking-from-quote
  - 049-garage-suspension
  - 279-email-inbox
  - 069-report-decision
  - 1351-rar-monthly-recheck
  - 1190-live-reconnects
  - 1352-catalogue-job-visibility
  - 389-confirm-booking-lift-mechanic
  - 428-close-on-account-closed
  - 068-yearly-documents
  - 414-approve-catalogue-job
  - 067-restore-suspended-garage
  - 523-flush-late-follower
  - 520-brevo-key-check-retry
  - 525-bounce-domain-event
  - 003-admin-account-actions
  - 1370-release-seed-no-ssh
  - 1156-retention-job
  - 142-notification-channels
  - 140-account-delete-export
  - 094-itp-reminders
  - 074-garage-reviews
  - 1257-quote-reminders
  - 091-oil-service-due
  - 223-request-act-notifications
  - 1258-driver-cancel
  - 177-reported-reviews
  - 1254-assistant-approvals
  - 277-car-status-alerts
  - 409-garage-corrects-repair
  - 1267-admin-corrects-repair
---

# Capability: Notifications

The one way MotorFix tells a person something: the type catalogue, the NOTIFICATION record per recipient and channel, the worker queue that sends through Brevo with retries, grouping and quiet hours, the admin test message, the bounce webhook and the direct account e-mails.

## Requirements

### 1351-FR-008 — The worker MUST, every day at 09:00 Europe/Bucharest through the existing daily mechanism (bucharestDaily), count the due garages and, when the count is above zero, queue one ADMIN_RECHECK_DUE per admin with the count; once per day whatever restarts happen. With a count of zero it MUST send nothing. The type's catalogue entry is timer, e-mail and push (narrowed from the proposed e-mail, push and WhatsApp), mutable.

_From 1351-rar-monthly-recheck._

### 194-FR-002 — The notifications service MUST offer one entry point that takes a type, the recipient account ids, the subject id, an event id and the message's parameters; it MUST write the rows of FR-003 in PostgreSQL before putting the send jobs on the worker's `notifications` queue, so a job lost from Redis leaves a `queued` row behind rather than nothing; an unknown type MUST be refused before anything is written.

_From 194-email-sending._

### 142-FR-005 — With nothing saved for a driver type, its channel MUST be `push` when the driver has at least one push device and `email` otherwise, at read (the preferences view) and at send time (the muted channels), so a driver who never chose gets push where it works and e-mail elsewhere; `enabled` defaults stay as today (every group on but news). A driver who deletes their last device falls back to e-mail by this same rule on the next read and send. The rule holds for every existing account and type with no saved row from the release on; always-sent and transactional types keep their e-mail as today. The read carries `pushDevice`, true when the account has at least one push device.

_From 142-notification-channels._

### 194-FR-004 — A type that is always sent MUST include e-mail whenever it allows e-mail, whatever channels are muted; the channel choice MUST take the muted channels as input (empty until ST-197 stores preferences).

_From 194-email-sending._

### 194-FR-005 — Rows MUST be unique on (type, recipient, channel, event id); a job handed the same event twice MUST write no second row and send no second e-mail, and a job whose `email` row is already `sent` MUST NOT call Brevo again.

_From 194-email-sending._

### 194-FR-006 — After each `in_app` row is saved, the service MUST publish `notification.created` with the row's id and creation time to the live events channel with the audience `account:{accountId}` (the wire format of the live connection, ST-253); a publish failure MUST be logged and MUST NOT fail the send.

_From 194-email-sending._

### 195-FR-005 — The e-mail MUST go through Brevo's transactional e-mail API, with a 10-second timeout, from the configured sender, to the account's address, carrying the rendered subject, HTML part and plain-text part in the account's language (`ro` when not set); a 2xx answer MUST set the row `sent` with its sent time and Brevo's message id.

_From 195-message-templates._

### 196-FR-019 — An e-mail row that fails for good and is not itself a fallback MUST fall back to push when the type lists push and the person has a push device; a push row that is itself a fallback MUST NOT fall back to e-mail.

_From 196-push-notifications._

### 523-FR-001 — A grouped-window flush MUST, after each grouped (or single) send, look again for held rows of its leader not yet handled, round by round, and send them, ending only when a round finds none; a groupable e-mail that joins the window while the flush is running is therefore sent by that flush. (Modifies 194-FR-009: the close of a window sends every held row, including rows that joined while the flush ran.)

_From 523-flush-late-follower._

### 194-FR-010 — An `email` row of a type that is not urgent, built between 22:00 (inclusive) and 08:00 (exclusive) Europe/Bucharest, MUST be `held` with `send_after` set to the next 08:00 Europe/Bucharest (correct across daylight-saving changes) and sent then; its `in_app` row MUST be written at once. Urgent types MUST go at any hour.

_From 194-email-sending._

### 194-FR-011 — When a held or grouped row is released, it MUST be sent only if it is still `held` or `queued` and its account is not `deleted`; otherwise it MUST be set `failed` (account deleted) or left as it is.

_From 194-email-sending._

### 194-FR-012 — The service MUST offer a direct send of ACCOUNT_EMAIL for an account with the purpose `email_check` or `password_reset` and a link; it MUST go straight to the service (not through the outbox), never be grouped, never be held, and ignore muted channels. Each direct send MUST carry a fresh event id and the account as its subject, so two requests send two e-mails.

_From 194-email-sending._

### 196-FR-014 — The test message MUST go by push as well as e-mail, and a signed-in person MUST be able to send a push-only test to their own devices; the test push has no e-mail fallback.

_From 196-push-notifications._

### 194-FR-014 — `POST /api/v1/webhooks/brevo` MUST accept only a request carrying the configured webhook secret (compared in constant time), else answer 401 and change nothing; for a `hard_bounce` event it MUST set the matching `email` row (by Brevo's message id) `failed` with the reason `bounced`, set `email_bounced_at` on the account with that address, and call the e-mail fallback with the row; every other event or unknown message id MUST answer 204 and change nothing.

_From 194-email-sending._

### 194-FR-015 — Sending MUST stay off unless switched on by configuration, in every environment; while off, the row MUST be `failed` with the reason `sending_off`. Outside production, an e-mail to an address not on the configured allow-list (exact addresses or `@domain` entries; an empty or missing list allows nobody) MUST NOT reach Brevo and MUST set the row `failed` with the reason `not_allowed`. Neither reason calls the fallback.

_From 194-email-sending._

### 520-FR-003 — The `notifications` queue consumer MUST start as soon as a check passes (at the first attempt as today, or after any number of retries) without a restart; a refused key, or sending on with `BREVO_API_KEY`, `EMAIL_FROM` or `PUBLIC_WEB_URL` missing, MUST keep the consumer off and log one error with no retry, as today; with sending off the consumer runs as today.

_From 520-brevo-key-check-retry._

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

### 1190-FR-005 — The account row MUST hold its unread in-app notification count, written in the same transaction as every change to it: a created in-app row adds one, a read row takes one, "mark all read" takes off the rows it marked, never below zero (a row written meanwhile stays counted); a migration computes it once from the existing rows. `GET /api/v1/notifications/unread-count` MUST answer it, and every `notification.created` and `notification.read` message MUST carry it as `unreadCount` (199-FR-003 modified: the count is the account's unread in-app rows, no longer windowed to 90 days).

_From 1190-live-reconnects._

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

### 032-FR-001 — In the driver dashboard, tapping a notification MUST mark it read and open the driver view its kind maps to: DUE_ITP, DUE_RCA, DUE_ROVINIETA, TYRES_SEASON, SERVICE_DUE, REPAIR_UPDATED and CAR_TRANSFER_ACCEPTED open Mașinile mele; QUOTE_RECEIVED, QUOTE_CHANGED, QUOTE_WITHDRAWN, QUOTE_EXPIRED, REQUEST_DECLINED, REQUEST_EXPIRED, MESSAGE_RECEIVED, NO_SHOW_RECORDED, FINAL_PRICE_CORRECTED, LIVE_STARTED, GARAGE_SUSPENDED_NOTICE and every `BOOKING_*`, `JOB_*` and `MEDIA_*` kind open Cererile mele; REVIEW_INVITE, REVIEW_REPLIED, REVIEW_DECIDED and REVIEW_APPEAL_DECIDED open Recenziile mele. `BOOKING_*`, `JOB_*` and `MEDIA_*` stand for the catalogue's kinds of those prefixes today, each written out by name in `contracts/bell-link.md` (the map's one table, which wins on any difference); there is no prefix match, so a kind added later is unmapped (FR-002) until its story adds it.

_From 032-notifications-bell._

### 1190-FR-011 — The bell MUST take its badge from `unreadCount` on every `notification.created` and `notification.read` message instead of re-reading the count on each, applying a count only when its message's `at` is not older than the last count applied; its 60-second refresh and the read on open stay (199-FR-010 modified).

_From 1190-live-reconnects._

### 199-FR-011 — The bell MUST refresh its badge every 60 seconds while a dashboard is shown, and each time it opens.

_From 199-notification-bell._

### 555-FR-001 — The bell (`in_app`) row of a notification MUST NOT store a `link` param.

_From 555-account-link-params._

### 555-FR-002 — An outside row that is sent MUST no longer store its `link` param once it is marked sent; the message itself MUST still carry the link.

_From 555-account-link-params._

### 555-FR-003 — An outside row that fails MUST no longer store its `link` param once it is marked failed, including a row written already failed because sending is off or the address is not allowlisted.

_From 555-account-link-params._

### 555-FR-004 — The end-to-end password reset flow MUST read the reset link from the e-mail as sent (a Brevo stand-in), not from the database.

_From 555-account-link-params._

### 196-FR-001 — A signed-in person MUST be able to save the current browser as a push device (address, two keys, optional device label up to 100 characters); saving an address that exists again replaces it and answers the same device id.

_From 196-push-notifications._

### 196-FR-002 — A signed-in person MUST be able to delete one of their own push devices; another account's device or an unknown id answers 404 `not_found`.

_From 196-push-notifications._

### 196-FR-003 — A save MUST be refused with 400 when the address is not an https URL or a key is missing or empty.

_From 196-push-notifications._

### 196-FR-004 — The web app MUST ask for the browser's notification permission only after a tap on "Activează notificările", never on page load.

_From 196-push-notifications._

### 196-FR-005 — The notifications panel MUST show the state read live from the browser: on, off, blocked ("Notificările sunt blocate în browser" with unblock steps), iPhone outside the Home Screen (the add-to-Home-Screen hint), unsupported browser, and push not set up on the server.

_From 196-push-notifications._

### 196-FR-006 — The panel MUST be reachable by every role: the Setări (settings) view of the driver and admin dashboards, and the garage dashboard's home view, which every garage role sees.

_From 196-push-notifications._

### 196-FR-008 — The worker MUST send one push row to every push device of the person, with the template's push title, body and link, a time to live of 24 hours, and urgency high for always-sent types and normal for the rest.

_From 196-push-notifications._

### 196-FR-009 — A device the push service answers 404 or 410 for MUST be deleted; when no device took the message, the row MUST fail with `no_device` and fall back to e-mail.

_From 196-push-notifications._

### 196-FR-010 — A retryable push failure (network, 429, 5xx) MUST be retried on the e-mail schedule; once the retries are used up, or on any other refusal, the row MUST fail and fall back to e-mail.

_From 196-push-notifications._

### 196-FR-011 — A push row MUST record its successful send on the row (`sent`, time) and the time of the last success on each device that took it.

_From 196-push-notifications._

### 196-FR-013 — A type with no push text MUST fail its push row with `template_failed` and fall back to e-mail.

_From 196-push-notifications._

### 196-FR-015 — The service worker MUST show a received push as a notification and, when it is tapped, open (or focus) the app at the push's link.

_From 196-push-notifications._

### 196-FR-016 — Signing out on a device MUST delete that device's push device and unsubscribe the browser; signing out everywhere MUST delete every push device of the account.

_From 196-push-notifications._

### 196-FR-017 — On app start, a browser with push on MUST save its current device again, so a changed address after a service worker update is not lost.

_From 196-push-notifications._

### 196-FR-018 — Push MUST be off, with no device saved and no push sent, when the server has no push keys configured; messages then go by e-mail. Routing then treats every person as having no push device.

_From 196-push-notifications._

### 196-FR-020 — A push row MUST be `sent` when at least one device took it, and MUST be retried only when no device took it and at least one refusal was retryable.

_From 196-push-notifications._

### 196-FR-021 — The panel MUST show the add-to-Home-Screen hint on an iPhone or iPad not running from the Home Screen, whether or not the browser exposes push; an installed app without push support MUST show "browser without push".

_From 196-push-notifications._

### 646-FR-001 — Before it reads a row to send, a send job MUST claim it with one conditional update that succeeds only for a `queued` or `held` row holding no claim, or a claim older than the lease; only the job whose update changed the row may send it.

_From 646-notification-send-claim._

### 646-FR-002 — A send job that cannot claim a row still `queued` or `held` MUST NOT call Brevo and MUST fail, so the queue retries it after its backoff; a job that finds the row `sent`, `failed` or gone MUST succeed without sending.

_From 646-notification-send-claim._

### 523-FR-008 — The claim lease, in a send as in a flush, MUST be judged against the database clock in the claiming update, never against the worker's own clock. (Modifies 646-FR-003: the lease lapses on the database clock.)

_From 523-flush-late-follower._

### 646-FR-004 — When a send job ends — sent, failed, held back, retried or thrown — it MUST release its own claim (and only its own).

_From 646-notification-send-claim._

### 571-FR-001 — Sending news MUST claim the month and answer 202 with the number of consenting drivers, writing no news message in the request; the month's run (title, text, sender) MUST reach the worker as one queued job.

_From 571-news-fan-out-worker._

### 571-FR-002 — The worker MUST run the month's job by writing one news message per consenting driver, in the driver's language, with the driver's unsubscribe links.

_From 571-news-fan-out-worker._

### 571-FR-003 — A run that fails MUST be retried by the queue; a retry MUST reach each driver once and MUST keep the month claimed.

_From 571-news-fan-out-worker._

### 571-FR-004 — A run that fails on its last attempt MUST give the month back and record the release against the sender.

_From 571-news-fan-out-worker._

### 571-FR-005 — The run MUST be saved in PostgreSQL in the same transaction as the month's claim (a `news.sent` outbox event), and queued from there by the worker's outbox relay, so a Redis that is down at the send, or emptied before the run, loses no run and holds no month without one.

_From 571-news-fan-out-worker._

### 571-FR-006 — The worker MUST run news jobs only when it has the token secret the unsubscribe links are signed with and the public web address the links point to; without either, it MUST log an error at start and leave the jobs queued.

_From 571-news-fan-out-worker._

### 393-FR-002 — The code message MUST hold only the code and how long it is valid, in the interface language, through one SIGN_IN_CODE WhatsApp template in Romanian and English registered like ST-392's templates; it MUST be sent from the request itself (not through the notifications outbox and without a NOTIFICATION record), so the request can answer whether it was sent; it MUST NOT count as an SMS against anyone's monthly SMS share.

_From 393-whatsapp-phone-sign-in._

### 198-FR-001 — `GET /api/v1/notification-preferences` MUST add a `staff` field to the answer of ST-197: one entry per garage the caller is staff of (an owner or receptionist by GarageMember, a mechanic by Mechanic) and one entry with no garage when the account's role is admin; a person who is none has an empty `staff`. The driver groups and types of ST-197 are unchanged.

_From 198-staff-notification-preferences._

### 198-FR-002 — Each staff entry MUST carry: the garage's id and name (both null for the admin entry), the caller's role (`owner`, `receptionist`, `mechanic` or `admin`), whether WhatsApp can be chosen and, when it cannot, why (`garage_whatsapp_off` when the garage's `whatsapp` feature is off, else `phone_not_verified` when the account has no verified phone; the admin entry has no garage and depends on the phone alone), and its sections, each with its types in catalogue order.

_From 198-staff-notification-preferences._

### 198-FR-003 — Each listed type MUST carry its channels, one per outside channel the catalogue allows it among e-mail, push and WhatsApp (never SMS; a type with no such channel has none), and for each: whether it is enabled as the send-time check reads it (the saved row; else on, except WhatsApp, which ST-197 keeps off until the person turns it on when the type goes by another channel) and whether it is locked (a locked channel always reads enabled, whatever a saved row says). When WhatsApp cannot be chosen, `enabled` still reports the saved choice; the entry's availability says it is not used.

_From 198-staff-notification-preferences._

### 198-FR-004 — The types of a garage entry MUST be, by role: the owner, every type FR-005 names (FR-005's enumeration is the authoritative Garage list: the code's catalogue has no list of its own) and the three always-sent owner types (VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED); the receptionist, the same without the owner-only types (REVIEW_POSTED, REVIEW_EDITED, STAFF_JOINED, VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED, DOCUMENT_DUE, DOCUMENT_OVERDUE, CATALOGUE_JOB_DECIDED, FACILITY_REMOVED, FACILITY_RE_ADD_DECIDED); the mechanic, BOOKING_MOVED, plus REQUEST_RECEIVED and MESSAGE_RECEIVED only while `can_answer_quotes` is set. REQUEST_REMINDER, DAY_SHEET, DIRECT_REQUEST and ADMIN_STATUS_ALERT MUST NOT be listed for anyone. DAY_SHEET_OUTDATED and DAY_SHEET_NOT_SENT MUST be listed for the owner and the receptionist only while the garage's `day_sheets` feature is not off.

_From 198-staff-notification-preferences._

### 198-FR-005 — The sections of a garage entry MUST be `requests_quotes` (REQUEST_RECEIVED, REQUEST_CANCELLED, REQUEST_EXPIRED, QUOTE_ACCEPTED, QUOTE_LOST, QUOTE_DECLINED_BY_DRIVER, QUOTE_EXPIRED, MESSAGE_RECEIVED), `bookings` (BOOKING_MOVE_REQUESTED, BOOKING_CONFIRM_REMINDER, BOOKING_MOVED, BOOKING_CANCELLED, BOOKING_LAPSED, BOOKING_MOVE_LAPSED, DAY_SHEET_OUTDATED, DAY_SHEET_NOT_SENT), `reviews` (REVIEW_POSTED, REVIEW_EDITED, REVIEW_DECIDED, REVIEW_APPEAL_DECIDED) and `account` (VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED, DOCUMENT_DUE, DOCUMENT_OVERDUE, STAFF_JOINED, CATALOGUE_JOB_DECIDED, FACILITY_REMOVED, FACILITY_RE_ADD_DECIDED), each holding only the types the role gets; an empty section is left out. The admin entry MUST have one section, `admin`, with ADMIN_VERIFICATION_QUEUED, ADMIN_REVIEW_REPORTED, ADMIN_APPEAL_RECEIVED, ADMIN_OUTAGE_ALERT, ADMIN_RULE_APPROVAL_NEEDED, ADMIN_CATALOGUE_JOB_PENDING, ADMIN_FACILITY_REQUEST and ADMIN_RECHECK_DUE.

_From 198-staff-notification-preferences._

### 198-FR-006 — A channel MUST be locked (always on, cannot be saved off) when: the type is always sent and the channel is e-mail (VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED, BOOKING_MOVE_LAPSED, BOOKING_CANCELLED, BOOKING_LAPSED, BOOKING_CONFIRM_REMINDER, FACILITY_REMOVED), their push and WhatsApp staying free; or the type is ADMIN_OUTAGE_ALERT, whose e-mail and push are both locked. DOCUMENT_DUE and DOCUMENT_OVERDUE MUST no longer be always sent: no channel of theirs is locked, but at least one MUST stay on (FR-008).

_From 198-staff-notification-preferences._

### 198-FR-007 — `PUT /api/v1/notification-preferences` MUST accept staff choices as per-type choices of ST-197 that carry the garage (none for an admin type), the type, the channel and `enabled`, and MUST answer the preferences as FR-001 reads them after the save; a save MUST stay one transaction with one audit history entry per changed row (who, garage, type, channel, old and new value) and MUST publish `notification_preferences.updated` on `account:{accountId}` as ST-197 does.

_From 198-staff-notification-preferences._

### 198-FR-008 — A staff choice MUST be refused with 422, nothing changed, when: the type is not in the caller's list for that garage (or, with no garage, not in the admin list or the account is not an admin), code `type_not_in_list`; the channel is SMS, code `channel_not_allowed`; the channel is locked for the type and `enabled` is false, code `channel_locked`; the channel is WhatsApp, `enabled` is true, and WhatsApp cannot be chosen for that entry (FR-002), code `whatsapp_unavailable`; the type is DOCUMENT_DUE or DOCUMENT_OVERDUE and the save would leave every one of its channels off, code `last_channel`, judged on the state the whole save leaves (push on and e-mail off in one save is accepted). A channel the catalogue does not give the type stays 400 `channel_not_allowed`, as in ST-197. A garage the caller is not staff of MUST answer 404 as ST-197 does. The routes stay the caller's own: no call names another account, so another person's preferences cannot be changed (the brief's 403 case cannot arise).

_From 198-staff-notification-preferences._

### 198-FR-009 — The send-time check of ST-197 MUST read a staff type's rows per account and garage, so one person's mute never changes another's channels for the same garage. A message with a garage reads the recipient's rows for that garage, one per channel, even for a type that also has a driver group (BOOKING_CANCELLED, MESSAGE_RECEIVED, …): a row is a driver choice only when it has no garage and its type has a driver group; a staff row (with a garage, or an admin type) is one per channel. A REQUEST_REMINDER MUST be checked against the recipient's REQUEST_RECEIVED rows for the message's garage, having no rows of its own. The garage's rows apply only when the recipient is staff of that garage (a member or its mechanic) and the type is on a staff list; any other recipient of a message about a garage, such as the driver it writes to, goes by their own driver choice, and a staff choice never sends a driver's push fallback e-mail.

_From 198-staff-notification-preferences._

### 068-FR-004 — DOCUMENT_DUE and DOCUMENT_OVERDUE MUST go through the notifications pipeline by e-mail and push: both not urgent, so one built in quiet hours (22:00 to 08:00 Europe/Bucharest) waits until 08:00 (194-FR-010, 196-FR-012; DOCUMENT_OVERDUE joins the not-urgent set); both become `always` sent on exactly e-mail and push (WhatsApp dropped from their channels), so the owner cannot mute them and the settings show them locked as GARAGE_SUSPENDED is (198-FR-010 changes for these two types from `keep_one` to `always`). The Romanian and English templates for e-mail, push and the bell MUST name the due date ("Reîncarcă documentele anuale până pe 15 ian. 2027" / "Upload your yearly documents again by 15 Jan 2027") and, for DOCUMENT_OVERDUE, the suspension day = `grace_until` + 1 ("…altfel profilul va fi suspendat pe 30 ian. 2027" / "…otherwise the profile will be suspended on 30 Jan 2027"), link to the garage dashboard, hold no other personal data and pass the existing template checks; the bell entry opens the dashboard's legal panel.

_From 068-yearly-documents._

### 198-FR-011 — The garage dashboard MUST gain a Setări (settings) view with no capability of its own (a view with none is shown to every role of its area), reachable by every garage role (owner, receptionist, mechanic), holding this device's push panel (which leaves the home view) and, beneath it, the Notificări panel; the admin dashboard's Setări view MUST show the Notificări panel under its push panel. The driver dashboard is unchanged.

_From 198-staff-notification-preferences._

### 198-FR-012 — The Notificări panel MUST show each of the caller's staff entries (its garage name as the heading when there is more than one, or the admin heading) with its sections and one row per type: the type's name in the person's language and the switches E-mail, Push and WhatsApp for the channels the type has; a type with no outside channel shows "Doar în aplicație" / "In the app only" instead. Each switch MUST carry a visible label and an accessible name made of the type and the channel. On a phone (320 and 390 px) the switches MUST stack under the type name and nothing MUST scroll sideways.

_From 198-staff-notification-preferences._

### 198-FR-013 — A locked switch MUST be on and disabled with "Se trimite mereu" / "Always sent". When WhatsApp cannot be chosen, the entry's WhatsApp switches MUST be off and disabled with "WhatsApp este oprit pentru acest service" / "WhatsApp is off for this garage" or "Adaugă un număr de telefon verificat" / "Add a verified phone number", by the reason.

_From 198-staff-notification-preferences._

### 198-FR-014 — A switch MUST save on toggle, optimistically; a refused or failed save MUST revert the switch and show a toast "Setarea nu a putut fi salvată" / "The setting could not be saved". While loading, the panel MUST show skeleton rows; when the read fails, it MUST show "Nu am putut încărca setările" / "Could not load the settings" with "Reîncearcă" / "Try again".

_From 198-staff-notification-preferences._

### 198-FR-015 — The panel MUST read the lists again, without a reload, on `notification_preferences.updated` for the caller's account and on `garage.features_changed` for any garage it shows.

_From 198-staff-notification-preferences._

### 198-FR-016 — Every text of the panel, the type names and the section names included, MUST exist in Romanian and English.

_From 198-staff-notification-preferences._

### 540-FR-001 — The e-mail render MUST accept a button or stop link only when its scheme is `https`, or `http` with the host `localhost` or `127.0.0.1` (any port); it MUST refuse every other value, including `http` on any other host, `javascript:`, `data:`, a relative path, a host without a scheme, an empty string, and text that is not a URL. Leading and trailing whitespace is ignored as URL parsing ignores it; the href written into the HTML is the parsed value's source text, escaped as today.

_From 540-email-link-scheme._

### 540-FR-002 — A refused link MUST fail the whole e-mail render through the existing template failure (`TemplateError`) with a reason naming the link (button or stop), so the worker marks the rows `template_failed` and sends nothing, and the template self-check reports it, with no change to either.

_From 540-email-link-scheme._

### 540-FR-003 — The check MUST apply to the stop link exactly as to the button link.

_From 540-email-link-scheme._

### 540-FR-004 — Push, SMS, WhatsApp and bell rendering, the e-mail HTML for accepted links, the contracts and the web app MUST be unchanged; the allowed set is fixed in code, with no configuration.

_From 540-email-link-scheme._

### 522-FR-001 — Once the provider has accepted a message (e-mail, SMS, WhatsApp or push), a failure writing that it was sent MUST NOT fail the send job; the processor MUST retry the write in-process up to 3 times in all.

_From 522-email-sent-once._

### 522-FR-002 — When every write of FR-001 fails, the processor MUST log an error naming the rows and the provider's message id, and the job MUST resolve, so the message is not sent again.

_From 522-email-sent-once._

### 522-FR-003 — A failure releasing the send claim after a send MUST NOT fail the job; it is logged and the claim lapses after its window.

_From 522-email-sent-once._

### 539-FR-001 — The notifications worker MUST NOT process its queue while e-mail sending is on and `PUBLIC_WEB_URL` is missing or not an absolute URL, and MUST log an error naming `PUBLIC_WEB_URL`.

_From 539-public-web-url-boot._

### 539-FR-002 — With e-mail sending off, the worker's start MUST NOT depend on `PUBLIC_WEB_URL`.

_From 539-public-web-url-boot._

### 780-FR-001 — The e-mail settings MUST take the web app address from the shared `PUBLIC_WEB_URL` reader (539-FR-003): an absolute URL as that reader normalises it, without a trailing slash.

_From 780-one-public-web-url-parser._

### 780-FR-002 — A `PUBLIC_WEB_URL` that is unset, empty or not an absolute URL MUST leave the e-mail settings without an address and MUST NOT stop the api or the worker from loading their configuration.

_From 780-one-public-web-url-parser._

### 778-FR-001 — The processor MUST retry a failed mark-sent write (522-FR-001) immediately, with no wait between the 3 tries.

_From 778-mark-sent-retry-no-delay._

### 778-FR-002 — A push the push service accepted MUST follow 522-FR-001: a failed first mark-sent write does not fail the job, the message is not sent again, and the row ends `sent`.

_From 778-mark-sent-retry-no-delay._

### 114-FR-010 — The link e-mails MUST go through the one notifications service to an address that has no account, as a direct send: never grouped, never held, in the given language, each send with a fresh event id, and a sending failure retried by the `notifications` queue with no wait on the form's request. The notifications capability gains this one direct path for LISTING_CONTINUE_LINK and LISTING_REMINDER; no other type uses it. Each send writes a notification row with no account, tied to the draft and deleted with it, holding neither the address nor the token: the address is read from the draft when the e-mail is sent and the link travels only in the queue job.

_From 114-save-draft._

### 561-FR-001 — Before calling the provider for an SMS, the processor MUST record on the row that the SMS is being sent.

_From 561-sms-sent-once._

### 561-FR-002 — A send job for an SMS row that already carries that record MUST NOT call the provider and MUST NOT count another SMS; it MUST fail the row with `sms_unconfirmed` and fall back to the next channel.

_From 561-sms-sent-once._

### 561-FR-003 — When the provider call for an SMS ends with no answer (`provider_unreachable`: a timeout or a lost connection), the SMS MUST stay counted and MUST NOT be retried; the row MUST fail with `sms_unconfirmed` and fall back to the next channel.

_From 561-sms-sent-once._

### 561-FR-004 — When the provider answers an SMS with a refusal, the processor MUST clear the record and give the count back, so the retry and fallback rules apply as before.

_From 561-sms-sent-once._

### 806-FR-001 — The worker MUST run a periodic sweep that, for every stale `queued` notification row however many there are, adds its send job under the row's usual job id and options (`send-<id>`, no delay, the same attempts, backoff and cleanup as a first add), on every channel, in one sweep: the sweep reads the rows in fixed-size pages in a fixed, stable order, continuing until a page comes back short, so no single read is unbounded and no stranded row is left behind by the rows ahead of it. (Supersedes 560-FR-001.)

_From 806-requeue-sweep-batched._

### 560-FR-002 — A row is stale when it has been `queued` for longer than the stale window (5 minutes, see Assumptions), measured from its creation time.

_From 560-requeue-stranded-notifications._

### 560-FR-003 — The sweep MUST be idempotent: adding a job whose id already exists in the queue (waiting, delayed, active or kept failed) MUST change nothing, so a row whose job is alive is never sent twice.

_From 560-requeue-stranded-notifications._

### 560-FR-004 — The sweep MUST NOT add a job for a `queued` row that carries a send claim, whether the claim is live or lapsed: such a row was handed to a send job and the system cannot know whether the provider took the message. A lapsed claim still lets the row's own job retry it (522-FR-003); it only keeps the sweep away.

_From 560-requeue-stranded-notifications._

### 560-FR-005 — The sweep MUST NOT add a job for a `queued` SMS row that carries the "being sent" mark (561-FR-001).

_From 560-requeue-stranded-notifications._

### 560-FR-006 — When the provider has accepted a message and every write recording the send has failed (522-FR-002), the processor MUST keep the row's send claim rather than release it, so FR-004 shields the row from the sweep. A release that fails for other reasons keeps 522-FR-003 as it is.

_From 560-requeue-stranded-notifications._

### 523-FR-011 — The periodic re-queue sweep MUST also take every `held` row whose `sendAfter` has passed by the stranded threshold (5 minutes) and hand it its job at once: a follower (one with a group leader) gets its leader's flush job, any other held row its own send job, under the usual job id and options. (Modifies 560-FR-007: the sweep now covers held rows past their release.)

_From 523-flush-late-follower._

### 560-FR-008 — A sweep whose read or add fails MUST log the failure and end without changing the row; the next sweep tries again.

_From 560-requeue-stranded-notifications._

### 523-FR-014 — The sweep's summary log MUST name the count of rows it re-queued and at most the first 10 ids, followed by `…` when there are more; with 10 or fewer it names them all. (Modifies 560-FR-009: the rows are named up to ten.)

_From 523-flush-late-follower._

### 560-FR-010 — The change MUST add no API route, contract, schema migration or UI.

_From 560-requeue-stranded-notifications._

### 802-FR-001 — When taking the month's SMS count fails, the processor MUST clear the row's being-sent record and fail the job with the count's error, so the retry sends the SMS rather than settling it as unconfirmed.

_From 802-sms-count-throw-clears-mark._

### 806-FR-002 — The page size MUST be one fixed value in code, with no environment variable, setting or parameter to tune it (Principle I).

_From 806-requeue-sweep-batched._

### 806-FR-003 — Each page's send jobs MUST be handed to the queue in one bulk add, not one add per row; the jobs carry the same id and options as a single add would.

_From 806-requeue-sweep-batched._

### 806-FR-004 — Everything else about the sweep MUST stay as specified: what it selects and leaves alone (560-FR-002, FR-004, FR-005, FR-007), the idempotent job id (560-FR-003), the log naming the rows it re-queued (560-FR-009), a failing read or add logging and ending the sweep (560-FR-008, where the rows of pages already handed over stay handed over and are counted), the five-minute schedule, and no API route, contract, schema migration or UI (560-FR-010).

_From 806-requeue-sweep-batched._

### 142-FR-001 — Each group row of the driver's Notificări panel (the five of 138-FR-001) MUST gain a disclosure that opens the group's notification types under the switch (closed by default; `aria-expanded` and `aria-controls` on the control). Each type shows its name in the driver's language and one channel picker, a radio group offering only the channels the catalogue gives the type, in the order E-mail, Push, SMS, WhatsApp; a type whose catalogue entry has one channel (NEWS) shows that channel as fixed text and no picker; an always-sent type is marked "Se trimite mereu" and its picker works like any other. The types' order within a group is the catalogue's order.

_From 142-notification-channels._

### 138-FR-002 — Each switch MUST show the group's state as the preferences report it; with nothing saved, every group is on except Noutăți MotorFix.

_From 138-notification-switches._

### 138-FR-003 — Under the switches the panel MUST show the always-sent line (User Story 1, scenario 2) in the driver's language.

_From 138-notification-switches._

### 138-FR-004 — Flipping a switch MUST save that one group at once (the switch shows its new position before the save answers), with no other action, and the choice MUST survive signing out and in again.

_From 138-notification-switches._

### 138-FR-005 — Turning Noutăți MotorFix on MUST first show a consent step with the consent text in the driver's language; the switch is saved on, with the text version shown, only when the driver confirms. Cancelling or closing the step MUST return the switch to off with nothing saved.

_From 138-notification-switches._

### 138-FR-006 — Turning Noutăți MotorFix off MUST save at once, with no step.

_From 138-notification-switches._

### 138-FR-007 — While the preferences load, the five switches MUST be shown disabled; a failed first load MUST show an error and a retry action.

_From 138-notification-switches._

### 138-FR-008 — A failed save MUST return the switch to its previous position and show an error toast in the driver's language.

_From 138-notification-switches._

### 138-FR-011 — The panel MUST re-read the preferences on a live preference update (a change saved in another tab or on another device), as the staff panel does. A change made by the unsubscribe link shows on the panel's next load.

_From 138-notification-switches._

### 142-FR-007 — Every text this story adds MUST exist in Romanian and English (type names, the option labels, the two hints, the usage line, the always-sent mark, the disclosure's accessible name), Romanian words joined by a hyphen using U+2011; the panel MUST work on a 320 px phone, a 390 px phone, a tablet and a desktop, in light and dark, with no sideways scroll, the options wrapping onto a second line at 320 px, each option a 44 px tap target; every picker MUST be operable by keyboard as a radio group with the type's name as accessible name and the hint as description; a disabled option MUST be exposed as disabled.

_From 142-notification-channels._

### 138-FR-013 — Every switch MUST be operable by keyboard and carry its title as accessible name with the helper line as description. The disabled loading state and the first-load error MUST be exposed to assistive technology. The consent step MUST take focus when it opens, close on Escape as a cancel, and return focus to the news switch when it closes.

_From 138-notification-switches._

### 260-FR-008 — On a request, the system MUST queue one ADMIN_RULE_APPROVAL_NEEDED notification for every admin account other than the asker (none when the asker is the only admin), carrying the asker's first name, the rule's name and the reason, with a link to the admin's Setări; the reason is user text and MUST be rendered as escaped plain text in the e-mail and the push; the type's catalogue entry MUST narrow to e-mail and push (muteable in the admin section, its urgency unchanged). The system MUST carry the type's e-mail and push texts in Romanian and English. No notification is sent on a decision or a withdrawal.

_From 260-rule-off-confirm._

### 343-FR-012 — `request.created` MUST have one registered consumer in the notifications worker which, per event, builds REQUEST_RECEIVED through the existing notification service for every recipient garage of the request: to the garage's owner(s), receptionist(s) and mechanics with `can_answer_quotes` (the existing staff lists), with the garage as the message's garage so each person's own mute for that garage applies per channel (198-FR-009), on the channels the catalogue allows (e-mail, push, WhatsApp; never SMS), WhatsApp only while the garage's `whatsapp` feature is on (392-FR-005), with push falling back to e-mail for a person with no device (196-FR-007). Parameters are the car's brand and model and the first job's name (or the description's first line, cut at 40 characters), never the plate, the phone or the whole description; the subject is the request. The job id derives from the event id so a second relay builds nothing twice (257-FR-005), and a garage that is `suspended` or no longer holds a `waiting` recipient for the request at build time gets nothing.

_From 343-live-quote-requests._

### 343-FR-013 — REQUEST_RECEIVED MUST stay `urgent` in the catalogue (built in quiet hours it goes at once, 196-FR-012 holding only non-urgent types) and MUST have its templates in Romanian and English for e-mail, push, WhatsApp and the bell, passing the template check (195-FR-009): push "Cerere nouă: {car} · {job}", bell the same line, e-mail with a link to the Cereri de ofertă view, WhatsApp the approved template's name with `car` and `job` as its parameters.

_From 343-live-quote-requests._

### 343-FR-014 — A person who muted REQUEST_RECEIVED on every channel MUST get no message and keeps the bell row (an `in_app` row is always written, 194-FR); the row still appears on their dashboard. The mute MUST be the same per-type, per-garage, per-channel choice ST-198 stores (no new preference), so the reminders story reads it as "mute covers the reminders" without a new switch.

_From 343-live-quote-requests._

### 344-FR-016 — `quote.sent` MUST have one registered consumer in the notifications worker which, per event, builds one QUOTE_RECEIVED through the existing notification service for the request's driver, subject the quote, on the channels the catalogue allows (e-mail, push, WhatsApp), honouring the driver's per-type, per-channel mute (198), with push falling back to e-mail for a person with no device (196-FR-007); parameters are the garage's name and the range in lei, never the note, the driver's data or the plate. The job id derives from the event id so a second relay builds nothing twice (257-FR-005). QUOTE_RECEIVED MUST gain its single-quote templates in Romanian and English for e-mail, push, WhatsApp and the bell, passing the template check (195-FR-009): push and bell "Ofertă nouă de la {garage}: {range} lei" / "New quote from {garage}: {range} lei", e-mail with a link to the driver's request; the grouped template stays.

_From 344-send-quote._

### 139-FR-018 — Every e-mail notice MUST be queued through the notifications queue and the phone code sent directly as the sign-in code is, all in the account's language, and every new text, including one for each refusal code this story adds (`email_taken`, `email_unchanged`, `phone_taken`, `phone_unchanged`, `send_failed`, `code_invalid`, `code_expired`, `recent_sign_in_required`, `too_many_attempts`, `invalid_credentials`, `weak_password`), MUST exist in Romanian and English, Romanian words joined by a hyphen using U+2011; text the person typed MUST never be shown back as markup.

_From 139-edit-my-details._

### 345-FR-009 — REQUEST_DECLINED MUST be built through the shipped notifications service as the catalogue lists it (event; e-mail, push, WhatsApp; group `offers`; the driver's per-channel mute honoured, the no-device fallback and quiet hours as the catalogue already applies to this group), one message per decline, parameters the garage's name and the reason code only (never the description, the plate or a phone); a muted channel sends nothing and the recipient is still marked told. A provider failure leaves the NOTIFICATION `failed` for the shipped retry.

_From 345-decline-request._

### 345-FR-010 — Templates for REQUEST_DECLINED MUST exist in Romanian and English for e-mail, push and WhatsApp (`template-check` passes): the body "<garage> nu poate prelua cererea: <clause>." / "<garage> cannot take your request: <clause>." with the clause per reason, `fully_booked` "este ocupat complet" / "it is fully booked", `job_not_done` "nu face această lucrare" / "it does not do this job", `make_model_engine_not_done` "nu lucrează pe această marcă, model sau motor" / "it does not work on this make, model or engine", `need_to_see_car` "trebuie să vadă mașina mai întâi" / "it needs to see the car first"; the e-mail subject "Un service a refuzat cererea ta" / "A garage declined your request", with the account link to the driver's request as the shipped templates link (555-FR). The reason labels and clauses MUST live in one map in the contracts library, Romanian and English, covering every reason and nothing else (a test fails when a reason lacks a label).

_From 345-decline-request._

### 209-FR-001 — The system MUST consume `verification.decided` from the outbox relay and, for each event whose `decision` is `approved`, `more_requested` or `rejected`, build one `VERIFICATION_RESULT` notification per garage owner, through the notifications service, with the outbox event id as the notification's event id and the file id as its subject id; the consumer MUST register `verification.decided` alone, so a reopen, a submission or an opening builds nothing.

_From 209-status-change-emails._

### 209-FR-002 — Recipients MUST be exactly the garage's members with role `owner` (GARAGE_MEMBER); receptionists, mechanics and every other account MUST NOT receive it. A garage with no owner, or whose owners are all deleted, MUST build nothing and MUST end the run without error.

_From 209-status-change-emails._

### 209-FR-003 — Each owner MUST get the message in their account's language (`ro` or `en`; anything else renders in Romanian), the admin's note passed as written in whatever language it was typed; owners of different languages MUST each get one message in their own language.

_From 209-status-change-emails._

### 209-FR-004 — The `VERIFICATION_RESULT` e-mail and bell entry MUST be sent whatever channels the owner muted (it is always sent, 194-FR-004); push and WhatsApp follow the existing routing (device, phone, the owner's choice); the notification settings MUST show it as locked on, not switchable.

_From 209-status-change-emails._

### 209-FR-005 — The system MUST carry a Romanian and an English template for `VERIFICATION_RESULT` for the e-mail, the push, the WhatsApp and the bell, with three variants selected by the decision (`VERIFICATION_RESULT.<decision>`): approved, more requested, rejected. Every variant MUST pass the CI template check (195-FR-009) with its example values, cedilla-free.

_From 209-status-change-emails._

### 209-FR-006 — The approved variant MUST say the garage is approved and on the map, with the button opening the garage dashboard (`/app/garage`) and the garage's public profile address (`/<language>/garages/<slug>`); it MUST name no admin and carry no reason label.

_From 209-status-change-emails._

### 209-FR-007 — The more-requested variant MUST give the reason as a label, quote the admin's note word for word, say the file is kept and can be completed without starting over (RO: "poți completa fără să o iei de la capăt"), and its button MUST open the garage dashboard (`/app/garage`).

_From 209-status-change-emails._

### 209-FR-008 — The rejected variant MUST give the reason as a label, quote the admin's note word for word, say the garage can correct the listing and send it again, and its button MUST open the garage dashboard (`/app/garage`).

_From 209-status-change-emails._

### 209-FR-009 — The reason label MUST be mapped from the stored reason code with these texts — `documents` "Documente" / "Documents", `rar` "Autorizație RAR" / "RAR authorisation", `address` "Adresă" / "Address", `photos` "Fotografii" / "Photos", `other` "Alt motiv" / "Other reason" — and any other or missing code MUST get the `other` label.

_From 209-status-change-emails._

### 209-FR-010 — The note MUST be HTML-escaped in the e-mail's HTML part and carried unchanged in the plain-text part; markup in the note MUST never be interpreted. The push body and the bell text MUST carry the decision only, never the note.

_From 209-status-change-emails._

### 209-FR-011 — A message MUST contain no data of another garage or of any driver, and no phone number or plate (the template check's privacy rule).

_From 209-status-change-emails._

### 209-FR-012 — The same event handed twice MUST write no second row and send no second message on any channel (194-FR-005 keyed by the event id); a failed run MUST be retried with exponential backoff as the request-received consumer is (6 attempts, from 1 minute), and a job lost from Redis is one message lost, not requeued.

_From 209-status-change-emails._

### 209-FR-013 — When the e-mail send fails for good, the `email` row MUST be `failed`, the `in_app` row MUST remain and show in the bell, and the verification file MUST be untouched; the dashboard status stays the record of truth.

_From 209-status-change-emails._

### 209-FR-015 — End to end, the system MUST be shown to deliver a Romanian decision e-mail to the test mailbox (the `@mailbox` flows): a `verification.decided` (approved) event recorded for a seeded garage's file leaves one Romanian `VERIFICATION_RESULT` approval e-mail to the owner in the mailbox and none to its other staff (no endpoint submits or decides a file today, plan.md R6); the auto-approval path (207-FR-009) reaching the consumer is proven by an integration test; the rejection's label and note are proven by the integration tests (FR-007..FR-010).

_From 209-status-change-emails._

### 251-FR-008 — ADMIN_OUTAGE_ALERT MUST have a registered template in English and Romanian for e-mail and push that names the service, the state and the time, holds no personal data and passes the existing template checks; accounts without the admin role MUST never receive it, and an admin's preferences, quiet hours or mutes MUST NOT stop it (the existing locks in `staff-lists.ts`, now covered by a test on the send path). It is urgent, so quiet hours never hold it (decision A37).

_From 251-monitoring-backups._

### 032-FR-002 — Any other kind MUST only be marked read; the list stays open and nothing navigates.

_From 032-notifications-bell._

### 032-FR-003 — Each bell row MUST carry the in-app address it opens, or none, derived on the server from FR-001's map: `/app/driver/cars/<car>` for the car kinds (the car being the subject), `/app/driver/requests/<request>` for the request kinds whose notification holds its request's address, the view alone otherwise. When a row with an address is tapped, the list MUST close and that address MUST open, so the view can be reopened or shared at that card.

_From 032-notifications-bell._

### 032-FR-004 — Mașinile mele and Cererile mele MUST scroll the card named in their address into view (wholly visible in the viewport at 320 px and at desktop) and give it keyboard focus, with the kit's visible focus ring, once their list has loaded, on a first load or a later one; an address naming no card, or a card not in the list, MUST change nothing.

_From 032-notifications-bell._

### 032-FR-005 — A notification whose subject no longer exists MUST still show and, when tapped, MUST open its view at the top with no error; a request-kind notification whose subject is not itself a request MUST open Cererile mele at the request it belongs to, or at the top when none is found.

_From 032-notifications-bell._

### 094-FR-013 — The message MUST be in the recipient's language (Romanian when it is neither `ro` nor `en`), name the car by brand and model and the date in the language's long day format, say how many days are left on the day it is sent (30 or 7 on the stage's own day, the true count on a catch-up; Romanian "o zi" / "de zile" as the number asks; "astăzi" / "today" when a missed run is caught up on the expiry day itself, and a count below 0 renders as missing), never show the plate, and link to Mașinile mele. The e-mail, the push and the bell MUST read, in English, "The ITP on your BMW 320d expires on 13 November 2026, in 30 days." and, in Romanian, "ITP-ul la BMW 320d expiră pe 13 noiembrie 2026, peste 30 de zile." with the e-mail and the push adding "Programează inspecția din timp." / "Book the inspection in time."; the SMS keeps a text within its 70-character limit that names no car; every text MUST pass the templates' CI check. (Modifies 032-FR-006: the bell text now also says the days left.)

_From 094-itp-reminders._

### 094-FR-014 — The reminder MUST hand the message the car's brand and model, the due date and the days left of its stage, so every channel's text renders; a row sent before a value existed falls back to the generic text. A missing value is one absent or null: the car's name is never empty, since its model is a trimmed text of at least one character (`libs/contracts/src/cars.dto.ts:65-70`). (Modifies 032-FR-007.)

_From 094-itp-reminders._

### 032-FR-008 — On a 320 px and a 390 px phone the bell with its badge MUST be visible at the right of the top bar of every driver view, with no sideways scroll, and the list MUST open as the shared bottom sheet with a close button; on desktop the list MUST keep opening in the shared drawer.

_From 032-notifications-bell._

### 222-FR-010 — `quote.accepted` MUST have one registered consumer in the notifications worker which, per event, builds one QUOTE_ACCEPTED through the existing notification service for each owner and receptionist of the quote's garage (the catalogue's staff list), never a mechanic, with params `{ driverShortName, car, slot }` (the slot written in Romania's time zone, as the platform writes its other times), skips when the booking is no longer `awaiting_confirmation` by the time it runs, and builds none twice for the same booking and recipient when the event is delivered again; the templates (bell, push, e-mail) MUST exist in Romanian and English: bell "Andrei M. a acceptat oferta ta · <car> · <slot>" / "Andrei M. accepted your quote · <car> · <slot>", push title "Ofertă acceptată" / "Quote accepted" with the same body, e-mail subject "Ofertă acceptată: <car>" / "Quote accepted: <car>" with the body naming the driver, the car, the slot and that the booking waits for the garage's confirmation; opening the notification lands on Oferte trimise.

_From 222-booking-from-quote._

### 049-FR-010 — The notifications worker MUST consume `garage.suspended` and build one GARAGE_SUSPENDED per garage owner through the notifications service, keyed by the outbox event id so a retry or a second relay never doubles it; the open suspension's cause and reason are read from the database, never from the event alone. The catalogue entry already exists (event; e-mail, push, WhatsApp; always sent); the e-mail and the bell entry go whatever the owner muted (194-FR-004), push and WhatsApp follow the existing routing, and the notification settings show the type locked on (198-FR-006).

_From 049-garage-suspension._

### 049-FR-011 — The system MUST carry a Romanian and an English GARAGE_SUSPENDED template for the e-mail, the push, the WhatsApp and the bell, saying that the profile is off the map until the problem is fixed, giving the reason as escaped plain text, naming the next step by cause (`recheck_failed`: upload the renewed RAR authorisation; `documents_overdue`: upload the yearly documents; `admin` and `report_confirmed`: answer MotorFix), with a link to the garage dashboard, holding no other personal data and passing the existing template checks; the bell entry opens the garage dashboard (`/app/garage`), through a garage-side rule added to the bell's link rules.

_From 049-garage-suspension._

### 279-FR-001 — The e-mail configuration MUST read the sending domain from `EMAIL_DOMAIN` (trimmed, lower-cased, a hostname of at least two labels). With sending on, a value that is not a hostname MUST be refused at start; with sending off it is ignored with a warning.

_From 279-email-inbox._

### 279-FR-002 — With the domain set and `EMAIL_FROM` unset, the sender MUST be "MotorFix" `no-reply@<domain>`. With both set and sending on, an `EMAIL_FROM` address whose host is not exactly the domain (compared lower-cased) MUST be refused at start, naming both settings. `SUPPORT_EMAIL` is not held to the domain. With no domain, `EMAIL_FROM` behaves as today.

_From 279-email-inbox._

### 279-FR-004 — Every e-mail the notifications queue sends MUST carry the support address as its reply-to when one is configured, and none when none is. Sender, reply-to and the one-click headers MUST be set by one function that the queue and the inbox test both use. The support message to the support mailbox MUST keep the sender of the message as its reply-to.

_From 279-email-inbox._

### 279-FR-005 — The DNS expectations MUST follow from the domain: SPF, exactly one `v=spf1` TXT record on the domain that includes `spf.brevo.com`; DKIM, Brevo's two CNAME records `brevo1._domainkey` and `brevo2._domainkey` pointing under `dkim.brevo.com`, or a TXT record at `mail._domainkey` holding a public key (`p=`); nothing at any of these names reads `missing`, and anything else (one CNAME of the two, a target outside `dkim.brevo.com`, a TXT without `p=`) reads `wrong`, naming the record; DMARC, one TXT record at `_dmarc.<domain>` starting `v=DMARC1` with a policy `none`, `quarantine` or `reject` and a `rua` report address.

_From 279-email-inbox._

### 279-FR-006 — A DNS check command MUST look up the records of FR-005 for the configured domain through a resolver it is given, report each of SPF, DKIM and DMARC as `ok`, `missing`, `wrong` (with the reason) or `unreachable`, print the expected value for each that is not ok, note a `p=none` DMARC policy with the move to `quarantine` after 4 clean weeks, and exit 0 only when all three are ok. With no domain configured it MUST exit 1 saying so.

_From 279-email-inbox._

### 279-FR-007 — An inbox test command MUST build its matrix from every e-mail template in the template registry, in Romanian and in English, for every address in `INBOX_TEST_TO` (comma-separated, trimmed, lower-cased, duplicates once), each row rendered from the template's example values with the web app's address as the link base.

_From 279-email-inbox._

### 279-FR-008 — The matrix MUST include the support acknowledgement, the admin outage alert (down and back), the sign-up check e-mail, the password reset and password changed e-mails, the continue-the-listing link and both staff invites, and MUST hold no release-2 type (photos, video, live).

_From 279-email-inbox._

### 279-FR-009 — With `--dry-run` the inbox test MUST print every row (type, language, mailbox, subject) and send nothing; a row whose template fails to render MUST be printed as failed and make the run exit 1.

_From 279-email-inbox._

### 279-FR-010 — Without `--dry-run` the inbox test MUST refuse to send anything, exiting 1 with the reason, when sending is off, no Brevo key is set, no domain is set, no test mailbox is given, or a test mailbox would be blocked by the rule the queue applies to every send (`EMAIL_ALLOWLIST` outside production, `blockedReason`). Otherwise it MUST send each row once directly through Brevo (no queue), built by the function of FR-004, continue past a refused row, print each row's message id or failure, and exit 1 when any row failed.

_From 279-email-inbox._

### 279-FR-011 — The news e-mail of the inbox test MUST carry `List-Unsubscribe: <https link>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, as the notifications queue sends it; no other row MUST carry them.

_From 279-email-inbox._

### 279-FR-012 — Both commands MUST run from the built worker (`node dist/apps/worker/main.js inbox-test [--dry-run]`, `node dist/apps/worker/main.js email-dns-check`) without starting the worker's queues or HTTP listener, and `.env.example` MUST document `EMAIL_DOMAIN` and `INBOX_TEST_TO`.

_From 279-email-inbox._

### 069-FR-007 — The notifications worker MUST consume `garage_report.decided` and queue one GARAGE_REPORT_DECIDED per distinct reporter, keyed by the outbox event id and the reporter so a retry never doubles it, in the reporter's language, with the garage's name: for `unfounded` "Am verificat sesizarea ta despre <garage>. Nu a fost nevoie de nicio măsură." / "We checked your report about <garage>. No action was needed."; for `confirmed` "Am verificat sesizarea ta despre <garage> și am luat măsuri." / "We checked your report about <garage> and took action.". The message MUST carry neither the admin's note nor the suspension reason. GARAGE_REPORT_DECIDED is a new catalogue entry in the driver section: bell, e-mail and push on the channels the driver chose, muteable like ST-312's report messages; its bell row opens the garage's profile.

_From 069-report-decision._

### 1351-FR-009 — The system MUST carry a Romanian and an English ADMIN_RECHECK_DUE template for e-mail and push reading "{n} service-uri de reverificat în registrul RAR" / "{n} garages to re-check in the RAR register" ("1 service" / "1 garage" for one), linking to the admin list, holding no other data, and passing the existing template checks (195-FR-009).

_From 1351-rar-monthly-recheck._
### 1190-FR-001 — Every in-app notification row MUST carry an ordered position, unique per account and increasing with creation, kept with the row; the migration gives every existing row its position in creation order.

_From 1190-live-reconnects._

### 1352-FR-015 — On every `catalogue_job.proposed` event, whichever write saved it (this story's or the listing's), every admin MUST get ADMIN_CATALOGUE_JOB_PENDING: bell "{garage} a propus lucrarea „{job}”" / "{garage} proposed the job "{job}"", e-mail and push with the garage's name, the job's name and a link to the admin dashboard, under the admins' preference group so it can be muted (the catalogue already lists it as an event notice, e-mail and push, not always sent); the shape of ADMIN_VERIFICATION_QUEUED.

_From 1352-catalogue-job-visibility._

### 389-FR-011 — A reminder kind MUST build one BOOKING_CONFIRM_REMINDER per owner and receptionist of the garage (the catalogue's staff list, never a mechanic) through the notification service, on the catalogue's channels (e-mail, push, WhatsApp), never held by quiet hours and not mutable, at most once per booking, kind and recipient (a repeated fire builds none); the templates MUST exist in Romanian and English: bell and push "Confirmă programarea lui <driver> · <car> · <slot> · mai ai <time left>" / "Confirm <driver>'s booking · <car> · <slot> · <time left> left", e-mail subject "Confirmă programarea: <car>" / "Confirm the booking: <car>" with the body naming the driver, the car, the slot and when the booking lapses; opening one lands on Oferte trimise.

_From 389-confirm-booking-lift-mechanic._

### 389-FR-013 — `booking.confirmed` and `booking.lapsed` MUST each have one registered consumer in the notifications worker: for `booking.confirmed`, one BOOKING_CONFIRMED to the driver (the catalogue's `bookings` group, always sent) with the templates bell and push "Programare confirmată · <garage> · <slot>" / "Booking confirmed · <garage> · <slot>", e-mail subject "Programare confirmată: <garage>, <slot>" / "Booking confirmed: <garage>, <slot>", opening on Cererile mele; for `booking.lapsed`, one BOOKING_LAPSED to the driver, "Service‑ul nu a confirmat. Alege altă ofertă." / "The garage did not confirm. Choose another quote." (bell, push, e-mail subject "Programarea nu a fost confirmată" / "The booking was not confirmed"), opening on Cererile mele, and one per owner and receptionist of the garage, "Programarea lui <driver> a expirat neconfirmată" / "<driver>'s booking lapsed unconfirmed", opening on Oferte trimise; each built at most once per booking and recipient when the event is delivered again. QUOTE_LOST for the losing garages is #147's and is not built here.

_From 389-confirm-booking-lift-mechanic._

### 428-FR-009 — The notifications module MUST react to `request.cancelled` with a fan-out that sends REQUEST_CANCELLED, with the param `reason`, once to every owner and receptionist of each garage in `garageIds`, keyed by the outbox event id; mechanics and the driver are never told.

_From 428-close-on-account-closed._

### 1258-FR-005 — The notifications module MUST react to `booking.cancelled` with side `driver` (modifying 428-FR-010, whose fan-out today handles `driver_account_closed` only and logs every other reason as not its own) by sending BOOKING_CANCELLED once per outbox event to every owner and receptionist of the booking's garage and to the booking's mechanic when that mechanic has an account; the driver is not told (the driver did it). The type keeps its catalogue entry (event; e-mail, push, WhatsApp; `bookings` group; always sent, so its e-mail is locked and push and WhatsApp follow the recipient's choices), and quiet hours do not hold it: a booking change goes at any time.

_From 1258-driver-cancel._

### 223-FR-005 — REQUEST_CANCELLED MUST render through FR-003's template from the fan-out's existing `driver` and `reason` params; the generic text no longer fills in for it (428-FR-011 keeps the generic fallback for BOOKING_CANCELLED only).

_From 223-request-act-notifications._

### 414-FR-009 — On every `catalogue_job.decided` event, the proposing garage's owner MUST get CATALOGUE_JOB_DECIDED (already registered: e-mail, push and bell; mutable, so a muted owner keeps the bell entry only) from a template in the templates folder with two variants: approved — bell and push "Lucrarea „{job}” a fost aprobată și apare pe profilul tău." / "The job "{job}" was approved and is on your profile.", e-mail subject "Lucrarea {job} a fost aprobată" / "The job {job} was approved"; rejected — "Lucrarea „{job}” a fost respinsă: {reason}" / "The job "{job}" was rejected: {reason}", e-mail subject "Lucrarea {job} a fost respinsă" / "The job {job} was rejected". `{job}` is the catalogue's Romanian name in Romanian and English name in English (the proposed text on a rejection, where both are the same); the button and link open Prețuri; the template carries its example values. No notice goes out when the garage no longer exists; the garage's other staff get none (the staff list already says owner). The rejection reason is admin-typed text: every channel renders it as plain, escaped text and never as markup. The push body is limited to 120 characters, so the push is the short form, "„{job}” e acum pe profilul tău." / "„{job}”: motivul e în Prețuri." (and their English twins), the reason left to the bell and the e-mail, as DOCUMENT_REFUSED does. A `{job}` that would take the push body past 120 characters (UTF-16 units) is shortened with "…" there; the bell and the e-mail carry it whole.

_From 414-approve-catalogue-job._
### 067-FR-008 — The notifications worker MUST consume `garage.restored` and build one GARAGE_RESTORED per garage owner through the notifications service, keyed by the outbox event id so a retry or a second relay never doubles it, following the GARAGE_SUSPENDED fan-out's shape (049-FR-010). The catalogue entry already exists (event; e-mail, push, WhatsApp; always sent) and is unchanged: the e-mail and the bell entry go whatever the owner muted (194-FR-004), push and WhatsApp follow the existing routing, and the settings keep showing the type locked on. The system MUST carry a Romanian and an English GARAGE_RESTORED template for the e-mail, the push, the WhatsApp and the bell reading "Profilul tău este din nou pe hartă." / "Your profile is back on the map.", naming the garage, linking to the garage dashboard, holding no other personal data and passing the existing template checks; the bell entry opens `/app/garage`. The owner's language decides the template.

_From 067-restore-suspended-garage._

### 523-FR-002 — No row of a closed window MUST stay `held` past its `sendAfter` plus one flush cycle (one flush job's rounds), whatever happened to the first add of its flush job.

_From 523-flush-late-follower._

### 523-FR-003 — Before it sends, a flush MUST claim the leader's held rows with the same claim lease a send uses (one conditional update that takes a row holding no claim or a lapsed claim), and MUST send only the rows its update changed.

_From 523-flush-late-follower._

### 523-FR-004 — Two flush jobs for one leader running at once MUST send exactly one grouped e-mail, every held row of the window set `sent` once.

_From 523-flush-late-follower._

### 523-FR-005 — A flush whose rows another live claim holds MUST send nothing and fail, so the queue retries it after its backoff.

_From 523-flush-late-follower._

### 523-FR-006 — A flush whose claim lapsed (the worker died holding it) MUST be taken over by its retry, which sends the grouped e-mail once.

_From 523-flush-late-follower._

### 523-FR-007 — A flush MUST release its claims (and only its own) when its send ends; it MUST keep them when the provider accepted the e-mail but every write recording the send failed (as 560-FR-006 for a send); and it MUST give them back when the provider answered with a retryable error, so the next attempt sends the rows.

_From 523-flush-late-follower._

### 523-FR-009 — A worker whose clock runs 60 s or more ahead of the database MUST NOT take over a claim that is still live on the database clock.

_From 523-flush-late-follower._

### 523-FR-010 — The lease edge MUST hold to a one-second margin: a claim one second short of the lease on the database clock is refused, a claim one second past it is taken over and the row sent once; the processor's existing integration specs pass with their claim times stamped relative to the database clock.

_From 523-flush-late-follower._

### 523-FR-012 — The held sweep MUST leave a held row that carries a send claim (live or lapsed), an SMS being-sent mark or a listing draft.

_From 523-flush-late-follower._

### 523-FR-013 — The queued-row sweep MUST stay as specified (806-FR-001 and its referenced requirements); the held sweep is a separate pass the requeue job runs after the queued one, and a failure in either pass MUST NOT stop the other.

_From 523-flush-late-follower._

### 523-FR-015 — When the queue rejects a bulk add part way through the paged sweep, the sweep's count MUST hold only the rows the queue accepted, never the rows it rejected.

_From 523-flush-late-follower._
### 520-FR-001 — The worker's start-up Brevo key check MUST tell a refused key from an unreachable Brevo: a network error, a timeout, any 5xx and 429 are *unreachable*; 401, 403 and any other non-2xx answer are *refused*; 2xx passes.

_From 520-brevo-key-check-retry._

### 520-FR-002 — While the check is unreachable the worker MUST retry it in place, never crash and never block its boot: the first retry after 1 s, each next delay double the previous up to a cap of 60 s, counted from the end of the failed attempt, until an attempt passes or the worker shuts down; the HTTP listener MUST be up while it waits, and a shutdown MUST cancel the pending retry and start no consumer afterwards.

_From 520-brevo-key-check-retry._

### 520-FR-005 — Each failed unreachable attempt MUST log one warning naming the attempt number, the reason (network error, timeout or the status) and the delay before the next attempt, never the key; no new metric or alert is added and `infra/observability/inventory.json` is unchanged, because the health check (Railway's and ST-294's `api` probe path) and the existing `motorfix_queue_waiting` and `motorfix_queue_oldest_waiting_seconds` gauges for the `notifications` queue already surface a worker that is not consuming.

_From 520-brevo-key-check-retry._

### 1370-FR-007 — Recording a hard bounce MUST lock the account row inside the claiming transaction before reading `emailBouncedAt`, MUST write one audit entry for that field per claimed bounce (old value the mark read under the lock, new value the mark written) even when the value is unchanged, and MUST never move the mark backwards: the written mark is the later of the mark read and the bounce's time; the adversary spec's concurrent case MUST pass on every one of its repetitions against local PostgreSQL.

_From 1370-release-seed-no-ssh._

### 525-FR-002 — The bounce MUST be recorded at most once per provider message id: the transaction MUST claim the message's not-yet-failed notification rows with a conditional write, and when it claims none (a repeated or concurrent report of the same message, an unknown id, or rows already failed) it MUST write no account change, no audit entry and no event. A bounce of a message with no account (a draft's address) MUST fail its rows as today and record no event. A later bounce of a different message to the same account MUST record a new event. The push fallback rows of the claimed rows MUST be written in that same transaction (their send jobs queued after it commits; a lost job is handed over by the stranded-row sweep), so a crash after the commit cannot lose the fallback that a retry would no longer write (decision taken for the owner by Chief 1 on the code review, 2026-10-24).

_From 525-bounce-domain-event._

### 140-FR-006 — When the file is ready, the system MUST queue one DATA_EXPORT_READY e-mail (a new notification type in the catalogue with ACCOUNT_EMAIL's shape: direct to the account itself, e-mail only, transactional so it cannot be muted, in the account's language, subject "Fișierul tău cu date e gata" / "Your data file is ready") linking to Setări of the driver's dashboard; an account without a usable e-mail skips it and the skip is logged.

_From 140-account-delete-export._
### 003-FR-022 — The system MUST carry an ACCOUNT_EMAIL purpose `account_suspended` with a Romanian and an English template: subject "Contul tău a fost suspendat" / "Your account was suspended", a body that gives the reason as escaped plain text, the support address when one is configured (279-FR-003) and a button linking to the contact page `/{lang}/contact`, and a footer saying why the person gets it; it is transactional (no preference switches it off), follows the sender's bounce rule, passes the template check and joins the inbox-test matrix (279-FR-007) by being registered.

_From 003-admin-account-actions._

### 1156-FR-005 — The job MUST delete every notification row, whatever its channel or status, created more than the configured notification period ago; a younger row that referred to a deleted one as its group leader or fallback source MUST keep everything else and lose only the reference; each account's stored unread count MUST equal its remaining unread in-app rows after the sweep.

_From 1156-retention-job._

### 142-FR-002 — Picking a channel MUST save that one type at once (the option shows as chosen before the save answers), with no other action, through the existing preferences save, carrying the type's last-read `enabled` unchanged; a failed save MUST return the picker to the channel the last read gave and show an error toast in the driver's language; the panel MUST re-read on the existing live preference update, keeping choices still in flight as the switches do (138-FR-011).

_From 142-notification-channels._

### 142-FR-003 — The preferences read MUST tell whether the caller's phone is confirmed (`phoneVerified`, from the account's phone and its confirmation time). While it is false the panel MUST show every SMS and WhatsApp option disabled with one hint per opened group, "Adaugă și confirmă numărul de telefon în Datele tale." / "Add and confirm your phone number in Your details."; the save MUST refuse a driver choice on `sms` or `whatsapp` with 422 `phone_not_verified`, nothing changed, when the phone is not confirmed (the staff lists keep their own `phone_not_verified` reason).

_From 142-notification-channels._

### 142-FR-004 — The preferences read MUST carry the SMS sent to the caller in the current calendar month in Europe/Bucharest and the monthly cap (`sms: { used, cap }`, `used` 0 with no row). When `used` equals the cap, the panel MUST show "Ai folosit 5 din 5 SMS luna aceasta; următoarele merg pe WhatsApp." / "You have used 5 of 5 SMS this month; the next ones go by WhatsApp." once under each opened group that has a type offering SMS; below the cap nothing is shown. The month turns over at 00:00 Europe/Bucharest on the 1st, as the counter does.

_From 142-notification-channels._

### 142-FR-006 — Picking Push MUST first make this browser a push device through the existing push device flow (the permission prompt only after the tap, 196-FR-004): when the browser is already a saved device the choice is saved with no prompt; when permission is granted the device is saved, then the channel; when it is refused or dismissed, or the browser is blocked, unsupported or an iPhone outside the Home Screen, the channel is still saved if the read says the account has a push device (`pushDevice`), and otherwise the choice stays as it was, nothing is saved, and the hint of the push panel's matching state is shown under the picker ("Notificările sunt blocate în browser" with the unblock steps, the Home Screen hint, or that this browser cannot show them).

_From 142-notification-channels._

### 142-FR-008 — Every saved channel change MUST stay one audit entry with old and new `{channel, enabled}` (as today) and MUST increment a product counter `motorfix_notification_channel_choices_total` labelled `channel` (email, push, sms, whatsapp); every send-time change of channel (a push row with no device, an SMS over the cap, an SMS or WhatsApp without a confirmed phone, a push or e-mail fallback after a failed send) MUST increment `motorfix_notification_channel_fallbacks_total` labelled `from`, `to` (each one of email, push, sms, whatsapp) and `reason` (a fixed set: `no_device` for a push with no device or every device gone; `phone_not_verified` for no phone, an unconfirmed phone or a blocked number; `sms_cap_reached`; `send_failed` for every other reason), counted only when a row is written on another channel, `to` being that row's channel, with no id, address or text as a label; an alert rule `notification-fallback-rate` fires when more than 20 fallbacks are counted over one hour for 15 minutes (the threshold and its reasoning are in research R11); both counters and the alert are listed in `infra/observability/inventory.json` and the PR's Notes list the reports they make possible.

_From 142-notification-channels._

### 142-FR-009 — Every route touched stays under `ActorGuard`, acts on the caller's own account only and names no account id in any path; a driver cannot read or set another driver's channels (there is no call that could).

_From 142-notification-channels._

### 142-FR-010 — The Build brief's scenarios 1 to 11 MUST each be an automated test: (1) Scadențe lists ITP, RCA, Rovinietă, Anvelope, Revizie, each with E-mail, Push, SMS, WhatsApp (unit, web); (2) SMS for ITP sends the next ITP reminder by SMS and counts it (API); (3) the 6th SMS of the Bucharest month goes by WhatsApp, the fallback is counted, and the read gives `used` 5 with the usage line shown (API + unit, web); (4) Ofertă nouă offers E-mail, Push, WhatsApp only and SMS is refused for its types (API + unit, web); (5) no confirmed phone: SMS and WhatsApp refused on save and disabled with the hint (API + unit, web); (6) Push asks the browser; a refusal keeps the choice with the hint (unit, web); (7) the default is push with a device and e-mail without, at read and at send (unit + API); (8) JOB_READY's channel can be picked but it cannot be switched off (API); (9) NEWS is fixed to e-mail (unit, web + API); (10) a change is saved at once, audited old and new, counted, and the next message uses it (API); (11) REVIEW_INVITE offers E-mail, Push, WhatsApp and refuses SMS (API). Besides: the month turning on the 1st in Europe/Bucharest (unit); end to end, choose WhatsApp for ITP and SMS for tyres and read them back, the phone hint, the usage line.

_From 142-notification-channels._

### 223-FR-001 — The system MUST carry a QUOTE_LOST template in Romanian and English for the bell, push, e-mail and WhatsApp, passing the existing template check: bell and push "Clientul a ales alt service." / "The customer chose another garage.", the e-mail with the same line and a link to the garage's requests view (the one garage requests screen, `/app/garage/requests`; no separate Oferte trimise route exists), the WhatsApp a template name that ST-1278 submits to Brevo for approval (the name is declared here, the approval is out of scope); the template uses no plate, phone or driver value; the bell and e-mail may name the car (brand and model) so the garage knows which request it was.

_From 223-request-act-notifications._

### 223-FR-002 — `quote.closed` MUST have one registered consumer in the notifications worker which, per event, builds one QUOTE_LOST per closed quote (subject the quote) for each owner and receptionist of that quote's garage (the catalogue's staff list, never a mechanic), with the garage as the message's garage so each person's own mute for that garage applies per channel (198-FR-009), on the channels the catalogue allows (e-mail, push, WhatsApp; never SMS), WhatsApp only while the garage's `whatsapp` feature is on, push falling back to e-mail for a person with no device; keyed by the existing (type, recipient, channel, outbox event id) dedupe so a retry or a second relay builds nothing twice; a failed run is retried with exponential backoff like the other fan-outs.

_From 223-request-act-notifications._

### 223-FR-003 — The system MUST carry a REQUEST_CANCELLED template in Romanian and English for the bell, push, e-mail and WhatsApp, passing the template check, in two wordings picked by the `reason` param: `account_closed` renders "Cererea a fost închisă." / "The request was closed."; any other value renders "{driver} a anulat cererea." / "{driver} cancelled the request." with `driver` the driver's short name ("Andrei M."); the e-mail links to the same garage requests view; no plate or phone value.

_From 223-request-act-notifications._

### 223-FR-006 — The new consumer MUST be registered where the other fan-outs are (the notifications module, the worker's consumer list, the domain export) and its queue listed in the observability inventory with its panel and alert, as every queue is.

_From 223-request-act-notifications._

### 223-FR-007 — *(verification)* REQUEST_RECEIVED, QUOTE_RECEIVED and QUOTE_ACCEPTED MUST keep their shipped templates and fan-outs unchanged, and `request.created`, `quote.sent` and `quote.accepted` MUST each have exactly one notifications fan-out consumer in the worker (another kind of consumer, such as the booking timers on `quote.accepted`, may listen beside it).

_From 223-request-act-notifications._

### 223-FR-008 — *(verification)* A garage member's per-channel mute of REQUEST_RECEIVED for a garage MUST silence that channel for both REQUEST_RECEIVED and REQUEST_REMINDER of that garage; the other channels follow their own switches and the bell row is written whatever is muted.

_From 223-request-act-notifications._

### 223-FR-009 — *(verification)* A driver who muted the group Ofertă nouă MUST get QUOTE_RECEIVED on no outside channel; the bell row is written and the request's quotes still show in the driver's panel.

_From 223-request-act-notifications._

### 223-FR-010 — *(verification)* While a garage's `whatsapp` feature is off, none of its staff MUST get WhatsApp for REQUEST_RECEIVED, QUOTE_ACCEPTED, QUOTE_LOST or REQUEST_CANCELLED (QUOTE_RECEIVED goes to the driver, whose WhatsApp follows his own choice); e-mail and push are unaffected.

_From 223-request-act-notifications._

### 223-FR-011 — *(verification)* None of the five types MUST ever be sent by SMS, and no rendered text of them MUST hold the car's number plate or the driver's phone; the driver is named by first name and surname initial.

_From 223-request-act-notifications._

### 223-FR-012 — *(verification)* QUOTE_LOST and REQUEST_CANCELLED MUST stay urgent: one built between 22:00 and 08:00 Europe/Bucharest goes at once, not held to 08:00.

_From 223-request-act-notifications._

### 223-FR-013 — *(verification)* The same event delivered twice MUST leave each recipient with one row per type, subject and channel and send no second message, for QUOTE_LOST and REQUEST_CANCELLED.

_From 223-request-act-notifications._

### 223-FR-014 — *(verification)* When the e-mail provider fails for good, the `email` row of QUOTE_LOST or REQUEST_CANCELLED MUST be `failed` after the existing retries and the `in_app` row MUST remain and show in the bell.

_From 223-request-act-notifications._

### 223-FR-015 — *(verification)* A recipient whose language is English MUST get QUOTE_LOST and REQUEST_CANCELLED in English on every channel, including the bell.

_From 223-request-act-notifications._

### 223-FR-016 — Tests MUST exist before the code (Principle II), in Jest: the two templates render in both languages on every channel, both REQUEST_CANCELLED wordings by `reason`, and the template check passes with no plate or phone value (FR-001, FR-003, FR-005, FR-011, FR-015); the `quote.closed` fan-out's recipients per quote (owner and receptionist yes, mechanic and the winning garage no), its muted channel, the garage `whatsapp` off, no SMS, no second row on a replayed event, the urgent flag (FR-002, FR-010, FR-012, FR-013); the account-closed audience with a waiting, a quoted-waiting, a declined and a quoted-ended recipient on real PostgreSQL (FR-004); the single consumer per earlier event, the REQUEST_RECEIVED mute covering REQUEST_REMINDER, the driver's Ofertă nouă mute, and the failed e-mail with the surviving bell row (FR-007, FR-008, FR-009, FR-014); each test file carrying a whole-line `// @traces` comment naming its `223-FR-<n>` ids.

_From 223-request-act-notifications._

### 094-FR-010 — A DUE_ITP MUST go on the channel the driver chose for DUE_ITP (e-mail, push, SMS or WhatsApp); an SMS beyond the driver's 5 SMS in the calendar month (Europe/Bucharest) MUST go by WhatsApp and count as the fallback it is; a push with no device that allows push MUST go by e-mail; an SMS or WhatsApp with no confirmed phone MUST go by e-mail.

_From 094-itp-reminders._

### 094-FR-011 — DUE_ITP is a non-urgent message: an outside send (e-mail, push, SMS, WhatsApp) that would go between 22:00 and 08:00 Europe/Bucharest — a retry, a catch-up — MUST be held until 08:00 local time, correct across clock changes; its bell row MUST be written at once. The 09:00 run itself is never held.

_From 094-itp-reminders._

### 094-FR-012 — When the sending provider fails, the outside send MUST be retried on the notifications queue's own schedule (5 retries at 1, 5, 15, 60 and 240 minutes); then a failed push or WhatsApp MUST fall back once to e-mail, and a send with no fallback left MUST be `failed`, the bell MUST still list it, and the reminder's stage MUST count as sent so the next run does not repeat it. Sending a reminder MUST write no audit entry: the message row is its record.

_From 094-itp-reminders._

### 074-FR-012 — On `review.posted`, a background job (a new outbox-relay consumer queue in the worker, as the `quote-received` fan-out) MUST send REVIEW_POSTED to every owner member of the garage, through the garage staff preferences (the `reviews` group: e-mail, push or WhatsApp by the owner's choice, the no-device fallback, never SMS), with the text "Recenzie nouă de {rating} de la {author} pentru {car}" / "New {rating}-star review from {author} for a {car}" for a job review and "Recenzie nouă de {rating} de la {author}" / "New {rating}-star review from {author}" for a profile review, the author as FR-003's short name and the car as the request's brand and model. A receptionist and a mechanic MUST get none. The text is in the recipient's interface language.

_From 074-garage-reviews._

### 074-FR-013 — REVIEW_POSTED MUST be sent at most once per owner per review: the outbox event id and the recipient key the notification so a retry or a second relay writes nothing more; when the owner's reviews group is off at send time nothing is sent; when the review no longer exists or the garage has no owner the job logs it and ends without writing. The bell row of a REVIEW_POSTED MUST open the garage's Recenzii view.

_From 074-garage-reviews._

### 1257-FR-002 — REQUEST_REMINDER MUST go to the people REQUEST_RECEIVED goes to for that garage (owners, receptionists and the mechanics allowed to answer quotes), on the catalogue's channels, with each person's mute of REQUEST_RECEIVED covering it (the shipped mapping, `rowsType` in libs/domain/src/notifications/preferences/preferences.ts); a garage whose every recipient is muted gets no outside message (the bell entry is written, as `NotificationsService` mutes outside channels only), and the recipient's reminder timestamp MUST still be set so it is never retried.

_From 1257-quote-reminders._

### 1257-FR-003 — REQUEST_REMINDER MUST stay a non-urgent type in the catalogue, so one built between 22:00 and 08:00 Europe/Bucharest is held and sent at 08:00 by the shipped quiet-hours rule; the timer itself is set at the reminder's own time.

_From 1257-quote-reminders._

### 1257-FR-005 — Each garage whose recipient was expired by FR-004 MUST get one REQUEST_EXPIRED (owners and receptionists), and the driver of a request closed `expired` by FR-004 or FR-007 MUST get one REQUEST_EXPIRED whose link opens the driver's request page (`/app/driver/requests/<id>`) and whose text carries the call to action "Cere oferte de la alte service-uri" / "Ask other garages for quotes"; both through the shipped notification service, on the catalogue's channels, with the person's mute honoured and the quiet-hours rule of each type's shipped catalogue flag (no new flag is added; a type the catalogue marks urgent goes at once).

_From 1257-quote-reminders._

### 1257-FR-008 — A quote expired by FR-006 MUST tell the driver and the garage's owners and receptionists with one QUOTE_EXPIRED each, through the shipped notification service, on the catalogue's channels, with the person's mute honoured; a quote the lapse path expires (reason `booking_lapsed` or `held_past_validity`) is not told again here (BOOKING_LAPSED already tells both sides).

_From 1257-quote-reminders._

### 1257-FR-009 — REQUEST_REMINDER, REQUEST_EXPIRED and QUOTE_EXPIRED MUST have registered templates in Romanian and English for e-mail, push and WhatsApp that name the car and the garage (the driver's REQUEST_EXPIRED names the request's car and carries FR-005's call to action and link; the garage's name the car and the driver's short name), hold no personal data beyond that, and pass the existing template tests; the bell entry of each MUST open the request on the reader's side (the driver's request page); the garage's bell entry carries no link, as the shipped bell gives none to any garage row (`bell.service.ts`, REQUEST_RECEIVED included).

_From 1257-quote-reminders._

### 091-FR-011 — The daily run (09:00 Europe/Bucharest) MUST send SERVICE_DUE for a `service` reminder exactly as it sends DUE_ITP (094-FR-001, 002, 004, 005, 010, 011, 012): 30 and 7 days before `due_on`, once each per reminder id, caught up after a missed run, none for a removed car or a deleted account, on the channel chosen for SERVICE_DUE with the SMS cap and WhatsApp fallback, muted by the Scadențe group (the bell row still written), non-urgent so an outside send in quiet hours waits until 08:00, retried on the queue's own schedule.

_From 091-oil-service-due._

### 091-FR-012 — SERVICE_DUE MUST have templates in Romanian and English for e-mail, push, SMS, WhatsApp and the bell, passing the templates' CI check (195-FR-009): the bell, the push and the e-mail read "Schimbul de ulei la <brand> <model> este estimat pe <long date>, peste <n> zile." / "The oil service on your <brand> <model> is estimated for <long date>, in <n> days." with the days rendered as 094-FR-013 renders them (Romanian "o zi" / "de zile", "astăzi" / "today" on the day itself); the e-mail and the push add "Programează schimbul de ulei din timp." / "Book the oil service in time." and link to Mașinile mele; the SMS keeps a text within 70 characters that names no car; the WhatsApp template renders its approved name and ordered parameters; no text shows the plate. The reminder MUST hand the message the car's brand and model, the due date and the days left (094-FR-014's parameters), so every channel renders.

_From 091-oil-service-due._

### 091-FR-016 — Every SERVICE_DUE text this story sends MUST exist in both Romanian and English; the kilometres and dates in them MUST use the recipient's formats.

_From 091-oil-service-due._

### 1258-FR-006 — BOOKING_CANCELLED MUST get the driver-cancel texts this story owns (428-FR-011), in Romanian and English, from a template in the templates folder with its example values: bell and push "<driver> a anulat programarea · <car> · <slot>" / "<driver> cancelled the booking · <car> · <slot>", e-mail subject "Programare anulată: <car>, <slot>" / "Booking cancelled: <car>, <slot>", the e-mail body naming the driver (short name), the car, the slot, the reason's label ("Mi s-au schimbat planurile", "Am găsit alt service", "S-a rezolvat problema", "Altceva" / "Plans changed", "Found another garage", "Problem solved", "Other"), the note when there is one (rendered as plain, escaped text, never as markup; the bell carries it whole, the push never), and the line "Anulare târzie (sub 2 ore înainte), fără penalizare." / "Late cancellation (under 2 hours before), no penalty." when `late` is true; opening one lands on Oferte trimise. The account-closed variant's text is unchanged.

_From 1258-driver-cancel._

### 1258-FR-007 — REQUEST_CANCELLED for a driver's cancel MUST reach every owner and receptionist of each recipient garage once through the existing `request.cancelled` fan-out (428-FR-009), with `reason` `driver`; the fan-out needs no change beyond the test for this reason. Its texts stay #147's: until that story writes them the generic bell and e-mail text fills in, as 428-FR-011 allows.

_From 1258-driver-cancel._

### 177-FR-011 — On every `review.reported` event, the system MUST send ADMIN_REVIEW_REPORTED (the existing catalogue entry, admin group, muteable) once per event to every active admin account, in the admin's language: for a review "{garage} a raportat o recenzie de {score}: {reason}" / "{garage} reported a {score} review: {reason}", for a reply "{author} a raportat răspunsul lui {garage}: {reason}" / "{author} reported {garage}'s reply: {reason}", for an automatic flag "O recenzie de {score} a fost raportată automat: {reason}" / "A {score} review was flagged automatically: {reason}", by e-mail and push with a link to the admin queue; each notification is keyed by the event's outbox id, so a redelivered event sends nothing more; admins get no SMS or WhatsApp for it (the catalogue entry narrows to e-mail and push).

_From 177-reported-reviews._

### 177-FR-012 — On the `review.reported` event (its consumer, not the report's write) the system MUST schedule one reminder for its due time (48 hours after creation, 076-FR-008's `dueAt`) as a delayed job `report-reminder:{reportId}` in a new `moderation-timers` queue (a due time already past when the consumer runs fires the job at once; a job lost from Redis is replaced by the existing timer sweep from the report's `dueAt` and `status`, and is never sent twice because the event id is the report's); when it fires and the report is still `pending`, every active admin MUST get ADMIN_REVIEW_REPORTED once more, as a reminder ("O recenzie raportată așteaptă de 48 de ore." / "A reported review has waited 48 hours.", for a reported reply "Un răspuns raportat așteaptă de 48 de ore." / "A reported reply has waited 48 hours.", with the item's title and the link), with the event id `report-reminder:{reportId}`; a report no longer `pending` when the job fires sends nothing, and a decision (ST-178/ST-179) or a closing MUST remove the job.

_From 177-reported-reviews._

### 177-FR-015 — Every new text (the titles, the lamps, the facts, the counts line, the oldest-wait line, the empty state, the error state, the overdue mark, the tile line, the action slots, the notification's e-mail and push in both forms) MUST exist in Romanian and English in the shared interface files and the notification templates and follow the reader's language; a Romanian hyphenated word uses U+2011; the garage's name, the author's name, the review text, the reply text and the report text MUST never be rendered as markup.

_From 177-reported-reviews._

### 1254-FR-003 — ASSISTANT_APPROVAL_NEEDED MUST go to the person by push and into the bell, and by e-mail instead of push when the account has no push device (never both; one catalogue flag read by the routing for any role, not a driver preference group); it MUST NOT be mutable by any preference, MUST go at any hour (not held for quiet hours), and its push, bell and e-mail texts (ro/en) MUST name that the assistant wants to do something and link to the approval's sheet (`/app/assistant/approvals/:id`). It carries no summary detail beyond that: the sheet shows the summary. (AC 1; brief Notifications)

_From 1254-assistant-approvals._

### 277-FR-001 — The system MUST carry a JOB_STARTED template in Romanian and English for the bell, push, e-mail and WhatsApp, passing the existing template check: bell and push "{actor} a început lucrul la {car}." / "{actor} started work on {car}."; e-mail subject "Lucrul la {car} a început" / "Work on {car} has started", the body with the same line and a link to the driver's tracker (`/app/driver/requests/<requestId>`); the WhatsApp a template name declared for Brevo approval like the other fan-outs. `actor` is the mechanic's first name (the first word of the mechanic's name) when the garage's `team_mechanics` feature is on and the job has a mechanic, else the garage's name; `car` is the whole noun phrase, never the plate: EN "the <brand> <model>" (or "the <brand>", or "your car"), RO "<brand> <model>" (or "<brand>", or "mașina ta"); the template carries no article; no phone value.

_From 277-car-status-alerts._

### 277-FR-002 — The system MUST carry a JOB_READY template in Romanian and English for the bell, push, e-mail and WhatsApp, passing the template check: bell and push "Mașina ta e gata. Te așteptăm la {garage}." / "Your car is ready. {garage} is expecting you."; e-mail subject "Mașina ta e gata" / "Your car is ready", the body with the same line and the tracker link; a WhatsApp template name declared for approval; no plate or phone value.

_From 277-car-status-alerts._

### 277-FR-003 — `job.started` and `job.done` MUST each have one registered consumer in the notifications worker (one fan-out, in the worker's consumer list) which, per event, reads the job with its request, booking, mechanic, garage and car and builds one message to the request's driver (subject the job): JOB_STARTED for `job.started`, JOB_READY for `job.done`, on the catalogue's channels (e-mail, push, WhatsApp; never SMS), routed by the existing channel rules (`routing.ts`) with no new fallback code, in the driver's account language; keyed by the existing (type, recipient, channel, outbox event id) dedupe so a redelivered event builds nothing twice; a failed run is retried with exponential backoff like the other fan-outs. The consumer reads the workshop module's data and changes none of it.

_From 277-car-status-alerts._

### 277-FR-004 — JOB_READY MUST be built only while the job's status is still `done` when the consumer runs; JOB_STARTED MUST be skipped when the job is cancelled or missing. `job.paused` and `job.resumed` MUST build no message (no consumer; proven by test). A skipped event (a successful read finding the job absent, cancelled, or for JOB_READY not `done`) MUST be logged with the job id and the reason and MUST NOT be retried; any thrown error propagates to the queue's retry. Dedupe is per outbox event: a genuine second `job.started` sends again.

_From 277-car-status-alerts._

### 277-FR-005 — JOB_READY MUST be sent whatever the driver's bookings-group and per-type choices are (the catalogue's `always`), and never held by quiet hours; JOB_STARTED MUST honour the driver's mute (no outside message, the bell entry written) and is never held by quiet hours either (both outside the not-urgent set). The catalogue entries stay as they are; the settings panel shows JOB_READY as always on through the existing rule (142-FR-001).

_From 277-car-status-alerts._

### 277-FR-006 — BOOKING_CONFIRMED MUST be proven by a test of the existing consumer (389-FR-013): one message to the driver per `booking.confirmed`, sent with the bookings group off and built once on redelivery. No change to its code or template.

_From 277-car-status-alerts._

### 277-FR-009 — Tests, written first: Jest unit tests of both templates in both languages (actor by mechanic, by garage with `team_mechanics` off, by garage with no mechanic; car by brand and model, no plate); integration tests of the fan-out on PostgreSQL and Valkey for each acceptance scenario of User Stories 1 and 2 (one message per event, muted JOB_STARTED sends nothing outside, JOB_READY ignores the mute and quiet hours, no SMS, WhatsApp when chosen, redelivery builds once, reopened job sends no JOB_READY, cancelled or missing job sends no JOB_STARTED, pause and resume send nothing) and FR-006's test of BOOKING_CONFIRMED; the Playwright flow of the brief is optional and not owed by this story (Assumptions). Test files carry `// @traces 277-car-status-alerts-FR-<n>` lines.

_From 277-car-status-alerts._

### 409-FR-013 — The notifications module MUST consume `repair.updated` with `by` other than `driver` and notify REPAIR_UPDATED to the owner account the event names (none → nothing), once per event (a redelivered event writes nothing, as the existing fan-outs do); the bell row is always written and its link opens the driver's cars (`bell.link.ts`, unchanged), while the outside channels (e-mail, push, WhatsApp) honour the driver's `reviews_history` switch as the catalogue already states (the existing `NotificationsService.notify` writes the bell row for a muted recipient and skips only the outside channels, `libs/domain/src/notifications/notifications.service.ts:194-201`; no catalogue change).

_From 409-garage-corrects-repair._

### 1267-FR-012 — REPAIR_UPDATED for a `repair.updated` with `by` `admin` MUST be built by the existing fan-out (409-FR-013, unchanged in recipient, once-per-event and mute rules) with texts that name MotorFix in place of the garage in every channel (bell body, e-mail, push, WhatsApp): "MotorFix a corectat o reparație din istoricul {car}." / "MotorFix corrected a repair in {car}'s history.", the e-mail subject "MotorFix a corectat o reparație a mașinii {car}" / "MotorFix corrected a repair of your {car}", and every e-mail body line and the reason line that name the garage or a shared repair speak of MotorFix and a repair in the driver's history; the texts live in the notifications module's own files as the other kinds keep theirs, the WhatsApp message through the registered `motorfix_repair_updated_{ro,en}` templates with "MotorFix" in their `{garage}` slot (no new template); the existing bell title and link stay.

_From 1267-admin-corrects-repair._

## Retired

- `194-FR-007` — superseded by `195-FR-005` (2026-10-04)
- `194-FR-018` — superseded by `195-FR-010` (2026-10-04)
- `194-FR-003` — superseded by `196-FR-007` (2026-10-05)
- `194-FR-008` — superseded by `196-FR-019` (2026-10-05)
- `194-FR-013` — superseded by `196-FR-014` (2026-10-05)
- `560-FR-001` — superseded by `806-FR-001` (2026-10-07)
- `199-FR-009` — superseded by `032-FR-001` (2026-10-10)
- `279-FR-013` — the sending-domain how-to page lives in the specs repo, which CI cannot read; docs-lint checks it, no test can trace it (2026-10-18)
- `194-FR-001` — superseded by `1351-FR-008` (2026-10-19)
- `199-FR-003` — superseded by `1190-FR-005` (2026-10-19)
- `199-FR-010` — superseded by `1190-FR-011` (2026-10-19)
- `198-FR-010` — superseded by `068-FR-004` (2026-10-23)
- `196-FR-012` — superseded by `068-FR-004` (2026-10-23)
- `194-FR-009` — superseded by `523-FR-001` (2026-10-24)
- `646-FR-003` — superseded by `523-FR-008` (2026-10-24)
- `560-FR-007` — superseded by `523-FR-011` (2026-10-24)
- `560-FR-009` — superseded by `523-FR-014` (2026-10-24)
- `194-FR-016` — superseded by `520-FR-003` (2026-10-23)
- `525-FR-001` — superseded by `1370-FR-007` (2026-10-24)
- `138-FR-001` — superseded by `142-FR-001` (2026-10-24)
- `196-FR-007` — superseded by `142-FR-005` (2026-10-24)
- `138-FR-012` — superseded by `142-FR-007` (2026-10-24)
- `428-FR-011` — superseded by `223-FR-005` (2026-10-25)
- `032-FR-006` — superseded by `094-FR-013` (2026-10-25)
- `032-FR-007` — superseded by `094-FR-014` (2026-10-25)
- `428-FR-010` — superseded by `1258-FR-005` (2026-10-25)
- `409-FR-014` — superseded by `1267-FR-012` (2026-10-30)

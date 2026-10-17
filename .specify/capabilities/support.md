---
capability: support
updated: 2026-10-17
features:
  - 280-contact-motorfix
  - 279-email-inbox
---

# Capability: Support

How a driver, a garage or a visitor reaches a person at MotorFix: the public contact page and the dashboards' "Ajutor și contact" task, the stored message, the e-mail to the support mailbox and the acknowledgement that states when the answer comes. Empty until ST-280 (280-contact-motorfix) is archived.

## Requirements

### 280-FR-001 — The public site MUST have a contact page at `/ro/contact` and `/en/contact` in the public shell (the same header and footer as `terms`), titled "Contact" / "Contact", showing an introduction line, the support e-mail address as a `mailto:` link when one is configured and nothing in its place when none is, and the contact form. It MUST be server-rendered like the other public pages, work at 320 px without sideways scroll, in light and dark, and be listed in the end-to-end public routes.

_From 280-contact-motorfix._

### 280-FR-002 — The footer of every public page MUST show a "Contact" / "Contact" link to the contact page in the current language, last in its row, after the existing entries (EP-8 build plan); it MUST be a keyboard-reachable link at least 44 px tall as a target.

_From 280-contact-motorfix._

### 280-FR-003 — The driver's and the garage's dashboard menus (the side menu on desktop and the tab bar on a phone, the two places Settings is reached today) MUST show "Ajutor și contact" / "Help and contact" after Settings (on a phone the tab bar already scrolls to reveal its entries, so the entry is reachable at 320 px), which opens the contact task over the current view with no navigation. The admin's menu MUST NOT show it. The entry is shown to every garage role, the mechanic included.

_From 280-contact-motorfix._

### 280-FR-004 — The contact task MUST be the shared task in the `drawer` shape (anchored right from 768 px, the bottom sheet below, 158-FR-001 and 158-FR-011), titled "Ajutor și contact" / "Help and contact", holding the same form as the page; it MUST follow the overlay rules: focus kept inside and returned to the menu entry on close, the discard question when text was typed, and the three ways to close.

_From 280-contact-motorfix._

### 280-FR-005 — The form MUST hold: name (required, 1 to 80 characters after trimming), e-mail (required, a valid address of at most 254 characters), topic (required, one of "Cerere sau programare" / "Request or booking", "Contul meu" / "My account", "Recenzii" / "Reviews", "Listarea service-ului" / "Listing my garage", "Altceva" / "Something else"; stored as the codes `request_or_booking`, `account`, `reviews`, `listing`, `other`), message (required, 20 to 2,000 characters after trimming, a multi-line field with a visible rule and a live count), a hidden trap field that no person sees, reaches by keyboard or hears from a screen reader, and one send button "Trimite mesajul" / "Send the message". Every field has a programmatic label and, for name and e-mail, the matching autocomplete purpose; errors are shown under the field and announced.

_From 280-contact-motorfix._

### 280-FR-006 — For a signed-in person the name and e-mail fields MUST be filled from the account at open and stay editable; the role MUST be the session's active role (`driver`, `garage`, `admin`), taken by the API from the session (never read from the request body), stored, and never a field. For a visitor the role is `visitor`.

_From 280-contact-motorfix._

### 280-FR-007 — The form MUST validate before sending (FR-005's rules; a missing e-mail or a message under 20 characters shows the field's error and sends nothing). While sending, the button MUST show a spinner and be disabled, and a second press MUST do nothing. When validation fails, focus MUST move to the first invalid field.

_From 280-contact-motorfix._

### 280-FR-008 — On success (201) the form MUST be replaced by the confirmation "Am primit mesajul tău. Îți răspundem pe e-mail." / "We have your message. We will answer by e-mail." with the reference under it; in the task, one button "Închide" / "Close" closes it. The confirmation is announced (live region).

_From 280-contact-motorfix._

### 280-FR-009 — The form MUST answer the API's failures with the text kept: 429 shows "Prea multe mesaje. Încearcă din nou peste o oră." / "Too many messages. Try again in an hour."; a failure with no server answer while the browser is offline shows "Nu ești conectat. Mesajul nu a fost trimis." / "You are offline. The message was not sent."; 503 `maintenance` shows the shared maintenance message; 400 shows the fields' errors; any other failure shows the shared network or general message with "Încearcă din nou" / "Try again".

_From 280-contact-motorfix._

### 280-FR-010 — The API MUST expose `POST /api/v1/support/messages`, open to visitors (`@Public()`, listed in the public-routes test), taking name, email, topic, message, language (`ro`|`en`), an optional `subjectRef` (a request's or a booking's id, at most 40 characters) and the trap field, validated at the edge with FR-005's rules (400 `validation_failed`); it MUST answer 201 with the reference, 429 past the hourly limit with the seconds to wait, and 503 `maintenance` while maintenance mode is on for anyone who is not an admin.

_From 280-contact-motorfix._

### 280-FR-011 — The API MUST expose `GET /api/v1/support/contact`, open to visitors, answering `{ email }` with the configured support address or `null`; the page and the task read it, and show the address only when it is a string.

_From 280-contact-motorfix._

### 280-FR-012 — A submission whose trap field is not empty MUST be answered 201 with a reference-shaped value that is not stored, store nothing, send nothing and count as outcome `trap`.

_From 280-contact-motorfix._

### 280-FR-013 — The hourly limit MUST count every POST to the endpoint at the edge, before validation, and allow 5 calls in the hour that began with the first per client address and, when signed in, per account; the 6th on either count is refused (429). The counts live in Redis; when Redis is unreachable the limit is skipped and logged, never refusing anyone.

_From 280-contact-motorfix._

### 280-FR-014 — A valid submission MUST store one SUPPORT_MESSAGE row (reference, account id when signed in, name, e-mail, role, topic, text, subject reference, language, created time; the support e-mail's and the acknowledgement's sent times, empty until sent) and its `support.message_received` event in the same transaction, before any e-mail is attempted; the reference MUST be `MF-{year}-{n}` with `n` six digits, counting from 1 each Bucharest calendar year, unique.

_From 280-contact-motorfix._

### 280-FR-015 — Each stored message MUST produce two e-mails sent by the worker from a `support-messages` job: one to the configured support address, always in Romanian, subject "[{reference}] {topic}: {name}" (on one line: line breaks and control characters in the name are dropped), body with the sender's name, e-mail, role, language, subject reference when any and the message, with the reply-to address set to the sender's (the sender's text is escaped wherever it is placed in an e-mail's HTML); and one acknowledgement to the sender in the message's language, subject "Am primit mesajul tău ({reference})" / "We have your message ({reference})", body with the reference, the promised answer time (FR-016) and a copy of the message. Both use the existing e-mail layout, the existing sender (`EMAIL_FROM`), the sending switch and the allowlist; the acknowledgement is always sent (no preference turns it off).

_From 280-contact-motorfix._

### 280-FR-016 — The acknowledgement MUST state "Îți răspundem în cel mult o zi lucrătoare." / "We answer within one working day." while no away date is set, and "Îți răspundem până pe {date}." / "We will answer by {date}." while `SUPPORT_AWAY_UNTIL` holds a future date, where the date is the first working day on or after it, shown as a long date in the message's language. A working day is Monday to Friday in Europe/Bucharest except the days in the `public_holiday` table. An unset, past (today or before, in Bucharest) or malformed value MUST read as not set and, in the latter two cases, be logged once at start and at each send.

_From 280-contact-motorfix._

### 280-FR-017 — A Brevo failure on either e-mail MUST leave the message stored and the job retried with the queue's backoff; the other e-mail is not sent twice. An unset support address MUST leave the support e-mail unsent with an error log naming `SUPPORT_EMAIL`, count outcome `unconfigured`, send the acknowledgement anyway, and not retry while the setting is missing (the job completes; the unsent alert covers it). Once `SUPPORT_EMAIL` is set, the outbox relay's requeue pass (every 5 minutes, as the news run's) MUST queue again every stored message whose support e-mail or acknowledgement is unsent, so none stays unsent; while it is unset only the unsent acknowledgements are queued again. An unset or invalid `EMAIL_FROM` with sending on keeps today's behaviour (the configuration refuses to start sending).

_From 280-contact-motorfix._

### 279-FR-003 — The support address MUST be `SUPPORT_EMAIL` when set to an address, else `support@<domain>` when the domain is set, else none (as today). The contact page, the support e-mails and the reply-to all use this one value. The support address and the sending domain MUST come only from configuration (`EMAIL_DOMAIN`, `EMAIL_FROM`, `SUPPORT_EMAIL`); no address or domain appears in source, templates or texts, and tests use their own test values.

_From 279-email-inbox._

### 280-FR-019 — Every text of the page, the task, the form, its errors, the confirmation and both e-mails MUST exist in Romanian and English; the e-mails' templates sit beside the existing ones and the acknowledgement's promise line is a unit-tested function of the date and the setting.

_From 280-contact-motorfix._

### 280-FR-020 — While maintenance mode is on, every page (the contact page included) is behind the shared maintenance page, which MUST then show the support address as a `mailto:` link when one is configured, read from FR-011's endpoint, which stays open in maintenance; sending is refused per FR-010.

_From 280-contact-motorfix._

### 280-FR-021 — Observability: the API MUST count `motorfix_support_messages_total{outcome}` (`stored`, `refused_limit`, `trap`, `invalid`; a maintenance refusal is already counted by `motorfix_maintenance_refusals_total{route}`) and the worker `motorfix_support_emails_total{kind,outcome}` (`support`|`acknowledgement`; `sent`, `blocked`, `failed`, `unconfigured`), the worker MUST report the gauge `motorfix_support_messages_unsent` (stored messages whose support e-mail is pending or unconfigured, not those blocked by the sending switch or the allowlist; read each minute), each stored message and each failure MUST be one log line with the reference (never the message text or the address), the `support-messages` job MUST be a span, and `infra/observability/inventory.json` MUST list the `support-messages` endpoint, the `support-contact` endpoint, the `support-messages` queue, the three series and the alert `support-message-unsent` (the gauge above 0 for 60 minutes), with a panel for the counters on the api dashboard and one for the gauge on the worker dashboard.

_From 280-contact-motorfix._

### 280-FR-022 — Tests: unit (the field rules, the promise line per date, setting and language, the reference format), API on real PostgreSQL and Redis (the limit on address and account, the trap, the message stored before any e-mail, 503 in maintenance, the fields' validation), worker (a retry when Brevo fails, the unset support address, both e-mails' content in both languages), web (the fields filled from the account, the task from the menu, the page), and end to end (a visitor sends from `/ro/contact` and sees the confirmation; a signed-in garage sends from its menu with the fields filled in).

_From 280-contact-motorfix._

## Retired

- `280-FR-018` — superseded by `279-FR-003` (2026-10-17)

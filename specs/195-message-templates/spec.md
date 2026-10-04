# Feature Specification: Message templates in Romanian and English

**Feature Branch**: `195-message-templates`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-195 Set up message templates in Romanian and English (Notion story https://app.notion.com/p/3ee607bff0d2813dbda8c0e39bb8c756, epic EP-1 Foundations). Build the template system of the notifications worker per the story's Build brief."

**Sources**: Notion story ST-195 (https://app.notion.com/p/3ee607bff0d2813dbda8c0e39bb8c756), read 2026-10-04; its Build brief (current as of 2026-10-03) wins over the criteria above it. Foundations build-timeline row https://app.notion.com/p/3ee607bff0d281f1bc4fd4d8e07eec64 (blocked by ST-194, ST-20, ST-19, all merged): "Gates ST-81, ST-127, ST-392 and ST-393." Feature page MF "Notifications" (https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1). No screens: e-mail, push, SMS and WhatsApp layouts are not designed in mock v22 (Build brief › Screens). The story page has no comments.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A person gets every message in their own language (Priority: P1)

Every message MotorFix sends a person (an e-mail now; push, SMS, WhatsApp and the bell later) is written in the language their account keeps, Romanian or English, with numbers, prices and dates in that language's format.

**Why this priority**: it is the story's whole purpose ("so that every message reaches a person in their language"), and ST-81, ST-127, ST-392 and ST-393 wait on it.

**Independent Test**: send the test message to an `en` account and an `ro` account through the recorded Brevo mock and read the subject, the text part, the HTML part and the bell text of each.

**Acceptance Scenarios**:

1. **Given** a driver whose account language is `en`, **When** the test message is sent, **Then** its subject, body and bell text are in English.
2. **Given** a driver whose language is `ro`, **When** the test message is sent, **Then** it is in Romanian, and ș and ț are written with the comma below (U+0219, U+021B), in UTF-8, in the e-mail and the bell text.
3. **Given** a range of 125000 to 160000 bani, **When** a template renders it as a price, **Then** it reads "1.250–1.600 lei" in Romanian and "1,250–1,600 lei" in English.
4. **Given** a booking at 14:30 on 3 November 2026 Europe/Bucharest, stored in UTC, **When** a template renders it, **Then** it shows "3 nov. 2026, 14:30" in Romanian and "3 Nov 2026, 14:30" in English.
5. **Given** an account whose language is neither `ro` nor `en`, **When** a message renders, **Then** it is in Romanian.

---

### User Story 2 - The e-mail check and password reset e-mails are complete (Priority: P1)

The account e-mails (confirm the address, reset the password) and the test message each have an e-mail with a subject, an HTML part and a plain-text part, the MotorFix wordmark, one amber button to the screen in question, and a footer that says why the person gets it.

**Why this priority**: ST-81 (confirm my e-mail) and ST-127 (reset a forgotten password) send these texts.

**Independent Test**: render ACCOUNT_EMAIL (both purposes) and TEST_MESSAGE in both languages and compare with their snapshots; send one through the Brevo mock and read both parts of the call.

**Acceptance Scenarios**:

1. **Given** an e-mail template, **When** it renders, **Then** it has an HTML part and a plain-text part, and its one button links to the screen in question (the link the caller gave for an account e-mail).
2. **Given** a transactional e-mail, **When** it renders, **Then** its footer explains why the person gets it, and it carries no unsubscribe link.
3. **Given** the e-mail is sent, **When** Brevo is called, **Then** the call carries the subject, the HTML part and the plain-text part.

---

### User Story 3 - A wrong template cannot reach production (Priority: P1)

Templates are files in the repository and change only through code review. A check that runs in CI with the unit tests fails the build when a template breaks a content rule.

**Why this priority**: the privacy rule (no other person's phone number or plate) and the two-language rule must hold for every template later stories add, without a reviewer having to remember them.

**Independent Test**: run the template check over the real templates (green), then over fixture templates that each break one rule (each red, naming the template and the rule).

**Acceptance Scenarios**:

1. **Given** a template whose text exists in Romanian but not in English (or the reverse), **When** the check runs in CI, **Then** the build fails naming the template, channel and missing language.
2. **Given** a template addressed to a garage, a mechanic or an admin that uses a `plate` or `phone` value, **When** the check runs, **Then** the build fails; DAY_SHEET is the only non-driver template allowed a plate; a driver's template may use the driver's own plate; no template may use a phone number (a deliberate tightening, see Clarifications).
3. **Given** a push template, **When** it renders with its example values, **Then** the title is at most 50 characters, the body at most 120, and it carries a link that opens the screen in question; otherwise the check fails.
4. **Given** an SMS template, **When** it renders with its example values in Romanian with diacritics, **Then** it fits one SMS of 70 characters, link included; otherwise the check fails.
5. **Given** a WhatsApp template, **When** it renders, **Then** it names its approved WhatsApp template and fills its parameter slots in order; a template with no name or with an empty slot fails the check.
6. **Given** a template written with a cedilla ş or ţ (U+015F, U+0163), **When** the check runs, **Then** it fails.
7. **Given** a template that uses a value it does not declare, or a notification type the catalogue does not know, **When** the check runs, **Then** it fails.

---

### User Story 4 - A message that cannot be written is not sent (Priority: P2)

When a template cannot render (for example a value it needs is missing), the message is not sent: its row is `failed` with the reason, the error is logged, and the bell shows a generic text.

**Why this priority**: a half-filled message ("Your booking at {time}") is worse than none, but the failure must be visible.

**Independent Test**: hand the worker an e-mail row whose params lack a value its template needs; read the row, the log and the Brevo mock.

**Acceptance Scenarios**:

1. **Given** an e-mail row whose template needs a value its params lack, **When** the worker handles it, **Then** Brevo is not called, the row is `failed` with the reason `template_failed`, and the error is logged with the type, channel and missing value.
2. **Given** the same row's bell text is asked for, **Then** a generic text in the person's language is returned ("You have a new notification" / "Ai o notificare nouă").

---

### Edge Cases

- A number, price or date value that is not a number or a valid instant renders as the missing-value dash "—" (the shared formatters' rule) rather than "NaN" or "Invalid Date"; a value that is absent altogether is a render failure (User Story 4).
- A price range whose two ends are equal renders as one price ("1.250 lei").
- A date on the night daylight saving time ends (25 October 2026) renders in Europe/Bucharest local time, not UTC.
- A value that contains `<`, `>`, `&` or quotes is escaped in the HTML part and left as is in the plain-text part.
- A notification type with no template for a channel falls back to the generic text for the bell and the e-mail (the 194 behaviour), so types whose owning stories have not yet written their texts keep working; the check does not require a template for every catalogue type.
- A params value that is `null` counts as absent (JSON carries no `undefined`).
- Grouped e-mails ("3 new quotes") are templates too, in both languages; in Romanian a count whose last two digits are 00 or 20–99 takes "de" ("20 de oferte noi").

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST keep one template per notification type and channel (e-mail, push, SMS, WhatsApp, bell), each with a Romanian and an English text, in the repository.
- **FR-002**: The system MUST render a message in the language its caller passes (the worker passes the recipient account's language), and in Romanian when that language is not `ro` or `en`.
- **FR-003**: The system MUST render price, number, date and time values in the format of the message's language, with dates and times in Europe/Bucharest local time, reusing the app's shared formatters.
- **FR-004**: An e-mail template MUST render a subject, an HTML part and a plain-text part with the MotorFix wordmark, one amber button that links to the screen in question, and a footer that says why the person gets it (a per-template text in both languages); only NEWS may carry an unsubscribe link.
- **FR-005**: The e-mail MUST go through Brevo's transactional e-mail API, with a 10-second timeout, from the configured sender, to the account's address, carrying the rendered subject, HTML part and plain-text part in the account's language (`ro` when not set); a 2xx answer MUST set the row `sent` with its sent time and Brevo's message id.
- **FR-006**: A push template MUST render a title of at most 50 characters, a body of at most 120 and a link to the screen in question.
- **FR-007**: An SMS template MUST render to at most 70 characters, link included.
- **FR-008**: A WhatsApp template MUST render to the name of its approved WhatsApp template and its ordered parameter values.
- **FR-009**: A check that runs in CI MUST fail the build when a template lacks a language, uses an undeclared value, belongs to an unknown type, uses a `plate` or `phone` value against the privacy rule, writes ş or ţ with a cedilla, breaks a push, SMS or WhatsApp limit with its example values, or does not render with its example values.
- **FR-010**: The system MUST carry the Romanian and English texts of TEST_MESSAGE and ACCOUNT_EMAIL (e-mail check and password reset, whose e-mail carries the link), for the e-mail and the bell, and of the generic and QUOTE_RECEIVED grouped e-mails, with the Romanian "de" plural.
- **FR-011**: When a template cannot render, the system MUST NOT send the message; it MUST set the row `failed` with the reason `template_failed`, log the type, channel and missing value, and answer a generic bell text in the person's language.

### Key Entities

- **Template**: the texts of one notification type on one channel, in Romanian and English; declares the values it uses, the audience it is addressed to (driver, garage, mechanic, admin, any) and example values for the check. Lives in code; nothing is stored.
- **Rendered message**: what a template gives for one language and one set of values: subject, HTML and text (e-mail); title, body and link (push); text (SMS, bell); template name and parameters (WhatsApp).

## Clarifications

### Session 2026-10-04

- Q: Is a type with no template for a channel a render failure, and must the check demand a template for every catalogue type × channel? → A: No. The check covers only the templates that exist; a type with no template for the e-mail or the bell renders the generic text, as 194 does. (Deviation: Notion states only the failed-render case.)
- Q: Should the phone rule follow the plate shape (the recipient's own number allowed) or bar every phone value? → A: Bar every `phone` value in every template for this story; no template written here or by the SMS-eligible types needs one. A deliberate tightening of "another person's phone number", recorded for the owner.
- Q: Is the e-mail footer's reason one fixed sentence or a per-template text? → A: A per-template text in Romanian and English, printed by the shared layout, so the two-language check covers it.
- Q: Which grouped e-mails does this story carry, and does the Romanian count handle the "de" form? → A: The generic grouped e-mail and the existing QUOTE_RECEIVED grouped e-mail; Romanian counts take "de" when the count's last two digits are 00 or 20–99 ("20 de oferte noi", "101 oferte noi").
- Q: Does the renderer read the account's language itself or take the language from its caller? → A: From its caller: the worker passes the account's language, the bell screen (ST-199) will pass the viewer's; anything other than `ro` or `en` renders Romanian.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-006, FR-007, FR-008, FR-009, FR-011
- **Modifies**: `194-FR-007` → `FR-005`, `194-FR-018` → `FR-010`
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every template in the repository has both a Romanian and an English text for every channel it defines (the CI check reports 0 missing).
- **SC-002**: A test message sent to an English account and to a Romanian account arrives with every visible text in that account's language (0 strings in the other language).
- **SC-003**: The price and date examples of the Build brief (scenarios 3 and 4) render exactly as written in both languages.
- **SC-004**: Each of the seven rule breaks in User Story 3 makes the check fail, and the real templates pass it.
- **SC-005**: A message whose template cannot render is never sent (0 provider calls) and is always visible as `failed` with its reason.

## Assumptions

- Templates are TypeScript modules in the notifications module, one file per notification type, rather than MJML and JSON files; e-mail HTML comes from one shared layout written in code, so no new dependency is added (autonomous default; Constitution Principle I; the Build brief marks MJML/JSON as *proposed*).
- The "check at build time" is a Jest spec in the unit suite, which the CI Unit tests job runs on every PR, so a failing check fails the build (autonomous default; the pattern of `libs/i18n/src/check.ts`).
- The English price format is "1,250–1,600 lei" (Build brief, *proposed English format*) and the date format "3 Nov 2026, 14:30", as the shared formatters of ST-19 already write them.
- Push 50/120 characters and SMS 70 characters are the Build brief's *proposed* limits; they are checked against each template's example values, and a rendered message over the limit at send time is a render failure.
- Only e-mail is sent today (ST-194); push (ST-196), SMS and WhatsApp (ST-392) channels have no sender yet, so their templates are rendered and checked but not sent by this story; no type in this story has a push, SMS or WhatsApp text, so those rules are proven on fixture templates (autonomous default).
- The bell row stores no text ("Writes: nothing"); the bell text is rendered from the template when it is read. No bell screen exists yet, so the bell text is verified at the renderer, not in a browser (autonomous default).
- The Playwright end-to-end test of the Build brief (switch a test account to English, send the test message, read the e-mail and bell) is not possible yet: no bell screen and no inbox exist, and e-mails go to Brevo. It is covered by the processor integration test against the recorded Brevo mock instead, and the gap is recorded as a deviation (autonomous default).
- The e-mail layout uses the light Cockpit palette's surface, ink and amber values and the "MotorFix" wordmark as text, since no e-mail layout is designed (Build brief › Screens, *proposed*).
- Messages use plain, neutral wording (Build brief, *proposed*); a garage's message names a driver as first name plus surname initial — a rule for the stories that write those texts, not exercised by this story's texts.
- A template that cannot render fails its row without the e-mail fallback hook (a missing value would fail on any channel) (autonomous default).
- No admin editor for templates at launch (Build brief, *proposed*).

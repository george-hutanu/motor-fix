# Feature Specification: Send SMS and WhatsApp through Brevo with the monthly SMS cap

**Feature Branch**: `392-sms-whatsapp`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-392 Send SMS and WhatsApp through Brevo with the monthly SMS cap (Notion story https://app.notion.com/p/3ee607bff0d281e088cadac726138cc5, epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). The SMS and WhatsApp channels of the notifications worker, both through Brevo: SMS_COUNTER and the cap of 5 SMS per driver per month, after which the message goes by WhatsApp; the monthly reset; the WhatsApp message templates registered with Brevo; the fallback from WhatsApp to e-mail; the garage's `whatsapp` switch for its own staff. No screens."

**Sources**: Notion story ST-392, read 2026-10-05; its Build brief (current as of 2026-10-03) wins over the criteria above it, and the decision of 2026-10-03 (above the cap, WhatsApp) supersedes the third criterion. Foundations build-timeline row https://app.notion.com/p/3ee607bff0d2816d937ed91fa7b9ee28 (lane D · Messaging, W5, 8 points, blocked by ST-194, ST-195, ST-197, all Merged): "External: WhatsApp templates need Brevo/Meta approval. Open: who pays for the WhatsApp Business account." The pipeline of ST-194 and ST-197 (`libs/domain/src/notifications/notifications.service.ts`, `notifications.processor.ts`, `preferences.ts`) and the templates of ST-195 (`templates.ts`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A driver who chose SMS gets reminders by SMS, five a month (Priority: P1)

A driver with a verified phone number chooses SMS for a reminder. The reminder goes by SMS through Brevo. Each driver has 5 SMS per calendar month (Europe/Bucharest); once they are used, the next messages go by WhatsApp, which MotorFix pays for.

**Why this priority**: the cap is the cost control the owner decided; every SMS-eligible reminder relies on it.

**Independent Test**: a driver with a verified number chooses SMS for DUE_ITP; hand the service six DUE_ITP messages in November 2026 and run the worker against the recorded Brevo mock: 5 SMS calls and 1 WhatsApp call, SMS_COUNTER (driver, `2026-11`) = 5.

**Acceptance Scenarios**:

1. **Given** a driver chose SMS for DUE_ITP and has a verified number +40 7xx xxx xxx, **When** the ITP reminder runs on 1 November 2026, **Then** one SMS goes through Brevo and SMS_COUNTER (that driver, `2026-11`) has sent_count 1.
2. **Given** that driver already had 5 SMS in November, **When** the 6th SMS-eligible reminder runs, **Then** it goes by WhatsApp and no SMS is sent.
3. **Given** it is 1 December 00:00 Europe/Bucharest, **When** the next reminder for that driver runs, **Then** it goes by SMS again and the December count is 1.
4. **Given** two reminders for the same driver run at the same second with 4 SMS used, **When** both count, **Then** exactly one goes by SMS and one by WhatsApp.
5. **Given** a catch-up run at 23:40 on 31 October would send a driver's DUE_ITP by SMS, **When** it is built, **Then** the SMS waits until 08:00 on 1 November and counts in November.

---

### User Story 2 - A WhatsApp message that cannot go reaches the person by e-mail (Priority: P1)

WhatsApp goes only through a template registered with Brevo and approved by WhatsApp. A number that is not on WhatsApp, a refusal, Brevo down after the retries, or a template not yet approved sends the message by e-mail instead.

**Why this priority**: a reminder must still arrive when the outside service fails; the e-mail path exists already.

**Independent Test**: a driver chose WhatsApp for DUE_RCA; the mock refuses the WhatsApp call; the `whatsapp` row is `failed` and an `email` row with `fallback_of` set is sent.

**Acceptance Scenarios**:

1. **Given** a WhatsApp message to a number that is not on WhatsApp, or Brevo refuses it, **When** the worker gets the error, **Then** the row is `failed` and the message goes by e-mail.
2. **Given** a WhatsApp template not yet approved, **When** that type would go by WhatsApp, **Then** it goes by e-mail instead and an error is logged.
3. **Given** Brevo's SMS API is down, **When** the retries are used up, **Then** the SMS row is `failed`, it does not count, and the message goes by WhatsApp.

---

### User Story 3 - Who may choose SMS and WhatsApp, and the garage switch (Priority: P2)

A driver may choose SMS only for reminders and WhatsApp for any type that allows it. Garage owners, receptionists, mechanics and admins may choose WhatsApp but never SMS. A garage that switched `whatsapp` off sends its staff nothing by WhatsApp.

**Why this priority**: the role rule keeps the SMS cost to drivers' reminders; the garage switch is the garage's own control.

**Independent Test**: a garage owner saves SMS for a type; a driver saves SMS for QUOTE_RECEIVED; a garage with `whatsapp` off and a staff member who chose WhatsApp for REQUEST_RECEIVED.

**Acceptance Scenarios**:

1. **Given** a call that sets SMS for QUOTE_RECEIVED or REVIEW_INVITE (not a reminder), **When** it is processed, **Then** it is refused with `channel_not_allowed` and nothing changes.
2. **Given** a garage owner, **When** they try to choose SMS for any type, **Then** 422 `channel_not_allowed`.
3. **Given** a garage switched `whatsapp` off, **When** a staff notification of that garage would go by WhatsApp, **Then** it goes by e-mail and no WhatsApp row is written; a driver's WhatsApp message about that garage still goes.
4. **Given** a driver without a verified phone number, **When** a message set to SMS or WhatsApp is built, **Then** it goes by e-mail.

### Edge Cases

- A failed SMS (Brevo refused it, or the retries ran out) does not count toward the cap.
- A message the phone sending switch or the non-production allowlist stops goes by e-mail rather than nowhere, so staging still shows it.
- A type with no SMS text goes by WhatsApp; a type with no WhatsApp text, like an unapproved template, goes by e-mail.
- A fallback never writes a second row for a channel the event already has (a staff member with both e-mail and WhatsApp on).
- An account deleted between building and sending is failed with no fallback, as for e-mail.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The worker MUST send an SMS through Brevo's transactional SMS API (`POST /transactionalSMS/sms`, type `transactional`, sender from config, default `MotorFix`) to the account's phone in E.164 without the `+`, with the rendered SMS text in the account's language and a 10-second timeout; a 2xx answer with a message id MUST set the row `sent` with its sent time and that id.
- **FR-002**: The worker MUST send a WhatsApp message through Brevo (`POST /whatsapp/sendMessage`) from the configured sender number, with the Brevo template id the config maps the rendered template's name to and its parameters; a 2xx answer with a message id MUST set the row `sent`. A template name the config does not map (not yet approved) MUST fail the row `template_not_approved`, log an error, and go by e-mail.
- **FR-003**: SMS_COUNTER MUST hold (account, month `YYYY-MM` in Europe/Bucharest, sent_count), unique on account and month. Before an SMS is sent, the worker MUST take one of the month's 5 in one atomic statement that only succeeds while sent_count is below 5; when none is left the SMS row MUST fail `sms_cap_reached` and the message MUST go by WhatsApp. An SMS that then fails for good MUST give its count back. The month is the month the SMS is sent in; a new month starts at 0 with no reset job.
- **FR-004**: Building a message, the service MUST write an `sms` or `whatsapp` row (beside the `in_app` row) when the person's choice for the type sends it by that channel, the type allows it, and the account has a verified phone (`phone_verified_at` set); without a verified phone it MUST write the `email` row instead. The quiet-hours rule of ST-194 MUST hold an SMS or WhatsApp of a type that is not urgent until 08:00 Europe/Bucharest, as it holds e-mail. SMS and WhatsApp rows are never grouped.
- **FR-005**: For a type that is not a driver type (staff and admin), WhatsApp MUST be off until the person turned it on for that type (and garage), always-sent and transactional types included; a type that goes by WhatsApp only (the sign-in and phone-change codes, the car transfer link, the day sheet) is the exception and goes by it; when the message's garage has its `whatsapp` feature off, the service MUST NOT write a `whatsapp` row and MUST write the `email` row instead. A driver's message is never stopped by a garage's switch.
- **FR-006**: The fallback chain MUST be: SMS → WhatsApp → e-mail. A fallback row MUST carry the failed row's id in `fallback_of`, the same type, event and parameters, and MUST NOT be written when the event already has a row on that channel for the person, or when the type does not go by that channel (e-mail included). An SMS whose text cannot be written goes by WhatsApp; a WhatsApp whose text cannot be written goes by e-mail.
- **FR-007**: A retryable Brevo SMS or WhatsApp error (5xx, 429, no answer) MUST be retried on ST-194's schedule; after the last retry, and at once on any other refusal, the row MUST fail with Brevo's reason and fall back (FR-006).
- **FR-008**: Phone sending MUST be off unless `PHONE_SENDING=on`; outside production only the numbers in `PHONE_ALLOWLIST` (E.164, refused at start otherwise) MUST be sent to. A row the switch or the allowlist stops MUST fail (`sending_off` / `not_allowed`) and go by e-mail. `PHONE_SENDING=on` without `WHATSAPP_SENDER` MUST stop the process at start with a named error; `WHATSAPP_TEMPLATES` lists `name=id` pairs.
- **FR-009**: Saving a preference MUST refuse SMS from anyone whose role in use is not driver with 422 `channel_not_allowed`; a channel the type does not allow stays 400 `channel_not_allowed` (ST-197), which refuses SMS on QUOTE_RECEIVED and REVIEW_INVITE.
- **FR-010**: The SMS and WhatsApp texts of DUE_ITP MUST exist in Romanian and English (one SMS of at most 70 characters; a WhatsApp template named per language), so the reminder can be proven end to end; every WhatsApp template's name and slots in the registry are the list registered with Brevo.

### Key Entities

- **SMS counter** (new, SMS_COUNTER): account, month (`YYYY-MM`), sent count.
- **Garage feature** (new, GARAGE_FEATURE): garage, feature key (`whatsapp`), enabled; a missing row is on.
- **Notification** (exists): rows on the `sms` and `whatsapp` channels, `fallback_of` for each fallback.

## Clarifications

### Session 2026-10-05

- Q: Above the cap: push or WhatsApp? → A: WhatsApp (owner decision of 2026-10-03, in the story). (owner)
- Q: Does a failed SMS count? → A: No; the count is taken before the call (so two at once cannot both pass) and given back when the SMS fails for good (FR-003). (autonomous, Build brief *(proposed)*)
- Q: The brief's 422 `CHANNEL_NOT_ALLOWED` for SMS on a non-reminder type, while ST-197 shipped 400 `channel_not_allowed` for a channel the type does not allow? → A: The shipped 400 stays for the type mismatch (it is in the published API and the brief's code is *(proposed)*); the role refusal, new here, answers 422 `channel_not_allowed`, the repo's lower-case code style (FR-009). (autonomous default)
- Q: "The monthly reset" and the `sms-counter` queue at 00:00 on the 1st? → A: The brief makes the queue conditional on a Redis cache of the count. The count lives only in PostgreSQL, keyed by month, so a new month starts at 0 with no job and no cache (FR-003, Principle I). (autonomous default)
- Q: Staff WhatsApp when nothing is saved? → A: Off: staff types send WhatsApp only once the person turns it on, so this story does not start messaging every staff member by WhatsApp (FR-005). ST-198 shows the switch. (autonomous default)
- Q: "Goes by push, else e-mail" when push does not exist yet? → A: E-mail; ST-196 adds push in front of it. (autonomous default)

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010
- **Modifies**: 194-FR-003 → FR-004
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Six DUE_ITP reminders in one month to a driver who chose SMS produce 5 SMS and 1 WhatsApp call to Brevo (integration test against the recorded mock).
- **SC-002**: Two concurrent SMS takes with 4 used leave sent_count at 5 and exactly one SMS (integration test).
- **SC-003**: Every refusal, failure and fallback named in the scenarios leaves a `failed` row with its reason and one fallback row (integration tests).

## Assumptions

- No screen in this story: the channel picker and the staff panels are their own stories (Build brief › Screens). (Build brief)
- Push does not exist yet (ST-196), so every "push, else e-mail" fallback is e-mail. (autonomous default)
- The brief's Playwright check (run the reminder job six times, the test inbox shows 5 SMS and 1 WhatsApp) is covered by an integration test against the recorded Brevo mock: there is no reminder job (the scheduler is ST-200) and no screen. (autonomous default)
- The proof uses DUE_ITP with its own SMS and WhatsApp texts; TEST_MESSAGE stays e-mail only, since the admin test route takes no channel. (autonomous default)
- Brevo's WhatsApp call takes the template id and the parameters as `params`; it is recorded in the mock and is checked on staging when the first template is approved. Template approval is an outside step (Brevo/Meta) started by the owner. (autonomous default)
- Who pays for the WhatsApp Business account beyond "MotorFix for now" stays open for the owner. (open, owner)

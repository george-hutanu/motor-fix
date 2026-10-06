# Feature Specification: Choose which messages I get as a garage, mechanic or admin

**Feature Branch**: `198-staff-notification-preferences`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "ST-198 "Choose which messages I get as a garage, mechanic or admin" (Notion story https://app.notion.com/p/3ee607bff0d28165bbebde1ebfad3a78, epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707, feature page https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1)"

**Sources**: Notion story ST-198 (https://app.notion.com/p/3ee607bff0d28165bbebde1ebfad3a78), read 2026-10-06; its Build brief (current as of 2026-10-03) wins over the acceptance criteria above it. The notification catalogue on the feature page (https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1), whose "Garage list" and "Admin list" columns name the types per role. ST-197 (merged): the preference store, `GET`/`PUT /api/v1/notification-preferences`, the send-time check, the audit entry per change and the `notification_preferences.updated` live event (`libs/domain/src/notifications/`). ST-196 (merged): the push panel and where it sits (`apps/web/src/app/dashboard/views.ts`). Screens: the Build brief says the staff panels are **not designed** in mock v22; the driver's panel style is the reference.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A garage owner mutes a kind of message and stops getting it (Priority: P1)

A garage owner opens Setări · Notificări in the garage dashboard and sees every kind of message a garage can receive, in sections, each with three switches: E-mail, Push, WhatsApp. Turning a channel off for a kind stops that kind from going out by that channel to this person; the request still shows in the dashboard and the bell. The kinds that must always reach the garage keep e-mail locked on.

**Why this priority**: the story's headline value and the W17 decision (a muted request also mutes its day-2 and day-5 reminders); every later story that sends a staff message relies on this list and this check.

**Independent Test**: sign in as an owner, read the preferences, switch REQUEST_RECEIVED off on every channel, hand the sending pipeline a REQUEST_RECEIVED and a REQUEST_REMINDER for that garage, and read the notification rows.

**Acceptance Scenarios**:

1. **Given** a garage owner, **When** they read their preferences, **Then** the answer carries one staff list for their garage (its id and name, role `owner`) with the whole Garage list in the sections `requests_quotes`, `bookings`, `reviews` and `account`, each type with its channels among e-mail, push and WhatsApp, and never SMS.
2. **Given** the owner turns REQUEST_RECEIVED off for push and WhatsApp and keeps e-mail, **When** a new request arrives and, on day 2, its reminder runs, **Then** the owner gets each only by e-mail and the bell shows both.
3. **Given** the owner turns REQUEST_RECEIVED off on every channel, **When** a request arrives and the day-2 and day-5 reminders run, **Then** nothing goes outside MotorFix for this owner; each writes only its bell row.
4. **Given** VERIFICATION_RESULT, GARAGE_SUSPENDED or GARAGE_RESTORED, **When** the owner reads them, **Then** e-mail is locked on and push and WhatsApp are free; a save that switches their e-mail off answers 422 and changes nothing.
5. **Given** DOCUMENT_DUE or DOCUMENT_OVERDUE with only e-mail on, **When** the owner switches e-mail off, **Then** the save answers 422 and the switch stays on; switching push on first and then e-mail off is accepted.
6. **Given** a save, **When** the owner reloads the panel or reads from another device, **Then** the saved values come back.

---

### User Story 2 - A receptionist and a mechanic each see only their own kinds, and mute only themselves (Priority: P2)

A receptionist sees the garage kinds that concern the whole garage, not the owner-only ones; a mechanic sees booking moves and, when allowed to answer quotes, new requests and messages. Each person's switches are their own.

**Why this priority**: W10 (a receptionist mutes for themselves) and W11 (a mechanic's list follows `can_answer_quotes`) are decided rules; without them the owner's channels would be silenced by a colleague.

**Independent Test**: through the API, read a receptionist's and two mechanics' preferences (one with `can_answer_quotes`), mute REQUEST_RECEIVED as the receptionist, hand the pipeline a REQUEST_RECEIVED for the garage and compare the owner's and the receptionist's rows.

**Acceptance Scenarios**:

1. **Given** a receptionist, **When** they read their preferences, **Then** their list holds the Garage list without the owner-only types (REVIEW_POSTED, REVIEW_EDITED, STAFF_JOINED, VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED, DOCUMENT_DUE, DOCUMENT_OVERDUE, CATALOGUE_JOB_DECIDED, FACILITY_REMOVED, FACILITY_RE_ADD_DECIDED).
2. **Given** a mechanic without `can_answer_quotes`, **When** they read their preferences, **Then** their list holds BOOKING_MOVED only; with `can_answer_quotes` it also holds REQUEST_RECEIVED and MESSAGE_RECEIVED. DAY_SHEET is never listed.
3. **Given** the receptionist mutes REQUEST_RECEIVED on every channel, **When** a request arrives, **Then** the owner still gets it on the owner's own channels and the receptionist gets only the bell row.
4. **Given** a save that names a type outside the caller's list for that garage (a receptionist saving REVIEW_POSTED, a mechanic saving QUOTE_ACCEPTED), **When** it is processed, **Then** it answers 422 and changes nothing.
5. **Given** a save that names a garage the caller is not staff of, **When** it is processed, **Then** it answers 404.

---

### User Story 3 - The garage's switches shape the panel (Priority: P2)

When the garage has switched WhatsApp off, or the person has no verified phone, WhatsApp cannot be chosen; when the garage has day sheets off, the day-sheet kinds are not listed.

**Why this priority**: W12 and [25] are decided; offering a channel that cannot deliver would silently lose messages.

**Independent Test**: through the API, read an owner's preferences with the garage's `whatsapp` feature off, then on with the owner's phone unverified, then on with a verified phone; read with `day_sheets` off and on.

**Acceptance Scenarios**:

1. **Given** the garage's `whatsapp` feature is off, **When** staff read their preferences, **Then** the list says WhatsApp cannot be chosen because the garage has it off, and a save that switches WhatsApp on for any type of that garage answers 422.
2. **Given** the garage's `whatsapp` feature is on and the person has no verified phone, **When** they read, **Then** the list says WhatsApp cannot be chosen for lack of a verified phone, and a save that switches it on answers 422.
3. **Given** the garage's `day_sheets` feature is off, **When** the owner or a receptionist reads, **Then** DAY_SHEET_OUTDATED and DAY_SHEET_NOT_SENT are not listed; with it on, both are, in `bookings`.
4. **Given** the panel is open and the garage's features change, **When** `garage.features_changed` arrives for that garage, **Then** the panel reads the list again without a reload.

---

### User Story 4 - A MotorFix admin chooses among the admin kinds (Priority: P3)

An admin opens Setări · Notificări in the admin dashboard and sees the Admin list; the outage alert is locked on for e-mail and push.

**Why this priority**: the admin list is small and nothing else depends on it, but X03 (the launch alert cannot be silenced) must hold from the first admin.

**Independent Test**: read an admin's preferences, switch ADMIN_REVIEW_REPORTED off for push, try to switch ADMIN_OUTAGE_ALERT off for e-mail.

**Acceptance Scenarios**:

1. **Given** an account with the admin role, **When** they read their preferences, **Then** the answer carries one staff list with no garage (role `admin`) holding ADMIN_VERIFICATION_QUEUED, ADMIN_REVIEW_REPORTED, ADMIN_APPEAL_RECEIVED, ADMIN_OUTAGE_ALERT, ADMIN_RULE_APPROVAL_NEEDED, ADMIN_CATALOGUE_JOB_PENDING, ADMIN_FACILITY_REQUEST and ADMIN_RECHECK_DUE in the section `admin`; ADMIN_STATUS_ALERT is not listed.
2. **Given** ADMIN_OUTAGE_ALERT, **When** the admin reads it, **Then** e-mail and push are both locked on; a save switching either off answers 422.
3. **Given** an account that is not an admin, **When** it saves an admin type with no garage, **Then** the save answers 422.

---

### User Story 5 - The panel in the garage and admin dashboards (Priority: P2)

The garage dashboard gains a Setări view, reachable by every garage role, holding this device's push panel (moved from the home view) and the Notificări panel beneath it; the admin dashboard's Setări view gains the Notificări panel under its push panel.

**Why this priority**: the API alone meets the sending rules; the panel is what the story promises the owner, and the end-to-end check runs through it.

**Independent Test**: as an owner, open Setări in the garage dashboard, mute REQUEST_RECEIVED on every channel, reload, and read the switches back; at 320 px the rows stack and nothing scrolls sideways.

**Acceptance Scenarios**:

1. **Given** an owner on Setări, **When** the panel loads, **Then** it shows skeleton rows, then the four sections, one row per type with the switches E-mail, Push and WhatsApp; a locked switch is on, disabled, and says "Se trimite mereu" / "Always sent".
2. **Given** WhatsApp cannot be chosen, **When** the panel shows, **Then** the WhatsApp switches are off and disabled with "WhatsApp este oprit pentru acest service" / "WhatsApp is off for this garage" or "Adaugă un număr de telefon verificat" / "Add a verified phone number", as the reason says.
3. **Given** the owner toggles a switch, **When** the save succeeds, **Then** the switch stays where it was put; **When** the save fails, **Then** the switch reverts and a toast says the change was not saved.
4. **Given** the list cannot be read, **When** the panel shows, **Then** it offers "Reîncearcă" / "Try again", which reads again.
5. **Given** the panel is open in two tabs, **When** one saves, **Then** the other refreshes its switches on `notification_preferences.updated`.
6. **Given** a mechanic (the limited garage dashboard), **When** they open Setări, **Then** the same panel shows their own list.

---

### Edge Cases

- A person who is staff of two garages: one staff list per garage, each with its own garage name and reason for WhatsApp; a save names the garage it is for.
- A person who is a mechanic of one garage and an admin: one list for the garage and one for the admin kinds, kept apart by the garage.
- A person who is a driver and staff: the driver groups and types answer as before (ST-197); the staff lists are added, never mixed.
- A type with no outside channel (DAY_SHEET_OUTDATED, bell only): listed with no switches and the line "Doar în aplicație" / "In the app only".
- A type whose every channel is locked (ADMIN_OUTAGE_ALERT): listed with its switches on and disabled; it cannot be saved.
- A saved row for a type that later leaves the person's list (a mechanic who loses `can_answer_quotes`, a garage that switches `day_sheets` off): the row stays, is not listed, and is not read until the type is back in the list.
- A garage that switches `whatsapp` off after staff chose WhatsApp: the saved rows stay; the pipeline's existing rule sends by the next chosen channel (feature page, edge cases); the panel shows WhatsApp as unavailable.
- An always-sent type with push and WhatsApp off: e-mail still goes (194-FR-004).
- The same request mute set by the owner and the receptionist: each is checked for their own account; the mechanics with `can_answer_quotes` keep theirs.
- A staff member whose garage membership ends: their lists for that garage disappear from GET; a save naming it answers 404.

## Requirements *(mandatory)*

### Functional Requirements

**The staff lists (read)**

- **FR-001**: `GET /api/v1/notification-preferences` MUST add a `staff` field to the answer of ST-197: one entry per garage the caller is staff of (an owner or receptionist by GarageMember, a mechanic by Mechanic) and one entry with no garage when the account's role is admin; a person who is none has an empty `staff`. The driver groups and types of ST-197 are unchanged.
- **FR-002**: Each staff entry MUST carry: the garage's id and name (both empty for the admin entry), the caller's role (`owner`, `receptionist`, `mechanic` or `admin`), whether WhatsApp can be chosen and, when it cannot, why (`garage_whatsapp_off` when the garage's `whatsapp` feature is off, else `phone_not_verified` when the account has no verified phone; the admin entry has no garage and depends on the phone alone), and its sections, each with its types in catalogue order.
- **FR-003**: Each listed type MUST carry its channels, one per outside channel the catalogue allows it among e-mail, push and WhatsApp (never SMS; a type with no such channel has none), and for each: whether it is enabled as the send-time check reads it (the saved row, else on) and whether it is locked.
- **FR-004**: The types of a garage entry MUST be, by role: the owner, every type the catalogue puts in the Garage list and the three always-sent owner types (VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED); the receptionist, the same without the owner-only types (REVIEW_POSTED, REVIEW_EDITED, STAFF_JOINED, VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED, DOCUMENT_DUE, DOCUMENT_OVERDUE, CATALOGUE_JOB_DECIDED, FACILITY_REMOVED, FACILITY_RE_ADD_DECIDED); the mechanic, BOOKING_MOVED, plus REQUEST_RECEIVED and MESSAGE_RECEIVED only while `can_answer_quotes` is set. REQUEST_REMINDER, DAY_SHEET, DIRECT_REQUEST and ADMIN_STATUS_ALERT MUST NOT be listed for anyone. DAY_SHEET_OUTDATED and DAY_SHEET_NOT_SENT MUST be listed for the owner and the receptionist only while the garage's `day_sheets` feature is not off.
- **FR-005**: The sections of a garage entry MUST be `requests_quotes` (REQUEST_RECEIVED, REQUEST_CANCELLED, REQUEST_EXPIRED, QUOTE_ACCEPTED, QUOTE_LOST, QUOTE_DECLINED_BY_DRIVER, QUOTE_EXPIRED, MESSAGE_RECEIVED), `bookings` (BOOKING_MOVE_REQUESTED, BOOKING_CONFIRM_REMINDER, BOOKING_MOVED, BOOKING_CANCELLED, BOOKING_LAPSED, BOOKING_MOVE_LAPSED, DAY_SHEET_OUTDATED, DAY_SHEET_NOT_SENT), `reviews` (REVIEW_POSTED, REVIEW_EDITED, REVIEW_DECIDED, REVIEW_APPEAL_DECIDED) and `account` (VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED, DOCUMENT_DUE, DOCUMENT_OVERDUE, STAFF_JOINED, CATALOGUE_JOB_DECIDED, FACILITY_REMOVED, FACILITY_RE_ADD_DECIDED), each holding only the types the role gets; an empty section is left out. The admin entry MUST have one section, `admin`, with ADMIN_VERIFICATION_QUEUED, ADMIN_REVIEW_REPORTED, ADMIN_APPEAL_RECEIVED, ADMIN_OUTAGE_ALERT, ADMIN_RULE_APPROVAL_NEEDED, ADMIN_CATALOGUE_JOB_PENDING, ADMIN_FACILITY_REQUEST and ADMIN_RECHECK_DUE.
- **FR-006**: A channel MUST be locked (always on, cannot be saved off) when: the type is always sent and the channel is e-mail (VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED, BOOKING_MOVE_LAPSED, BOOKING_CANCELLED, BOOKING_LAPSED, BOOKING_CONFIRM_REMINDER, FACILITY_REMOVED), their push and WhatsApp staying free; or the type is ADMIN_OUTAGE_ALERT, whose e-mail and push are both locked. DOCUMENT_DUE and DOCUMENT_OVERDUE MUST no longer be always sent: no channel of theirs is locked, but at least one MUST stay on (FR-008).

**Saving**

- **FR-007**: `PUT /api/v1/notification-preferences` MUST accept staff choices as per-type choices of ST-197 that carry the garage (none for an admin type), the type, the channel and `enabled`, and MUST answer the preferences as FR-001 reads them after the save; a save MUST stay one transaction with one audit history entry per changed row (who, garage, type, channel, old and new value) and MUST publish `notification_preferences.updated` on `account:{accountId}` as ST-197 does.
- **FR-008**: A staff choice MUST be refused with 422, nothing changed, when: the type is not in the caller's list for that garage (or, with no garage, not in the admin list or the account is not an admin), code `type_not_in_list`; the channel is SMS, code `channel_not_allowed`; the channel is locked for the type and `enabled` is false, code `channel_locked`; the channel is WhatsApp, `enabled` is true, and WhatsApp cannot be chosen for that entry (FR-002), code `whatsapp_unavailable`; the type is DOCUMENT_DUE or DOCUMENT_OVERDUE and the save would leave every one of its channels off, code `last_channel`. A garage the caller is not staff of MUST answer 404 as ST-197 does. The routes stay the caller's own: no call names another account, so another person's preferences cannot be changed (the brief's 403 case cannot arise).

**Sending**

- **FR-009**: The send-time check of ST-197 MUST read a staff type's rows per account and garage, so one person's mute never changes another's channels for the same garage. A REQUEST_REMINDER MUST be checked against the recipient's REQUEST_RECEIVED rows for the message's garage, having no rows of its own.
- **FR-010**: A DOCUMENT_DUE or DOCUMENT_OVERDUE MUST go by the channels the owner left on, never by none; a muted channel of theirs is skipped like any other staff type's.

**The panel**

- **FR-011**: The garage dashboard MUST gain a Setări (settings) view, reachable by every garage role (owner, receptionist, mechanic), holding this device's push panel (which leaves the home view) and, beneath it, the Notificări panel; the admin dashboard's Setări view MUST show the Notificări panel under its push panel. The driver dashboard is unchanged.
- **FR-012**: The Notificări panel MUST show each of the caller's staff entries (its garage name as the heading when there is more than one, or the admin heading) with its sections and one row per type: the type's name in the person's language and the switches E-mail, Push and WhatsApp for the channels the type has; a type with no outside channel shows "Doar în aplicație" / "In the app only" instead. On a phone (320 and 390 px) the switches MUST stack under the type name and nothing MUST scroll sideways.
- **FR-013**: A locked switch MUST be on and disabled with "Se trimite mereu" / "Always sent". When WhatsApp cannot be chosen, the entry's WhatsApp switches MUST be off and disabled with "WhatsApp este oprit pentru acest service" / "WhatsApp is off for this garage" or "Adaugă un număr de telefon verificat" / "Add a verified phone number", by the reason.
- **FR-014**: A switch MUST save on toggle, optimistically; a refused or failed save MUST revert the switch and show a toast "Setarea nu a putut fi salvată" / "The setting could not be saved". While loading, the panel MUST show skeleton rows; when the read fails, it MUST show "Nu am putut încărca setările" / "Could not load the settings" with "Reîncearcă" / "Try again".
- **FR-015**: The panel MUST read the lists again, without a reload, on `notification_preferences.updated` for the caller's account and on `garage.features_changed` for any garage it shows.
- **FR-016**: Every text of the panel, the type names and the section names included, MUST exist in Romanian and English.

### Key Entities *(include if feature involves data)*

- **Staff list**: what one person may choose for one garage (or as an admin): the garage, the role, WhatsApp availability and its reason, and the sections of types with their channels, each enabled or not and locked or not. Derived at read time from the catalogue, GarageMember, Mechanic, GarageFeature, the account's phone and the saved rows; nothing new is stored.
- **Notification preference** (ST-197): account, optional garage, type, channel, enabled. Staff rows carry the garage; admin rows carry none.
- **Garage feature** (ST-194 scope): the garage's `whatsapp` and `day_sheets` switches; a missing row is on.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016
- **Modifies**: none
- **Removes**: none

Note: ST-197's requirements are not yet in `.specify/capabilities/notifications.md`, so nothing of theirs can be named here. In this spec, FR-001, FR-007, FR-008 and FR-009 extend what ST-197's spec numbers FR-004, FR-005, FR-006 and FR-009, and FR-006 changes the catalogue's DOCUMENT_DUE and DOCUMENT_OVERDUE from always sent to at-least-one-channel.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner who muted REQUEST_RECEIVED on every channel gets a REQUEST_RECEIVED and both REQUEST_REMINDERs in the bell only: 3 `in_app` rows, 0 outside rows (API test).
- **SC-002**: With the receptionist's REQUEST_RECEIVED muted, a request writes the owner's outside rows as before and the receptionist's `in_app` row only (API test).
- **SC-003**: The four role lists match FR-004 and FR-005 exactly, and `day_sheets` off removes exactly 2 types, `can_answer_quotes` adds exactly 2 (API tests).
- **SC-004**: Every refusal of FR-008 (6 codes, the 404 included) leaves the store and the audit history unchanged (API tests, 6 of 6).
- **SC-005**: In the browser, an owner mutes REQUEST_RECEIVED on all three switches and, after a reload, all three read off (end to end); the panel at 320 px and 390 px, light and dark, Romanian and English, scrolls only vertically (QA sweep).

## Assumptions

- The Build brief's default "on, push if a subscription exists, else e-mail" is not adopted: ST-197 decided (2026-10-05) that a missing staff row means on for every channel the type allows, and the push routing of ST-196 already sends by e-mail when a person has no device. Kept. (autonomous default)
- The owner cannot change a receptionist's or a mechanic's settings: the routes act on the caller only and take no account id (ST-197 FR-007), so the brief's 403 scenario has no request that could trigger it; the receptionist-mutes-only-themselves test is the check (FR-008, FR-009). (autonomous default)
- The brief's scenario 7 lists REQUEST_REMINDER for a mechanic; the rule "the reminder has no switch of its own" (W17) wins: REQUEST_REMINDER is listed for nobody and follows REQUEST_RECEIVED (FR-004, FR-009). (autonomous default)
- DIRECT_REQUEST (release 2) and ADMIN_STATUS_ALERT (release 3) are not listed until their releases; adding them is a catalogue change. (autonomous default)
- The section keys `requests_quotes`, `bookings`, `reviews`, `account` and `admin` and their type placement (FR-005) are the brief's proposed sections made concrete; DAY_SHEET_OUTDATED and DAY_SHEET_NOT_SENT sit under `bookings` as they concern the day's schedule. (autonomous default)
- BOOKING_MOVE_LAPSED, BOOKING_CANCELLED, BOOKING_LAPSED, BOOKING_CONFIRM_REMINDER and FACILITY_REMOVED are already always sent in the catalogue, so they get the e-mail lock of FR-006 like the three verification types; the brief names only some of them. (autonomous default)
- DOCUMENT_DUE and DOCUMENT_OVERDUE stop being always sent in the catalogue so that a channel may be switched off (X26f: "the owner may change their channels"); the at-least-one rule replaces the lock, with no default channel forced. (autonomous default)
- "WhatsApp switches are offered only with a verified phone number" is read as: shown but unavailable, with the reason; the garage's `whatsapp` switch is the first reason checked, the phone the second. The admin entry depends on the phone alone. (autonomous default)
- A type with no outside channel (DAY_SHEET_OUTDATED) is listed, as the brief's scenario 9 implies, with no switch. (autonomous default)
- Error codes `type_not_in_list`, `channel_locked`, `whatsapp_unavailable` and `last_channel` are new; `channel_not_allowed` and the 404 are ST-197's. The brief's "422 for SMS" is ST-197's `channel_not_allowed` since the catalogue gives no staff type SMS. (autonomous default)
- The garage dashboard's new Setări view takes the push panel from the home view (ST-196 FR-006 placed it there "until the garage has a Setări view"); the limited mechanic dashboard is the garage dashboard's view set, so mechanics reach the same view. (autonomous default)
- The end-to-end check covers the panel half of the brief's test (mute, reload, read back); the "a driver sends a request and no e-mail arrives" half is an API integration test handing the pipeline a REQUEST_RECEIVED, since no request-sending flow exists yet. (autonomous default)
- Panel texts not in the brief ("Doar în aplicație", the no-phone line, the toast and error lines) are proposed and may be changed by the owner. (autonomous default)
- ST-197's Spec Delta is not yet merged into `.specify/capabilities/notifications.md`; this feature's archive merges its own Adds and notes the gap rather than modifying ids that are not there. (autonomous default)
- Out of scope: the garage feature switches themselves, the driver's panel (ST-138), mechanic permissions on the invite, the owner editing others' settings, and the messages behind each type, which the epics owning their events send.

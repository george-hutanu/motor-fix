# Feature Specification: Store each person's message choices and check them before sending

**Feature Branch**: `197-message-preferences`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-197 Store each person's message choices and check them before sending (Notion story https://app.notion.com/p/3ee607bff0d2813a8daaf36ef87fada9, epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). The preference store for every role: NOTIFICATION_PREFERENCE, GET and PUT /api/v1/notification-preferences, the defaults when nothing is saved, the driver group keys and their type map, and the send-time check in the sending pipeline that skips a muted type but never an always-sent one. No screens: the driver's panel is ST-138, the staff panels ST-198, the channel picker its own story."

**Sources**: Notion story ST-197 (https://app.notion.com/p/3ee607bff0d2813a8daaf36ef87fada9), read 2026-10-05; its Build brief (current as of 2026-10-03) wins over the criteria above it. Foundations build-timeline row https://app.notion.com/p/3ee607bff0d281e48220fab7c5230a80 (lane D · Messaging, W3, 3 points, blocked by ST-194 and ST-79, both merged): "API and preferences only; the Setari panel is ST-138 (Driver account basics). A fifth group reviews_history is open; default yes." The catalogue and the pipeline of ST-194 (`libs/domain/src/notifications/catalogue.ts`, `notifications.service.ts`). No screens (Build brief › Screens: none in this story).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A driver turns a kind of message off and stops getting it (Priority: P1)

A driver has five switches, one per group of messages: offers, bookings, due dates, MotorFix news, and reviews and history. Turning a group off stops every message of that group from going outside the app; it still shows in the bell. Messages needed to complete a job are always sent.

**Why this priority**: the epic's demo step 7 ("switch that type off in the preferences and send again: nothing arrives") and every later story that sends a message rely on this check.

**Independent Test**: through the API, read a new driver's preferences, switch the `due_dates` group off, hand the service a DUE_ITP and a JOB_READY, and read the NOTIFICATION rows.

**Acceptance Scenarios**:

1. **Given** a new driver with no saved rows, **When** `GET /api/v1/notification-preferences` is called, **Then** the groups `offers`, `bookings`, `due_dates` and `reviews_history` are on, `news` is off, and every driver type carries the channel `email`.
2. **Given** a `PUT /api/v1/notification-preferences` that turns the `due_dates` group off, **When** it saves, **Then** DUE_ITP, DUE_RCA, DUE_ROVINIETA, SERVICE_DUE and TYRES_SEASON are saved with enabled = false, and the next DUE_ITP writes only the `in_app` row.
3. **Given** the `bookings` group is off, **When** a BOOKING_CONFIRMED or a JOB_READY is sent, **Then** each still writes its `email` row; so would BOOKING_TIME_PROPOSED, BOOKING_CANCELLED, BOOKING_LAPSED, GARAGE_SUSPENDED_NOTICE, BOOKING_MOVE_REFUSED and BOOKING_MOVE_LAPSED, which the group switch does not touch.
4. **Given** a call that turns an always-sent type off, **When** it is processed, **Then** it answers 422 with the code `notification_type_always_sent` and nothing changes.
5. **Given** a save, **When** the person reads their preferences again (another device, another session), **Then** the saved values come back.

---

### User Story 2 - A driver picks the one channel a type goes by (Priority: P2)

A driver has one channel per type. The channel picker is its own story; this story stores the choice and honours it at send time.

**Why this priority**: the store's shape must hold the channel from the start (decision ST-141), or every later channel story migrates it.

**Independent Test**: save QUOTE_RECEIVED with the channel `whatsapp`, hand the service a QUOTE_RECEIVED, and read the rows.

**Acceptance Scenarios**:

1. **Given** a driver sets the channel of QUOTE_RECEIVED to `whatsapp`, **When** the next quote arrives, **Then** no `email` row is written for it (WhatsApp sending arrives with its own story), and the preferences read back QUOTE_RECEIVED with the channel `whatsapp`.
2. **Given** a channel the type does not allow (for example `sms` for QUOTE_RECEIVED), **When** it is saved, **Then** it answers 400 with the code `channel_not_allowed` and nothing changes.

---

### User Story 3 - Garage staff choose per channel, for their garage (Priority: P2)

Garage staff and admins choose per type and per channel; a garage person's choices carry the garage. The staff panels are ST-198; this story stores and checks them.

**Why this priority**: the owner decided a garage can mute new request messages on any channel; the store must keep those apart from the same person's driver choices.

**Independent Test**: a garage owner saves REQUEST_RECEIVED off for `push` only at their garage; a driver-and-garage account reads its preferences; a call names a garage the caller does not belong to.

**Acceptance Scenarios**:

1. **Given** a garage owner turns REQUEST_RECEIVED off for `push` only, **When** a request arrives for that garage, **Then** push is muted and e-mail still goes (its `email` row is written).
2. **Given** an account that is both driver and garage owner, **When** preferences are read, **Then** the driver rows (garage empty) and the garage rows (garage set) come back as separate entries.
3. **Given** a garage the caller does not belong to, **When** a choice for it is saved, **Then** it answers 404 and nothing changes.

---

### User Story 4 - Only the person themselves reads or changes their choices (Priority: P1)

**Why this priority**: preferences are personal settings; another person must not learn or change them.

**Independent Test**: two drivers save different choices; each reads only their own; call both routes without a session.

**Acceptance Scenarios**:

1. **Given** two accounts with saved choices, **When** each reads and saves, **Then** neither sees nor changes the other's rows; the routes take no account id, so another account's preferences cannot be named at all.
2. **Given** no session, **When** either route is called, **Then** it answers 401.

---

### Edge Cases

- The preferences cannot be read at send time (the store fails): the message goes on the default channel as if nothing were saved, rather than being dropped.
- A transactional type (ACCOUNT_EMAIL, SIGN_IN_CODE, …) is treated like an always-sent one: it cannot be switched off.
- A group switch on a group whose every type is always-sent changes nothing; a group's always-sent types are never touched by its switch.
- The same body saved twice: the second save writes no audit entry (nothing changed).
- Two saves at once for one account: they run one after the other; the last one wins per row.
- An unknown type name in a save: 400 `unknown_notification_type`, nothing changes.
- A garage set on a driver (grouped) type: 400 `garage_not_allowed`, nothing changes.
- A type that allows no outside channel (DAY_SHEET_OUTDATED): it cannot carry a choice (any channel is `channel_not_allowed`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The five driver groups MUST be keys in code — `offers`, `bookings`, `due_dates`, `news`, `reviews_history` — each mapping to the catalogue types whose group it is; the map MUST be data the panels can read through the API.
- **FR-002**: A NOTIFICATION_PREFERENCE row MUST hold the account, an optional garage, the type, the channel and whether it is enabled. A driver (grouped) type MUST have at most one row per account: its chosen channel, with enabled = its switch. Any other type MUST have at most one row per account, garage, type and channel.
- **FR-003**: A missing row MUST mean the default: enabled for every type except NEWS; for a driver type, the channel `email` (every driver type allows it).
- **FR-004**: `GET /api/v1/notification-preferences` MUST answer, for the signed-in person, the five groups with their state (on when every type of the group that can be muted is enabled) and one entry per driver type (type, channel, enabled, always sent, garage empty) with the defaults filled in, followed by every saved row of the person's other types (garage set or empty).
- **FR-005**: `PUT /api/v1/notification-preferences` MUST take group switches and per-type choices; a group switch MUST write enabled to every type of the group that can be muted, keeping each type's channel, and MUST NOT touch the group's always-sent types; per-type choices MUST each carry the type, the channel and `enabled` (required) and MUST be applied after the group switches; the answer MUST be the preferences as FR-004 reads them after the save.
- **FR-006**: A save MUST be refused, with nothing changed, when: a choice switches off an always-sent or transactional type (422 `notification_type_always_sent`); a type is not in the catalogue (400 `unknown_notification_type`); a channel is not one the type allows (400 `channel_not_allowed`); a garage is given for a driver type (400 `garage_not_allowed`); a garage is one the caller is not an owner, receptionist or mechanic of (404).
- **FR-007**: Both routes MUST work for any signed-in person, for their own preferences only: they read and write the caller's rows and take no account id; a call without a session MUST answer 401.
- **FR-008**: A save MUST be one transaction (never partial); saves for one account MUST run one at a time, so the last one wins per row.
- **FR-009**: The notifications entry point MUST take an optional garage with a message. Before writing a message's outside rows, the sending pipeline MUST check, in order: the type is always-sent or transactional → send as before (e-mail included whenever the type allows it); the type is off for the person → `in_app` only; otherwise → only on the chosen channel or channels. A driver type is checked against the person's row with no garage; any other type against the rows of the message's garage (none when the message has no garage). The quiet-hours rule of ST-194 then decides when an outside send goes.
- **FR-010**: When the preferences cannot be read at send time, the pipeline MUST send as if nothing were saved (the defaults of FR-003), and log it without the person's details.
- **FR-011**: Each change a save makes MUST write one audit history entry inside the save's transaction — one per group switch that changed the group's state, and one per per-type choice that changed its row: who, the group or the type (with its channel and garage), the old and the new value; a save that changes nothing writes none.
- **FR-012**: After a save, the person's other open tabs MUST be told on the live connection: `notification_preferences.updated` for the audience `account:{accountId}`; a publish failure MUST be logged and MUST NOT fail the save.

### Key Entities

- **Notification preference** (new, NOTIFICATION_PREFERENCE): account, garage (optional), type, channel, enabled, updated at.
- **Notification type** (code, exists): the catalogue entry of ST-194; its driver group decides whether a type is a driver type.
- **Notification** (exists): the pipeline writes fewer outside rows when a type is muted.

## Clarifications

### Session 2026-10-05

- Q: The brief proposes the 422 code `NOTIFICATION_TYPE_ALWAYS_SENT`; every other code in the API is lower snake case (`unknown_recipient`, `sign_in_required`). Which? → A: `notification_type_always_sent`, the repo's convention; the brief marks the code *(proposed)*. (autonomous, recommended)
- Q: When is a group "on" after a per-type choice muted only one of its types? → A: On only when every type of the group that can be muted is enabled; switching it on enables them all (FR-004, FR-005). (autonomous default)
- Q: An always-sent driver type whose chosen channel is not e-mail: does it still send e-mail? → A: Yes. ST-194's 194-FR-004 keeps an always-sent type on e-mail whatever is muted; the check here only adds what is muted, so a critical message keeps reaching the inbox (FR-009). (autonomous default, keeps a merged requirement)
- Q: The default channel is "push if the person has a push subscription, else e-mail". → A: There is no push subscription yet (ST-196 adds it), so the default is e-mail when the type allows it, else the type's first channel (FR-003); ST-196 adds the push default with the subscription. (autonomous default)
- Q: How does a call name "another account's id" (scenario 8) when the routes are the caller's own? → A: It cannot: the routes take no account id and act on the caller only, which meets "another account's preferences answer 404" without a parameter whose one valid value is the caller's own id (FR-007, Principle I). (autonomous, recommended by spec-challenger)
- Q: Does a group switch write one audit entry or one per type it changes? → A: One per group switch, plus one per explicit per-type choice that changed (FR-011). (autonomous, recommended)
- Q: May a per-type choice omit `enabled`? → A: No, it is required, so a channel change sent with a group switch never re-enables a type by accident (FR-005). (autonomous, recommended)

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-010, FR-011, FR-012
- **Modifies**: 194-FR-004 → FR-009
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A driver with `due_dates` off gets a DUE_ITP only in the bell: 1 `in_app` row, 0 `email` rows (API test).
- **SC-002**: With `bookings` off, BOOKING_CONFIRMED and JOB_READY still write their `email` row (2 of 2, API test).
- **SC-003**: A new driver reads 4 groups on and `news` off with no saved row (API test).
- **SC-004**: Every refusal in the contract's error table and the 401 leave the store and the audit history unchanged (API tests, 7 of 7).

## Assumptions

- No screen in this story: the driver's switch panel is ST-138, the staff panels ST-198, the channel picker "Choose a channel for each notification", news consent its own story (Build brief › Screens, Out of scope). (Build brief)
- Only e-mail is sent today (ST-194); a type whose chosen channel is push, SMS or WhatsApp gets its bell row and no outside row until those senders exist. (Build brief › Out of scope, ST-194)
- NEWS stays off by default for everyone until news consent is built; this story does not stop a person switching it on through the API, because recording consent belongs to that story. (autonomous default)
- The end-to-end check of the brief (turn `due_dates` off, a test ITP reminder appears only in the bell) is covered by API integration tests that hand the service the reminder directly: there is no screen and no endpoint that fires a reminder yet (the scheduler for timed reminders is its own story). (autonomous default)
- Staff defaults are not listed by GET (there are about thirty staff types times three channels); a missing staff row is on, and GET lists only the staff rows saved. ST-198 decides what its panel shows. (autonomous default)
- An AI assistant changing preferences is not possible in this story because no assistant grant exists yet; the brief marks the rule *(proposed)*. (autonomous default)

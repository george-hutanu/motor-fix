# Feature Specification: See my notifications in a list behind the bell

**Feature Branch**: `199-notification-bell`

**Created**: 2026-10-05

**Status**: Archived (2026-10-05)

**Input**: User description: "ST-199 See my notifications in a list behind the bell (Notion https://app.notion.com/p/3ee607bff0d281e0a903f6f4d2ccf719, EP-1 Foundations)."

**Sources**: Notion story ST-199 (https://app.notion.com/p/3ee607bff0d281e0a903f6f4d2ccf719), read 2026-10-05; its Build brief (current as of 2026-10-03) wins over the criteria above it. Blockers, all Merged: ST-194 (the `in_app` rows and `notification.created`), ST-253 (the live connection), ST-257 (receiving live events), ST-158 (the bottom sheet), ST-195 (the bell texts). Design: `design.md`.

## Clarifications

### Session 2026-10-05

- Q: In which language is a row's text rendered? → A: The language the screen shows, sent as `language` on the list call; without it, the account's saved language. The account's language is saved after the switch, so a list opened right after a switch would otherwise come back in the old one (scenario 9).
- Q: Popover on desktop, bottom sheet on a phone? → A: One task in the Overlays drawer (ST-157/158), which is a bottom sheet below 768 px. The brief marks the 400 px popover *proposed*; the drawer gives the phone sheet with no second host for the same list. (autonomous default)
- Q: Where does tapping a notification go? → A: Nowhere yet. No kind that writes a bell row today (`TEST_MESSAGE`; the others' screens do not exist yet) has a screen, so tapping marks the row read and the list stays open. The first story that builds a kind's screen adds the kind → screen step and its "Nu mai este disponibil" case (scenarios 3 and 8); building that map now would be code no path reaches (Principle I). (autonomous default)
- Q: How does the toast get its text? → A: On `notification.created` the bell reloads its count and, if loaded, its first page; the toast shows the text of the row with the event's id, or the generic text when the row is not in that page.
- Q: How do the person's other tabs learn of a read? → A: Marking one or all as read publishes `notification.read` on `account:{accountId}` straight to Redis, as `notification.created` is; every tab reloads its count and list on it (brief, Live updates, *proposed*).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See how many are unread and open the list (Priority: P1)

A signed-in person on any dashboard sees the bell "Notificări" in the header with the number of unread notifications, opens it and reads their own notifications, newest first.

**Why this priority**: the story's core; every later epic's events land here.

**Independent Test**: seed bell rows for a driver, open a dashboard, check the badge and the list.

**Acceptance Scenarios**:

1. **Given** a driver with 3 unread notifications, **When** any dashboard view is open, **Then** the bell shows "3"; above 9 it shows "9+"; at 0 no badge.
2. **Given** the driver opens the bell, **When** the list loads, **Then** rows show newest first, 20 at a time with more loaded on demand, each with its text in the screen's language, its time ("acum 5 min") and an unread mark.
3. **Given** no notifications, **Then** the list says "Nicio notificare încă"; while loading it shows three row skeletons; on a failed load it shows "Reîncearcă" and the badge keeps its value.

### User Story 2 - Mark as read (Priority: P1)

**Acceptance Scenarios**:

1. **Given** an unread notification, **When** the person taps it, **Then** `read_at` is saved and the badge goes down by one.
2. **Given** several unread, **When** the person taps "Marchează tot ca citit", **Then** all are read and the badge disappears.
3. **Given** a call to mark another person's notification as read, **Then** 404.

### User Story 3 - New notifications arrive live (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the app is open, **When** a notification is created for the person, **Then** a toast with its text shows for 5 seconds, the badge goes up and the row joins the top of the list with no reload; an open form stays as it was.
2. **Given** the person reads in one tab, **Then** their other tabs' badge and list follow.
3. **Given** the live connection is down, **Then** the badge refreshes each time the bell opens and every 60 seconds.

### Edge Cases

- A kind the person switched off still shows in the bell (ST-197 writes the `in_app` row regardless).
- Rows older than 90 days are neither listed nor counted.
- A cursor that is not one of the person's listed rows answers 400 `invalid_cursor`.
- Visitors have no bell (the frame is only shown signed in).
- A row whose kind has no bell text shows the generic text.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `GET /api/v1/notifications?cursor&language` MUST return the signed-in person's own `in_app` rows of the last 90 days, newest first (created, then id), 20 per page, with `nextCursor`; each item has `id`, `kind`, `subjectId`, `text`, `at` and `readAt`.
- **FR-002**: Each item's `text` MUST be the kind's bell template rendered from the row's params in the requested language (`ro` or `en`), else the account's language, falling back to the generic text.
- **FR-003**: `GET /api/v1/notifications/unread-count` MUST return the number of the person's unread `in_app` rows of the last 90 days.
- **FR-004**: `POST /api/v1/notifications/:id/read` MUST set `read_at` once (a second call keeps the first time) and return the item; a row that is not the caller's own `in_app` row answers 404.
- **FR-005**: `POST /api/v1/notifications/read-all` MUST set `read_at` on every unread `in_app` row of the caller and no one else's.
- **FR-006**: Marking read (one or all) MUST publish `notification.read` on `account:{accountId}`; a Redis failure is logged and does not fail the call.
- **FR-007**: Every dashboard's header MUST show the bell button "Notificări" / "Notifications" with the unread badge ("9+" above 9, none at 0), its count also in the button's accessible name.
- **FR-008**: The bell MUST open the list in the Overlays drawer (a bottom sheet on a phone) with the empty, loading and error states, relative times up to 24 hours then the date in Europe/Bucharest, an unread mark per row, "Marchează tot ca citit" and loading more on demand.
- **FR-009**: Tapping a row MUST mark it read.
- **FR-010**: On `notification.created` the bell MUST show a 5-second toast with the row's text and refresh its badge and list without a reload; on `notification.read` it MUST refresh them.
- **FR-011**: The bell MUST refresh its badge every 60 seconds while a dashboard is shown, and each time it opens.

### Key Entities

- **NOTIFICATION** (existing, ST-194): `account_id`, `kind`, `subject_id`, `channel` (`in_app` here), `params`, `created_at`, `read_at`. Read side only; no schema change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A test message sent to an open dashboard shows its toast and badge within 2 seconds (as ST-253's live test).
- **SC-002**: The bell works the same in the driver, garage and admin areas (receptionists and mechanics share their role's area).

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011
- **Modifies**: none
- **Removes**: none

## Assumptions

- (autonomous default) Level 1, as ST-257: a read side in `libs/domain/src/notifications` and one shared web component in the dashboard frame; no plan, checklist or analyze.
- (autonomous default) Proposed details of the brief taken as written: "9+", 20 per page, 90 days, 5-second toast, the empty and "no longer available" texts, the `notification.read` kind, the bell in the phone header.
- (autonomous default) No kind → screen step (no screen of a current kind exists); it and "Nu mai este disponibil" come with the first kind that has a screen (Principle I).
- (autonomous default) No index added: the existing `(account_id, created_at)` index serves the list and the count for one person's 90 days.

# Feature Specification: Keep the bell's loaded rows when a read comes back live

**Feature Branch**: `603-bell-read-echo`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-603 — https://app.notion.com/p/3f0607bff0d281caa4cbc21046aba1d6
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: tech debt deferred by the PR tester on ST-199 (PR #80), `specs/199-notification-bell/deferred.md`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rows loaded with "Mai multe" stay when a notification is read (Priority: P1)

A person opens the bell, taps "Mai multe" to load older notifications, then
taps one to read it. The API announces the read live (`notification.read`) to
every tab of the account, this one included, and today each tab answers by
reloading only the first page and replacing the list with it: the older rows
the person just loaded vanish on every tap, and the same happens in their other
tabs. After this change a read keeps every row already shown, marks the read
row as read wherever it sits, and brings the first page and the badge up to
date.

**Independent Test**: load two pages, read a row on the second page, deliver
the `notification.read` echo, and check that both pages are still listed, that
row is read, and "Mai multe" still follows the second page.

**Acceptance Scenarios**:

1. **Given** two pages loaded, **When** this tab reads a row and the `notification.read` echo for it arrives, **Then** every row of both pages is still listed, in the same order, and the read row stays read.
2. **Given** two pages loaded in a tab, **When** another tab reads a row that this tab shows on its second page, **Then** this tab marks that row read and keeps both pages.
3. **Given** a list loaded, **When** a `notification.read` arrives, **Then** the badge is reloaded and the first page is reloaded and merged in: its rows take their fresh state and the rows below it stay.
4. **Given** two pages loaded, **When** another tab marks all as read and the reloaded count is 0, **Then** every row shown, on every page, shows as read.
5. **Given** two pages loaded and more to load, **When** a `notification.read` arrives, **Then** "Mai multe" still loads the page after the last row shown, not the second page again.

### Edge Cases

- The first-page reload fails: the rows shown stay as they were, and the event's row is still marked read (as today, the next open reloads).
- The event's id names no row shown (a row not loaded yet, or the account id of a "mark all"): nothing is marked by id; the first-page merge and the count still apply.
- The list was never opened (`idle`) or is loading: only the badge is reloaded, as today.
- A "mark all" elsewhere while a new notification arrives, so the count is above 0: rows below the first page keep their marks until the next open (see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On `notification.read`, the bell's list MUST keep every row already loaded and MUST NOT lose its place for "Mai multe": the reloaded first page is merged in front of the rows below it (as a new notification's arrival already does), and the next page still follows the last row loaded (modifies 199-FR-010).
- **FR-002**: On `notification.read` whose id names a row shown, the bell MUST show that row as read, wherever it sits in the list.
- **FR-003**: On `notification.read`, when the reloaded unread count is 0, the bell MUST show every row shown as read.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003
- **Modifies**: none
- **Removes**: none

FR-001 changes how ST-199's FR-010 refreshes the list on `notification.read` (merged, not replaced). If `notifications.md` does not hold ST-199's requirements yet, ST-199's archive takes this wording.

## Success Criteria *(mandatory)*

- **SC-001**: After any `notification.read`, the number of rows shown never falls below the number shown before it (the tests read rows before and after).
- **SC-002**: Every existing bell scenario of ST-199 still passes, except the one that encoded the reset to the first page, which this story replaces.

## Assumptions

- (autonomous default) One handling for every `notification.read`, this tab's echo and other tabs' reads alike, rather than recognising and ignoring this tab's own echo: the story offers both; merging fixes the other tabs too, and needs no record of which reads this tab sent (Principle I). Evidence: `apps/web/src/app/dashboard/bell.ts` `merge()` already keeps loaded rows for `notification.created`.
- (autonomous default) The read time shown for a row marked from an event is the event's `at`; the next reload of its page brings the server's `readAt`.
- (autonomous default) "Mark all" elsewhere is recognised by the reloaded count being 0, not by the event id: the event carries the account id, which the web app does not compare against (`libs/domain/src/notifications/bell.service.ts` `announce`). When the count is above 0 at that moment, rows below the first page keep their marks until the next open.
- (autonomous default) No screen, text or API change; the list markup (`bell-list.ts`) stays as ST-199 built it.

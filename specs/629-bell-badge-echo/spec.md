# Feature Specification: Keep the bell's badge right after this tab's own read

**Feature Branch**: `629-bell-badge-echo`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-629 — https://app.notion.com/p/3f0607bff0d281488223cdb8e14a4d23
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: tech debt deferred by code-reviewer on ST-603 (PR #109), `specs/603-bell-read-echo/deferred.md`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The badge counts the unread notifications after a read (Priority: P1)

A person with unread notifications opens the bell and taps one to read it. The
API marks it read and announces the read live (`notification.read`) before it
answers the tap. When the announcement reaches this tab first, the tab reloads
the unread count, which already leaves the read one out, and then the tap's
answer lowers the count by one again: the badge shows one unread fewer than
there are until the next minute's refresh. After this change, the badge shows
the server's unread count after a read, whichever arrives first.

**Independent Test**: with two unread, read one; deliver the `notification.read`
echo and its count reload (1) before the read's answer; check the badge shows 1,
not 0.

**Acceptance Scenarios**:

1. **Given** two unread and this tab reads one, **When** the live echo's count reload (1) lands before the read's answer, **Then** the badge shows 1.
2. **Given** two unread and this tab reads one, **When** the read's answer lands with no live echo (the connection is down), **Then** the badge shows 1.
3. **Given** two unread and this tab reads one, **When** a new notification arrives meanwhile so the server counts 2, **Then** the badge shows 2 once the read is answered.
4. **Given** the read's answer has landed, **When** the count fails to reload, **Then** the badge is lowered by one from what it showed, as before this change.

### Edge Cases

- The read fails: the row and the badge stay as they were and the failure is said (unchanged).
- The row is already read: nothing is asked and the badge is unchanged (unchanged).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After this tab's read of a notification is answered, the bell's badge MUST show the unread count the server gives at that moment, whether or not the live echo of that read was handled before the answer.
- **FR-002**: When that count cannot be loaded, the badge MUST be lowered by one from what it shows, never below 0.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: After any read in this tab, the badge equals the server's unread count once the read is answered, in every order of echo and answer the tests drive.
- **SC-002**: Every existing bell scenario still passes; the one that checked the badge lowered by one is reworded to read the count from the server.

## Assumptions

- (autonomous default) The read takes the server's count after its answer, instead of recognising this tab's own echo: it needs no record of which reads this tab sent (Principle I), and it also corrects the badge when another notification arrived meanwhile. Evidence: `libs/domain/src/notifications/bell.service.ts` `read()` announces before it returns; `apps/web/src/app/dashboard/bell.ts` `refreshCount()` already returns the fresh count or null.
- (autonomous default) This costs one more unread-count request per read; the count endpoint is a single indexed count (ST-199) and a read is a tap.
- (autonomous default) The badge drops when the count reload answers, a moment after the row shows read, rather than at the same instant.
- (autonomous default) No screen, text or API change.

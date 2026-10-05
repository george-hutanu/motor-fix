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
5. **Given** the echo's count reload (1) has been shown, **When** the read's own count reload fails, **Then** the badge stays 1.
6. **Given** two count reloads in flight, **When** the older one answers last, **Then** the badge keeps the newer one's count.
7. **Given** a read waiting for its answer, **When** the same row is tapped again, **Then** no second read is sent and the badge is lowered at most once.

### Edge Cases

- The read fails: the row and the badge stay as they were and the failure is said (unchanged).
- The row is already read: nothing is asked and the badge is unchanged (unchanged).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After this tab's read of a notification is answered, the bell's badge MUST show the unread count the server gives at that moment, whether or not the live echo of that read was handled before the answer.
- **FR-002**: When that count cannot be loaded, the badge MUST be lowered by one from what it shows, never below 0 — unless a count asked for after the read was sent (the live echo's reload) has already been shown, which already leaves the read one out.
- **FR-003**: An unread count that answers a request older than the one the badge shows MUST NOT replace it; the request's own caller still reads its answer (a "mark all" elsewhere is still recognised by it).
- **FR-004**: A second tap on a row whose read is still waiting for its answer MUST NOT send a second read or lower the badge a second time.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004
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
- (coordinator decision, from the adversarial tests) The read's fallback is skipped when a count asked for after the read was sent has been shown: the server announces a read only after it is stored, so the echo's reload already counts it. A minute refresh sent between the tap and the store's commit would also skip it; the badge is then one high until the next refresh, which is the safe side.
- (coordinator decision) Count answers are ordered by when they were asked: an older answer landing last no longer overwrites a newer one. Its caller still gets it, so "mark all" elsewhere (a count of 0 for that request) is still recognised.
- (coordinator decision) A row whose read is in flight ignores further taps, so a double tap sends one read and lowers the badge once.

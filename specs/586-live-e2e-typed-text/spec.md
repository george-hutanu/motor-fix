# Feature Specification: Typed-text step in the live end-to-end test

**Feature Branch**: `586-live-e2e-typed-text`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "ST-586 "Tech debt (ST-256): add the typed-text step to the live end-to-end test with the first live form dialog" (https://app.notion.com/p/3f0607bff0d28116812ce6dfd2ce06e1)"

**Sources**: the Notion task ST-586 (fetched 2026-10-07, no comments on the page), its origin `specs/256-live-in-place/deferred.md`, the live capability `.specify/capabilities/live-updates.md` (256-FR-005), and the repository's end-to-end suite (`apps/web-e2e/src/live.spec.ts`, `apps/web-e2e/src/staff-invite.spec.ts`).

## Why

ST-256 promised, in its Build brief, an end-to-end check that a live update leaves an open dialog, the text typed in it and the focus untouched. When ST-256 shipped, no dashboard dialog had a text field: the one dialog, "Ieși de pe toate dispozitivele?", has buttons only, so the end-to-end check covers a confirm dialog and only the component test (`frame.spec.ts`, "leaves an open dialog, the text typed in it, the focus and the address as they were") proves the typed-text case. The spec-reviewer deferred the gap as this task. The garage dashboard now has a form dialog, "Invită în echipă", with two text fields ("Nume", "E‑mail"), so the promised check can be written against the real application.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A live update leaves a half-filled dialog alone (Priority: P1)

A garage owner signed in on the garage dashboard opens "Invită în echipă" and starts typing a colleague's name. Meanwhile an admin, from another session, sends the live test update to that owner's account. The owner sees the update's line appear on the dashboard behind the dialog, and nothing else changes: the dialog is still open, the name they typed is still in the field, the cursor is still in that field and the page never reloaded. The end-to-end suite proves this against the running application, not only at component level.

**Why this priority**: it is the whole task: the one promised check that the live capability lacks end-to-end evidence for.

**Independent Test**: run the live end-to-end suite against the seeded application; the new check passes on the current application and would fail if a live update closed the dialog, cleared the field, moved focus or reloaded the page.

**Acceptance Scenarios**:

1. **Given** the garage owner is signed in on the garage dashboard with "Invită în echipă" open and a name typed into "Nume", that field focused, **When** an admin sends the live test update to the owner's account from another context, **Then** the line "Actualizare de test în direct" is visible on the dashboard within 2 seconds, the dialog is still open, "Nume" still holds exactly the typed text, "Nume" is still the focused element, and the page recorded no document load.
2. **Given** the same state, **When** the check finishes, **Then** no invitation was sent: the dialog was never submitted, so the seeded garage's team and the mailbox are as they were before the check.

---

### Edge Cases

- The open modal hides the dashboard behind it from the accessibility tree, so the update's line is found as the existing dialog check finds it: by its status role and text, not by an accessible-name query.
- The typed text must be a value the field accepts without validation noise (a plain name); the e-mail field may stay empty since the dialog is never submitted.
- The check runs in the same suite tags as its siblings (`@seeded`); it needs no mailbox because nothing is sent.
- The existing driver-dashboard dialog check (confirm dialog, button focus) stays: it covers the focus-on-a-button case the new check does not.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The live end-to-end suite MUST include a check in which a signed-in garage owner has the "Invită în echipă" dialog open with text typed into a text field and that field focused, and an admin sends the live test update to that account from another context; the check MUST assert that the update's line "Actualizare de test în direct" is visible on the dashboard within 2 seconds.
- **FR-002**: After the update arrives, the check MUST assert, in the running application, that the dialog is still open, that the text field holds exactly the typed text, that the same field is still focused, and that no document load happened since the dashboard opened.
- **FR-003**: The check MUST never submit the dialog: it sends no invitation, changes no seeded data and needs no mailbox.
- **FR-004**: The change MUST be test-only: no product code, no new dialog, and the existing live checks (two dashboards, confirm dialog, isolation between drivers) stay as they are.

### Key Entities

- **Live test update**: the admin-sent event that every dashboard of the target account shows as a status line within 2 seconds (ST-256).
- **Invite dialog**: the garage dashboard's "Invită în echipă" form, the first dashboard dialog with text fields ("Nume", "E‑mail").

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The live end-to-end suite has one more check, and the whole suite passes in CI on the unchanged application.
- **SC-002**: The new check reports the update's line within the same 2-second bound the existing live checks use.
- **SC-003**: Breaking the behaviour (a live update that closes the dialog, clears the field, moves focus or reloads) fails the new check: each of the four assertions in FR-002 is present and would fail on its own.
- **SC-004**: The ST-256 deferred bullet for `live.spec.ts` can be ticked: the Build brief's typed-text check is covered end-to-end.

## Assumptions

- (autonomous default) The check is a new test next to the existing dialog test in the live suite, against the garage account, rather than a rewrite of the driver's confirm-dialog test: the driver dashboard has no form dialog, and the confirm-dialog case still earns its place.
- (autonomous default) The text is typed into "Nume" and that field keeps the focus; "E‑mail" stays empty. One text field is enough to prove the promise; the dialog is cancelled or the context closed at the end, never submitted.
- (autonomous default) The admin test update is sent exactly as the sibling checks send it (admin session over the API, the garage account's id), and the "no reload" assertion counts document loads as the existing dialog check does.
- The seeded garage account is an owner of its garage and can open "Invită în echipă" (as `staff-invite.spec.ts` already relies on).

## Spec Delta

### Capability: `live-updates`

- **Adds**: FR-001, FR-002, FR-003, FR-004
- **Modifies**: none
- **Removes**: none

256-FR-005 keeps its text; FR-001 and FR-002 are its end-to-end evidence.

# Feature Specification: Keep the account on screen behind the gate dialog

**Feature Branch**: `536-gate-dialog-dashboard`
**Created**: 2026-10-07
**Status**: Archived (2026-10-07)
**Input**: ST-536 (tech debt from ST-130, PR tester lap 1, LOW): "Behind the gate dialog the dashboard drops the person's name and keeps one menu item, because a failed renewal clears the session; keep the last account shown until the gate closes (`apps/web/src/app/dashboard/session.ts`, `frame.ts`)" — https://app.notion.com/p/3ef607bff0d281398a90fbf7dcf6999f

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The dashboard stays as it was while the gate asks to sign in (Priority: P1)

A signed-in person whose session ran out does something on their dashboard; the renewal fails and the sign-in dialog opens over the screen (130-FR-004). Behind the dialog the dashboard keeps their name, their role chips and every menu item of their dashboard, instead of falling back to an empty name and one item.

**Acceptance Scenarios**:

1. **Given** a garage owner on their dashboard whose renewal fails, **When** a refused call opens the gate dialog, **Then** while the dialog is open the frame still shows their name, their dashboard's tag and all the menu items their account had.
2. **When** they sign in through the dialog, **Then** the frame shows the account the sign-in loaded (130-FR-005), with no moment where the name is empty.
3. **When** they close the dialog without signing in, **Then** the kept account is let go and the frame shows what a signed-out session shows today (130-FR-006 unchanged).
4. **When** the person signs out (here or in another tab) while the dialog is open, **Then** nothing of the old account is kept.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While a sign-in dialog opened by 130-FR-004 is open, the dashboard frame MUST keep showing the account that was on screen when the refused call failed (name, role chips, dashboard, menu items, invite button), even though the failed renewal has forgotten the session; the kept account MUST be let go when that dialog closes, and at sign-out, so only the account the session holds is shown afterwards. Access decisions (the area guard, the views' guard, the token) MUST keep reading the session's own account, never the kept one.

## Assumptions

- "Until the gate closes" covers both endings: after a sign-in the session's newly loaded account takes over; after a close without sign-in the frame shows the signed-out state it shows today. (autonomous default, from the task's wording)
- The kept account is display only: no call carries it, and the guards keep reading `Session.current`, so nothing is granted by it (Constitution Principle I: one display signal, no second session state). (autonomous default)
- No design board covers the screen behind the gate dialog; the frame keeps its built look (design.md). (autonomous default)

## Spec Delta

### Capability: `accounts`

- **Adds**: `FR-001`
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the gate dialog open after a failed renewal, the frame shows the person's name and the same menu items as before (unit test on the frame).
- **SC-002**: After the dialog closes without sign-in, or after a sign-out, the frame shows no kept name (unit tests on the session).

# Feature Specification: A late "who am I" answer never puts the old role back

**Feature Branch**: `564-session-reload-role-race`
**Created**: 2026-10-06
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-564 — https://app.notion.com/p/3f0607bff0d281cb8b9ad4180f54e7e4
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: deferred by the PR tester, lap 4 on PR #71 (story ST-81 — https://app.notion.com/p/3ee607bff0d281fbb2b2ed051f341579): `apps/web/src/app/dashboard/session.ts`, medium, race

## The race

The signed-in account is read again ("reload") when the e-mail banner's
"send again" learns the address was confirmed meanwhile, when the live stream
reports `account.email_confirmed`, and when the stream resyncs after a drop.
That read is guarded only by the sign-out generation. A role switch (ST-394)
does not change the generation: it swaps the tab's access token and loads the
account in the new role. So a reload sent with the driver token that answers
after a switch to mechanic puts the driver account back on screen while the
tab holds the mechanic token. The token renewal already handles the same
race: an answer is dropped when the token it was sent with has been replaced.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The role I switched to stays on screen (Priority: P1)

A person holding two roles taps the mechanic chip while the app is re-reading
the account for the driver role (a resync, a confirmed e-mail). The mechanic
dashboard opens and stays the mechanic's, whatever order the two answers
arrive in.

**Independent Test**: start a reload, switch the role before it answers, then
let the reload answer: the account on screen is the switched role's.

**Acceptance Scenarios**:

1. **Given** the driver account on screen and a reload in flight, **When** the tab switches to mechanic and the reload then answers with the driver account, **Then** the account on screen stays the mechanic's.
2. **Given** a reload in flight, **When** nothing replaced the tab's token before it answers, **Then** the answer replaces the account on screen, as today.
3. **Given** a reload in flight, **When** the tab signs out before it answers, **Then** nothing is restored, as today.

### Edge Cases

- The reload answers before the switch: the driver account is updated, then the switch loads the mechanic's; unchanged.
- The token is renewed for the same role while the reload is in flight: that one answer is dropped and the previous account stays (see Assumptions).
- A sign-in or password reset that replaces the token while a reload is in flight: the answer is dropped; the sign-in's own load sets the account.
- The reload fails: the account on screen stays, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An answer to a re-read of the signed-in account MUST be dropped when the tab's access token changed while the read was in flight (a role switch, a sign-in, a renewal); the account on screen stays what it was.
- **FR-002**: A re-read whose token was not replaced MUST keep its contract: the answer replaces the account, a failed read keeps it, and an answer after a sign-out restores nothing.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: A test in `apps/web/src/app/dashboard/session.reload.spec.ts` that switches the role while a reload is in flight passes, and fails without the fix (the driver account comes back).
- **SC-002**: Every existing test in `session.reload.spec.ts` and `session.role-switch.spec.ts` still passes.

## Assumptions

- (autonomous default) The rule is "drop the answer when the access token changed meanwhile", the one the finding names and the one `renew()` already applies with `replaced()` (session.ts:204-205), rather than comparing the answer's role with the tab's. Evidence: Principle I, one rule for both races; a role comparison would still accept a stale answer for the same role.
- (autonomous default) A token renewed mid-reload for the same role also drops that one answer. Harmless: the screen keeps the previous account, which is reload's own "the old answer stays" contract; the next trigger reads again. Chosen over an exception for renewals, which would need the role comparison above.
- (autonomous default) Only the web session's reload changes; the e-mail banner, the frame's live handlers and the API are untouched. The existing specs `session.reload.spec.ts` and `session.role-switch.spec.ts` are the test seams, so no screen and no design board is involved.

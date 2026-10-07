# Feature Specification: Auth events through the event port

**Feature Branch**: `569-auth-events-through-event-port`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-569 "Record password-reset and session events through the event port" — https://app.notion.com/p/3f0607bff0d28111a434e75fcd9c94d3 (Task, Foundations epic, Low priority, labels backend and real-time; tech debt deferred by the reviews of ST-127, PR #72, `specs/127-password-reset/deferred.md:6`). The task page has no comments. "A completed password reset records no domain event through `EVENT_PORT` inside its transaction (as `signOutEverywhere` does), and its `password_changed` e-mail and `session.revoked` live message go out after the commit rather than through an outbox row (Constitution VI). Sign-in's own `session.revoked` publish follows the same pattern, so decide once for the auth flows."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A completed password reset leaves a domain event (Priority: P1)

When a driver or garage member finishes "Ai uitat parola?" with a new password, the system records that the account's password was reset as a domain event, saved together with the reset itself: the link taken, the password replaced, every other session ended and the audit entry written. Anything that later reads the account's event history (the live stream, the worker, a future "security activity" view) sees the reset the way it already sees a sign-out on all devices. A reset that is refused leaves no event.

**Why this priority**: it is the whole task. Today the reset is the one account-changing auth flow whose record exists only in the audit log, while sign-out everywhere and sign-up record a domain event in the same transaction (Constitution VI; `257-FR-011`).

**Independent Test**: complete a reset against a real database and read the outbox: one `account.password_reset` row for that account exists, and the rest of the reset answer is unchanged; complete a refused reset (link already used, weak password, maintenance) and read the outbox: no row.

**Acceptance Scenarios**:

1. **Given** an active account with a valid, unused reset link, **When** the new password is saved, **Then** the answer is the same as today (a new session is issued), and exactly one domain event `account.password_reset` exists for that account, with the account as its subject and audience and a payload holding only the account id, saved in the same transaction as the password, the taken link, the deleted refresh tokens and the audit entry.
2. **Given** the same link saved twice at once, **When** both saves run, **Then** the one that takes the link records one event and the other records none and is refused as expired (as today).
3. **Given** a reset refused before its transaction (a weak password, an unknown or expired link, maintenance for a non-admin account), **When** it is attempted, **Then** no domain event, no audit entry and no password change exist for the account.
4. **Given** the event cannot be recorded (the event port fails inside the transaction), **When** the new password is saved, **Then** the whole reset rolls back: the link stays unused, the password is unchanged, the refresh tokens remain, no audit entry is written, and the request fails with an unhandled server error (500) — as sign-out everywhere already behaves.

---

### User Story 2 - The auth flows tell open tabs one way (Priority: P2)

A password reset and a sign-out on all devices both end every other session of the account, and both nudge the account's open tabs to sign out right away. They do it the same way, through one shared mechanism, so the auth flows publish this nudge once rather than twice.

**Why this priority**: the task says "decide once for the auth flows". It changes no visible behaviour; it is the one place the decision lives.

**Independent Test**: complete a reset and a sign-out everywhere against a real database with the live publisher stubbed: once each call has resolved, the stub was called once with a `session.revoked` message for the audience `account:<id>`; when the reset's transaction throws, it was not called; a publisher failure is logged and changes neither answer.

**Acceptance Scenarios**:

1. **Given** a completed reset, **When** its transaction has committed, **Then** one `session.revoked` live message reaches the account's audience, as today (`128-FR-004` for sign-out everywhere).
2. **Given** the live publisher fails, **When** a reset or a sign-out everywhere completes, **Then** the failure is logged as a warning and the answer is unchanged (as today).
3. **Given** a reset whose transaction fails, **When** the request ends, **Then** no `session.revoked` message is published.

---

### Edge Cases

- A reset for an admin account during maintenance completes and records its event like any other (maintenance refuses only non-admins, as today).
- The password_changed e-mail cannot be sent (notifications queue down, `PUBLIC_WEB_URL` unset): the reset and its event stand, the failure is logged, as today.
- The account's language or other fields never enter the event payload; the payload is `{ accountId }` only, as for `account.signed_out_everywhere`. No password, hash, link or token data is ever recorded in an event.
- The two flows differ in what they delete (sign-out everywhere also deletes push subscriptions, the reset does not): the shared live nudge changes nothing about that.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A completed password reset MUST record one domain event of the new kind `account.password_reset` (added to the typed event catalogue, `257-FR-006`) through the event port, inside the same transaction that takes the link, replaces the password, deletes the account's refresh tokens and writes the audit entry; its subject and audience are the account, and its payload is exactly `{ accountId }`.
- **FR-002**: A password reset that is refused (link unknown, used, expired or taken by a concurrent save; weak password; maintenance for a non-admin), or whose transaction fails for any reason (the event port included), MUST record no `account.password_reset` event, and the transaction's other writes MUST roll back with it; the answer to the client stays what it is today.
- **FR-003**: After the transaction of a completed password reset or a sign-out on all devices commits, the API MUST publish one `session.revoked` live message to the account's audience through one method of the sign-in service that both flows call (today each calls `publishLive` itself); a failed publish MUST be logged and MUST NOT change the answer (extends `128-FR-004` to the reset). The order of this message and the password_changed e-mail is not specified.
- **FR-004**: The password_changed e-mail, the audit entry, the sessions revoked and the reset's answer MUST stay as ST-127 specified them; the API contract (openapi.json) and the web app MUST NOT change.

### Key Entities

- **Domain event** (outbox row): kind `account.password_reset`, subject the account, audience the account, payload `{ accountId }`; recorded with the change it describes, read by the live stream and the worker as every other kind is.
- **Live message** `session.revoked`: a transient nudge to the account's open tabs; not an event kind of the catalogue, published straight to the live fan-out after the commit.

## Clarifications

### Session 2026-10-07

- Q: Which event does a completed reset record, and where? → A: One `account.password_reset` through the event port inside the reset's transaction, audience and subject the account, payload `{ accountId }`; a refused reset records none. (autonomous default; evidence: Constitution VI "a change is saved with its event in the same transaction"; `SignInService.signOutEverywhere` records `account.signed_out_everywhere` the same way, `libs/domain/src/auth/sign-in.service.ts:208-213`)
- Q: Does `session.revoked` move to an outbox row? → A: No. It stays a direct live publish after the commit for both flows, through one shared helper on the sign-in service that both call. (autonomous default; evidence: `libs/contracts/src/events.ts:1-5` lists `session.revoked` among the kinds published straight to Redis, from the Backend architecture; the nudge only tells open tabs, and the refresh tokens are already deleted in the transaction, so a missed nudge signs the tab out at its next renewal, `128-FR-003`)
- Q: Does the password_changed e-mail move to an outbox consumer? → A: No. It stays sent straight to the notifications queue after the commit, its failure logged, as today. (autonomous default; evidence: the ST-127 Build brief, "Events and notifications": "Emits: none; both e-mails go straight to the notifications queue" — the event now recorded supersedes only "Emits: none". Moving it to a worker consumer is out of scope.)
- Q: Any screen, API or web change? → A: None. Existing behaviour (the reset answer, sessions revoked, e-mails, audit entry) does not change. (autonomous default; evidence: the task names only `password-reset.service.ts` and `sign-in.service.ts`; the Notion task has no Design boards)

- Q: Is the shared mechanism today's `publishLive`, or a new method? → A: A method on `SignInService` (publish, catch, warn) that both flows call; the reset drops its own `SESSION_EVENTS` injection. (spec-challenger #1; two real callers, Constitution I)
- Q: Does FR-003 add a requirement or modify `128-FR-004`? → A: It modifies `128-FR-004`; the Spec Delta says so. (spec-challenger #2)
- Q: Must the e-mail still go before the nudge? → A: No; no test or requirement fixes the order, only "after the commit" and "once". (spec-challenger #3)
- Q: What does the client get when the event port throws? → A: A 500, as sign-out everywhere; tested with a throwing `EventPort` stub, the link's `usedAt` still null. (spec-challenger #4)
- Q: Does the task's "Sign-in's own `session.revoked` publish" name a third flow? → A: No; it is `SignInService.signOutEverywhere`'s publish, one of the two flows this task touches. (checklist CHK006)
- Q: Does SC-002 cover sign-up? → A: No, only the two flows touched; sign-up's event is `257-FR-011`'s, already tested. (spec-challenger #5)

## Assumptions

- The event kind name follows the catalogue's `area.verb_past` form (`libs/contracts/src/events.ts`); `account.password_reset` is the only new kind.
- Every requirement is tested by Jest integration specs on real PostgreSQL (`*.integration.spec.ts`): the outbox holds one row after a completed reset and none after a refused one; the existing password-reset and sign-out-everywhere API specs keep passing unchanged except where they assert the new event.
- The deferred item in `specs/127-password-reset/deferred.md:6` is this task; closing it there is a documentation change that rides on this PR.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-004
- **Modifies**: `128-FR-004` — extended by FR-003: a completed password reset publishes `session.revoked` too, through the same method as sign-out everywhere
- **Removes**: none

### Capability: `live-updates`

- **Adds**: none
- **Modifies**: `257-FR-011` — a completed password reset (`account.password_reset`) also records its event through the outbox, with the account as its subject
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a completed password reset, exactly one `account.password_reset` outbox row exists for the account; after a refused one, zero.
- **SC-002**: Both flows this task touches (sign-out everywhere, password reset) record their account event in the same transaction as the change; one place in the code publishes `session.revoked`.
- **SC-003**: The existing password-reset and sign-out-everywhere integration suites pass with no change to any asserted answer, e-mail, audit entry or live message; they may gain assertions for the new event and the publish.

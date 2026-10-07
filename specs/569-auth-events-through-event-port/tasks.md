---

description: "Task list for ST-569 auth events through the event port"
---

# Tasks: Auth events through the event port

**Input**: `specs/569-auth-events-through-event-port/` (plan.md, spec.md, research.md, data-model.md, quickstart.md)

**Tests**: Required (Constitution II): the failing assertions come first, in the existing specs. Integration specs run on real PostgreSQL and Redis through `scripts/heavy.sh`.

**Format**: `[ID] [P?] [Story] Description`. All paths exist unless marked `(new)`; none are new.

## Phase 1: Foundational (blocks both stories)

- [X] T001 Add `'account.password_reset'` to `EVENT_KINDS` in `libs/contracts/src/events.ts` (FR-001; `EventKind` is a closed union, so `events.record` does not compile without it)

---

## Phase 2: User Story 1 - A completed password reset leaves a domain event (P1)

**Goal**: a completed reset records one `account.password_reset` outbox row in its own transaction; refused or failed resets record none and roll back (FR-001, FR-002, SC-001).

**Independent test**: `password-reset.api.integration.spec.ts` asserts the row after a 200, none after refusals, and a 500 with full rollback when `EVENT_PORT` throws.

### Tests first (red)

- [X] T002 [P] [US1] Add `account.password_reset` to the `it.each` kinds list in `libs/contracts/src/events.spec.ts` (lines 23-33)
- [X] T003 [US1] In `libs/domain/src/auth/password-reset.api.integration.spec.ts`, read the real `outbox_event` rows for the account (`prisma.outboxEvent.findMany({ where: { subjectId } })`; a throwing port is a `jest.spyOn` on the app's `EVENT_PORT`) and add: one recorded `{ audience: { accountId, type: 'account' }, kind: 'account.password_reset', payload: { accountId }, subjectId: accountId }` after a 200; none for an expired or unknown link (a used link: the adversary spec), a weak password and maintenance for a non-admin; two concurrent `complete` calls record one; a throwing port gives 500, `usedAt` null, old password still signs in, refresh tokens kept, no new audit entry, no `session.revoked` published

### Implementation

- [X] T004 [US1] In `libs/domain/src/auth/password-reset.service.ts` inject `@Inject(EVENT_PORT) private readonly events: EventPort` and call `this.events.record(tx, { audience: { accountId: account.id, type: 'account' }, kind: 'account.password_reset', payload: { accountId: account.id }, subjectId: account.id })` after `audit.record(tx, …)` inside the `prisma.$transaction` of `complete()` (T001 and T003 green)

**Checkpoint**: US1 green on its own.

---

## Phase 3: User Story 2 - The auth flows tell open tabs one way (P2)

**Goal**: one `SignInService` method publishes `session.revoked`; sign-out everywhere and the reset both call it (FR-003, SC-002, SC-003).

**Independent test**: `sign-out-everywhere.api.integration.spec.ts` spies the shared method (called once with the account id) and its other assertions stay unchanged; the reset's `session.revoked` tests (lines 641-693) stay green.

### Tests first (red)

- [X] T005 [US2] In `libs/domain/src/auth/sign-out-everywhere.api.integration.spec.ts` add one assertion that `SignInService.revokeSessionsLive` is called once with the account's id and `at` after a sign-out on all devices (spy on `app.get(SignInService)`); change nothing already asserted

### Implementation

- [X] T006 [US2] In `libs/domain/src/auth/sign-in.service.ts` add `revokeSessionsLive(accountId: string, at: Date): void` holding the current `publishLive(this.sessionEvents, …)` block with its catch and `session.revoked not sent` warning (not awaited); make `signOutEverywhere` call it. Keep `SESSION_EVENTS` exported
- [X] T007 [US2] In `libs/domain/src/auth/password-reset.service.ts` make `announce()` call `this.signIns.revokeSessionsLive(accountId, at)` and drop its own `publishLive` block, the `SESSION_EVENTS` injection and the `publishLive`, `audienceOf`, `randomUUID` imports (the reset's existing `session.revoked` tests stay green)

**Checkpoint**: both flows publish through one method.

---

## Phase 4: Close the deferred item

- [X] T008 [US1] Tick the second bullet (line 6, the missing `EVENT_PORT` event) of `specs/127-password-reset/deferred.md`, appending "done in ST-569"

- [X] T009 Verify FR-004: the existing password-reset, sign-out-everywhere and e-mail assertions pass unchanged, and `git diff --exit-code origin/main -- apps/api/openapi.json apps/web` is empty

---

## Dependencies and order

- T001 first; T002 and T003 (red) before T004; T005 (red) before T006, then T007 (same file as T004, so after it).
- T002 is parallel to T003 and T005 (different files).
- MVP: T001-T004 (US1). US2 follows on the same branch.

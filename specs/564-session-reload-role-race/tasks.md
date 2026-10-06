# Tasks: A late "who am I" answer never puts the old role back

**Input**: `specs/564-session-reload-role-race/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `apps/web/src/app/dashboard/session.reload.spec.ts` — a reload sent with the driver token is in flight, `switchRole` to mechanic completes (token swapped, mechanic account loaded), then the reload answers with the driver account; the account on screen stays the mechanic's (FR-001, SC-001)
- [X] T002 [US1] Test: `session.reload.spec.ts` — a reload in flight when a sign-in replaces the access token; the late answer is dropped and the sign-in's account stays (FR-001)

- [X] T005 [US1] Test: `session.reload.spec.ts` — a reload in flight while `renew()` replaces the token for the same session keeps its answer (FR-001; code review, repair lap 1)
- [X] T007 [US1] Test: `session.reload.adversary.spec.ts` — overlapping reloads and switches, a reload during the switch's own load, a failed switch that restores the old token (FR-001)

## Phase 2: Implementation

- [X] T003 [US1] `apps/web/src/app/dashboard/session.ts` `reload()`: remember `this.accessToken` when the read is sent and drop the answer when it differs, like `renew()`'s `replaced()` (FR-001)

- [X] T006 [US1] `session.ts`: the guard counts sign-ins (`starts`) and completed role switches (a new `switches` counter) instead of comparing tokens, so a renewal's retry lands (FR-001; replaces T003's token comparison)

## Phase 3: Proof

- [X] T004 `web:test` (`session.reload.spec.ts`, `session.role-switch.spec.ts`), `typecheck` and `lint` green; T001 fails without T003 (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `session.reload.spec.ts` › T001, T002, T005; `session.reload.adversary.spec.ts` › T007 |
| FR-002 | existing `session.reload.spec.ts` › "replaces the account with what the server now says, keeping it on screen meanwhile", "keeps the account it has when the server does not answer", "restores nothing after a sign-out", "does nothing signed out" |

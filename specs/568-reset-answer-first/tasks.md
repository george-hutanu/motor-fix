# Tasks: Answer a password-reset request before issuing the link

**Input**: `specs/568-reset-answer-first/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `libs/domain/src/auth/password-reset.api.integration.spec.ts` — with queueing the e-mail held open, a request for an active account still answers 202; once released, the token and the `password_reset` e-mail are written (FR-001, FR-002)
- [X] T002 [US1] Test: same file — closing the application while a link is held open waits for it, and the link is written before `close()` resolves (FR-003)
- [X] T003 [US1] Same file: the existing request scenarios wait for the issuing to settle before reading the token and e-mail rows, and the failed-queue scenario checks the log after it settles (FR-002, SC-002)

## Phase 2: Implementation

- [X] T004 [US1] `libs/domain/src/auth/password-reset.service.ts`: `ask` starts the issuing without awaiting it, tracks it until it settles, catches and logs its failure without the address; `drain()` waits for every issuing in flight; `beforeApplicationShutdown` calls it (FR-001, FR-002, FR-003)

- [X] T006 [US1] `apps/web-e2e/src/password-reset.spec.ts`: the test mailbox polls for the reset e-mail, which now lands just after the 202 (FR-001)

## Phase 3: Proof

- [X] T005 `npx nx run domain:test` with the worktree's PostgreSQL and Redis green; `npm run typecheck` and `npm run lint` green (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `password-reset.api.integration.spec.ts` › "answers 202 before the link is issued, then issues it" |
| FR-002 | `password-reset.api.integration.spec.ts` › same test (rows after release), and the ST-127 request scenarios after `drain()`; failed queue logged without the address |
| FR-003 | `password-reset.api.integration.spec.ts` › "waits, on shutdown, for a link still being issued" |

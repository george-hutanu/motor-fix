# Tasks: Move the news fan-out to a worker job

**Input**: `specs/571-news-fan-out-worker/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `libs/domain/src/notifications/news.api.integration.spec.ts` — a send answers 202 with the count, writes no message and queues one job `news-<month>` with the content and sender (FR-001)
- [X] T002 [US1] Test: same file — the existing send scenarios (languages, links, e-mail only, month rules, audit, quiet hours) pass with the job run by the fan-out (FR-002)
- [X] T003 [US1] Test: same file — a run failing part-way and run again reaches each driver once and keeps the month (FR-003)
- [X] T004 [US1] Test: same file — a run failing on its last attempt gives the month back and records it; one failing before the last does not (FR-004)
- [X] T005 [US1] Test: same file — a send whose job cannot be queued gives the month back and answers 500 (FR-005)
- [X] T006 [US1] Test: `libs/domain/src/notifications/news.worker.integration.spec.ts` — the worker module runs a queued news job with the secret, and leaves it queued without it (FR-002, FR-006)

## Phase 2: Implementation

- [X] T007 [US1] `libs/domain/src/notifications/news.fan-out.ts` (new): the run, the final-failure release, the consenting-drivers filter (FR-002, FR-003, FR-004)
- [X] T008 [US1] `libs/domain/src/notifications/news.service.ts`: claim, count, queue; release when queueing fails (FR-001, FR-005)
- [X] T009 [US1] `libs/domain/src/notifications/notifications.module.ts` and `apps/worker/src/main.ts`: the `news` queue in both, its worker in the worker when the secret is set (FR-006)

## Phase 3: Proof

- [X] T010 `npx nx run domain:test`, `npm run typecheck` and `npm run lint` green (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `news.api.integration.spec.ts` › T001 |
| FR-002 | `news.api.integration.spec.ts` › T002; `news.worker.integration.spec.ts` › T006 |
| FR-003 | `news.api.integration.spec.ts` › T003 |
| FR-004 | `news.api.integration.spec.ts` › T004 |
| FR-005 | `news.api.integration.spec.ts` › T005 |
| FR-006 | `news.worker.integration.spec.ts` › T006 |

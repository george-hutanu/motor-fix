# Tasks: Give features one way to publish and receive live events

**Input**: spec.md, design.md (level 1: no plan)
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: User Story 2 — the typed catalogue (P1)

- [X] T001 [US2] `libs/contracts/src/events.ts` (new): `EVENT_KINDS` and `EventKind` for every kind of the Backend architecture events list, `account.signed_out_everywhere` and `live.test` (FR-006); `libs/contracts/src/events.spec.ts` with the story's kinds and an unknown kind under `@ts-expect-error`

## Phase 2: User Story 1 — the outbox and the relay (P1)

- [X] T002 [US1] `libs/domain/prisma/schema/events.prisma` and a migration: `outbox_event` (id bigserial, kind, subject_id, payload jsonb, audience text[], created_at, relayed_at), with an index on `relayed_at` (it serves both the waiting rows and the clean-up)
- [X] T003 [US1] `libs/domain/src/events/event.port.ts`: `DomainEvent` takes an `EventKind` and a `LiveSubject`; `outbox.record(tx, event)` writes the row with `audienceOf(subject)` (FR-001); bound in `auth.module.ts` instead of `noEvents`; `accounts.service.ts` and `sign-in.service.ts` name the account as the subject (FR-011)
- [X] T004 [US1] `libs/domain/src/events/outbox-relay.ts` (new): batches of 100 by ascending id with `FOR UPDATE SKIP LOCKED`, publish to `live:events`, consumer jobs, `relayed_at` (FR-002, FR-003, FR-004, FR-005); 7-day clean-up and 30-second lag log (FR-007); a 200 ms poll loop
- [X] T005 [US1] `libs/domain/src/events/outbox-relay.module.ts` (new) and `apps/worker/src/main.ts`: the worker runs the relay; `apps/web-e2e/playwright.config.mts` starts the worker
- [X] T006 [US1] `libs/domain/src/events/live.controller.ts`: the admin test update records `live.test` through the outbox (FR-010); `LiveHub.publish` and the API's live publisher go, since nothing in the API publishes events itself any more; the live integration suites run the relay beside the API

## Phase 3: User Story 3 — screens react (P2)

- [X] T007 [US3] `apps/web/src/app/dashboard/live.ts`: `on(kinds, { id })` (FR-008) and `liveResource(load, kinds, id)` with a 300 ms collapse (FR-009); the frame keeps reading `events`, because it also acts on kinds published straight to Redis (`session.revoked`, `account.email_confirmed`)

## FR → test

| FR | Tests |
| --- | --- |
| FR-001 | `outbox-relay.integration.spec.ts` "commits the change and its event together", "leaves no event when the transaction rolls back" |
| FR-002 | `outbox-relay.integration.spec.ts` "publishes a committed event with its audience and marks it relayed" |
| FR-003 | `outbox-relay.integration.spec.ts` "keeps the events while Redis is down and publishes them in order when it is back", "publishes again an event whose relayed mark was not saved" |
| FR-004 | `outbox-relay.integration.spec.ts` "relays each row once with two relays polling" |
| FR-005 | `outbox-relay.integration.spec.ts` "adds one job per registered consumer, named by the event id" |
| FR-006 | `libs/contracts/src/events.spec.ts` (typecheck of the unknown kind; the story's kinds) |
| FR-007 | `outbox-relay.integration.spec.ts` "deletes relayed rows older than 7 days", "logs an error when the outbox lags more than 30 seconds" |
| FR-008 | `apps/web/src/app/dashboard/live.spec.ts` "gives a view only the kinds and the object it asked for" |
| FR-009 | `apps/web/src/app/dashboard/live.spec.ts` "re-reads once for the events of 300 ms" |
| FR-010 | `live.api.integration.spec.ts` test-update cases; `apps/web-e2e/src/live.spec.ts` |
| FR-011 | `outbox-relay.integration.spec.ts` "records sign-up through the outbox" |

# Feature Specification: Give features one way to publish and receive live events

**Feature Branch**: `257-live-events`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-257 Give features one way to publish and receive live events (Notion story https://app.notion.com/p/3ee607bff0d281a3a201dcc26213ceac, epic EP-1 Foundations)."

**Sources**: Notion story ST-257 (https://app.notion.com/p/3ee607bff0d281a3a201dcc26213ceac), read 2026-10-05 (last edited 2026-10-05 02:41); its Build brief wins over the criteria above it. Feature MF-52 "Live updates between screens" (https://app.notion.com/p/3ee607bff0d281de9544d2b4e8331043), Build brief final rules 2, 3 and 7, States ("OUTBOX_EVENT: created_at … relayed_at … deleted after 7 days"). Backend architecture (https://app.notion.com/p/3ee607bff0d281dfa162cd4b9983dd2e), sections Events, Events added for the decisions of 3 October 2026, Live channels and Queues (the `outbox-relay` queue). Foundations timeline row ST-257: "Creates OUTBOX_EVENT and the relay; also wires the relay into ST-194's notifications queue (cycle cut). Every later epic publishes through this." Blockers, all Merged: ST-253 (PR #57), ST-254 (PR #75), ST-194 (PR #59), ST-390.

## Clarifications

### Session 2026-10-05

- Q: Who works out an event's audience: the use case or the relay? → A: The use case names the event's subject (the `LiveSubject` of ST-254) when it records the event, and the recorder stores `audienceOf(subject)` in the row's `audience` column; the relay publishes the stored audience. The use case already holds the parties in its transaction, and the brief's Data section lists `audience` as a stored column.
- Q: What is the `id` of the live message, the outbox row or the object? → A: The object: the row's `subject_id`. The screen re-reads that object (feature rule 3); ST-254's hub already reads `id` as the account or object (`member.removed`, `account.suspended`). The row's own id is the event id consumers deduplicate on. The admin test update keeps a fresh id per call, as in ST-253: it is about nothing a screen re-reads, and the stream must not carry the target's account id.
- Q: Which kinds have another consumer today? → A: None. The notifications queue's entry point takes recipients already resolved (ST-194 cycle cut), and no EP-1 kind sends a message yet; the first story whose kind sends one registers the notifications consumer for that kind. This story builds the registry and proves it with a registered test consumer. (autonomous default)
- Q: Does the admin test update still answer 503 when Redis is down? → A: No. It records `live.test` through the outbox in one transaction and answers 202; with Redis down the event waits in the outbox and is shown when Redis returns (story scenarios 4 and 10). This modifies 253-FR-012.
- Q: Where does the relay run? → A: In the worker (Backend architecture, Queues: `outbox-relay`). The end-to-end suite therefore starts the worker beside the API and the web app.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A change and its event are saved together and reach open screens (Priority: P1)

A use case records its event inside its own transaction. The worker's relay reads committed events in order, publishes each to the live channel with its audience, and marks it relayed. Nothing is lost while Redis is down; an event relayed twice is harmless.

**Why this priority**: it is the story: every later epic publishes through it.

**Independent Test**: record an event in a transaction that commits and one that rolls back; run the relay; read Redis and the rows.

**Acceptance Scenarios**:

1. **Given** a use case saves a change, **When** it records `quote.sent` in the same transaction, **Then** the change and the OUTBOX_EVENT row commit together.
2. **Given** that transaction rolls back, **When** the relay runs, **Then** no event exists and nothing is sent.
3. **Given** a committed event, **When** the relay picks it up, **Then** it is published to Redis `live:events` with its audience, `relayed_at` is set, and the open screens in the audience get it within 2 seconds of the commit.
4. **Given** Redis is down, **When** it comes back, **Then** the waiting events are published in the order they were created, and none is lost.
5. **Given** the relay publishes and then fails before setting `relayed_at`, **When** it runs again, **Then** it publishes that event again.
6. **Given** two relays run, **When** both poll, **Then** each row is relayed once.
7. **Given** a kind has a consumer registered, **When** it is relayed, **Then** that consumer gets one job, named by the event id.
8. **Given** an admin sends the test update, **When** it is relayed, **Then** the toast shows on the target dashboard.

---

### User Story 2 - Event kinds are one typed catalogue (Priority: P1)

Every kind in the Backend architecture events list is named in one catalogue shared by the API and the web app. Code that names a kind outside it does not compile.

**Why this priority**: later epics depend on the names, and a typo must fail the build, not a screen.

**Independent Test**: a type test with an unknown kind; the catalogue holds every kind of the brief's table.

**Acceptance Scenarios**:

1. **Given** a developer types an event kind that is not in the catalogue, **When** the code compiles, **Then** it fails.
2. **Given** the kinds the story names (request created; quote sent, accepted, closed; booking moved; job status changed, step ticked, paused; photo or clip added; stream started or stopped; verification decided; review reported or decided), **When** the catalogue is read, **Then** each is there.

---

### User Story 3 - A screen reacts to the events of the objects it shows (Priority: P2)

A view asks the shared live service for the kinds it cares about, for the object it shows, and re-reads that object through the API when one arrives. Several events close together cause one re-read.

**Why this priority**: the screens that use it come with later epics; this story gives them the call.

**Independent Test**: unit tests of the live service and the re-reading helper with a fake stream.

**Acceptance Scenarios**:

1. **Given** a view showing request 123 subscribes to `quote.sent`, **When** `quote.sent` arrives for request 456, **Then** the view does nothing; for request 123 it re-reads the request through the API.
2. **Given** three matching events arrive within 300 ms, **When** they are handled, **Then** the view re-reads once.

### Edge Cases

- The outbox lags more than 30 seconds (Redis down, relay stopped): an error is logged, at most once every 30 seconds.
- Relayed rows older than 7 days are deleted by the relay.
- A consumer that keeps failing is retried by its own queue; the relay never waits on one consumer's work, only on handing it the job.
- A recorded event whose audience is empty is still stored and relayed; every API copy drops it (254-FR-002).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The backend MUST offer one call that records an event (kind, subject id, payload, subject) inside the caller's transaction, writing one OUTBOX_EVENT row with the audience worked out from the subject (254-FR-001), so the change and its event commit or roll back together.
- **FR-002**: The worker's relay MUST read unrelayed OUTBOX_EVENT rows in ascending id order, publish each to Redis `live:events` as `{ event: { kind, id: subject id, at: created at }, audience }`, and set `relayed_at`, polling every 200 ms.
- **FR-003**: When publishing fails, the relay MUST leave the rows unrelayed and retry them, oldest first, on the next poll; a row whose `relayed_at` was not saved MUST be published again (at least once).
- **FR-004**: Two relays polling at once MUST each relay a different row set (`FOR UPDATE SKIP LOCKED`), so each row is relayed once.
- **FR-005**: For each relayed event whose kind has registered consumers, the relay MUST add one job per consumer to that consumer's queue, with the job id derived from the event id, so a second relay of the same event adds no second job.
- **FR-006**: Every event kind of the Backend architecture events list, plus `account.signed_out_everywhere` and `live.test`, MUST be named in one typed catalogue in the shared contracts library; recording or subscribing to a kind outside it MUST fail to compile.
- **FR-007**: The relay MUST delete relayed rows older than 7 days, and MUST log an error when the oldest waiting row is older than 30 seconds, at most once every 30 seconds.
- **FR-008**: The web app's live service MUST let a view subscribe to a list of kinds, optionally for one object id, and receive only the matching events.
- **FR-009**: The web app MUST offer a helper that loads a view's data through the API and re-reads it when a matching event arrives, collapsing the events of 300 ms into one re-read.
- **FR-010**: `POST /api/v1/admin/live/test` with an account id MUST record a `live.test` event for that account through the outbox in one transaction and answer 202 for a MotorFix admin; a call with no valid token MUST get 401, a signed-in non-admin 404, and an unknown account 404. The account's open dashboards MUST show the test toast within 2 seconds while the worker runs.
- **FR-011**: Account sign-up (`account.created`) and sign-out everywhere (`account.signed_out_everywhere`) MUST record their events through the outbox, with the account as their subject.

### Key Entities

- **OUTBOX_EVENT**: id (ascending), kind, subject_id, payload (ids and small facts, never personal data), audience (channel keys), created_at, relayed_at.
- **Event consumer**: a queue that gets a job for each relayed event of the kinds it registered.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the end-to-end test, the test update sent by an admin through the outbox shows on the driver's and the garage's dashboards within 2 seconds.
- **SC-002**: With Redis stopped, events recorded meanwhile are all published, in creation order, once it is back (integration test).
- **SC-003**: An unknown kind fails `npm run typecheck`.

## Spec Delta

### Capability: `live-updates`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-011
- **Modifies**: 253-FR-012 → FR-010
- **Removes**: none

## Assumptions

- (autonomous default) Level 1: one backend unit in `libs/domain/src/events` with its worker wiring and a small web service addition; no plan, checklist or analyze phase, as ST-254 (`node .claude/scripts/level.mjs`).
- (autonomous default) Polling every 200 ms rather than LISTEN/NOTIFY: the brief offers both as *proposed*; polling needs no extra connection and meets the 2-second target.
- (autonomous default) A batch is at most 100 rows and runs in one transaction; a failure part-way publishes the earlier rows again on the next poll, which FR-003 allows.
- (autonomous default) Two relays keep creation order within each batch only; across relays order is not promised (the brief marks two relays and `SKIP LOCKED` as *proposed*, and screens re-read).
- (autonomous default) The kinds the feature page adds (`quote.declined_by_driver`, `booking.move_lapsed`, `booking.move_refused`, `job.final_price_corrected`) are in the Backend architecture table already; the job kinds the story calls "status changed, step ticked, paused" are `job.started`, `job.done`, `job.step_done` and `job.paused` there.
- (autonomous default) Kinds published straight to Redis (`session.revoked`, `job.lock_changed`, verification presence, `notification.created`) and the stream's own `hello` and `bye` are not outbox kinds and stay out of the catalogue.

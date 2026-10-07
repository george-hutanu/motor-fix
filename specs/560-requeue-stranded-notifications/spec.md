# Feature Specification: A queued notification with no job is re-queued

**Feature Branch**: `560-requeue-stranded-notifications`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-560 (tech debt from ST-392, code-reviewer, PR #73): "`libs/domain/src/notifications/notifications.service.ts` `fallBack` (and `notify`, pre-existing) writes a `queued` row and then adds its job; if Redis refuses the add, the row stays `queued` with no job and nothing re-queues it. A sweeper that re-adds `send-<id>` for stale `queued` rows (idempotent by job id) would close it for every channel." — https://app.notion.com/p/3f0607bff0d281c1b564c357379131d1. Sources: the Notion task (no comments on it), `notifications.service.ts`, `notifications.processor.ts`, `scheduler/timers.ts`, the `notifications` capability (522-FR-001..003, 561-FR-001..004).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A message whose job was lost still reaches the person (Priority: P1)

The app records a message to send (an e-mail, a push, an SMS or a WhatsApp message, written directly or as the fallback of a failed one) and then hands it to the queue. The queue refuses the hand-off (Redis down, a dropped connection). Today the message sits as `queued` forever and the person never gets it. With this change the worker notices such a message within minutes and hands it to the queue again, on every channel, and the message goes out as if the first hand-off had worked.

**Why this priority**: It is the finding itself: a silent, permanent loss of a message the system promised to send.

**Independent Test**: Write a `queued` row older than the stale window with no job in the queue, run the sweep, and see the row's send job appear in the queue and the row sent.

**Acceptance Scenarios**:

1. **Given** a `queued` row older than the stale window with no send job in the queue, **When** the sweep runs, **Then** the row's send job is added under its usual id (`send-<id>`) and the processor sends it.
2. **Given** a `queued` row whose send job is still in the queue (waiting, delayed for a retry, or being processed), **When** the sweep runs, **Then** nothing changes: the add is ignored because the id already exists, and the row is not sent twice.
3. **Given** a `queued` row younger than the stale window, **When** the sweep runs, **Then** it is left alone.
4. **Given** rows on every channel (e-mail, push, SMS, WhatsApp) stranded the same way, **When** the sweep runs, **Then** each one is re-queued; the channel makes no difference.

---

### User Story 2 - A message the provider already took is never sent twice (Priority: P1)

A send can reach the provider and then fail to record that it went (522-FR-001/002), or an SMS can be marked as being sent and never get its answer (561-FR-001..003). Such a row still reads `queued`, yet the message may have gone. The sweep must tell these rows from stranded ones and leave them alone: a lost message is a defect, a duplicate message is a worse one.

**Why this priority**: The fix for the lost message must not create the duplicate the earlier stories (ST-522, ST-561) worked to prevent.

**Independent Test**: Write a `queued` row older than the window that carries a send claim (or an SMS sending mark), run the sweep, and see no job added.

**Acceptance Scenarios**:

1. **Given** a `queued` row older than the window whose send claim is still set (the job holding it is alive, or died, or sent the message and could not record it), **When** the sweep runs, **Then** no job is added for it, whether the claim is live or lapsed.
2. **Given** a `queued` SMS row older than the window that carries the "being sent" mark (561-FR-001), **When** the sweep runs, **Then** no job is added for it.
3. **Given** the provider accepts a message and every write recording the send fails (522-FR-002), **When** the job resolves, **Then** the row keeps its send claim, so a later sweep sees a row that was handed to the provider and never re-queues it.

---

### User Story 3 - Held rows and groups are untouched (Priority: P2)

A `held` row (quiet hours, a grouping window) has its own delayed job and its own rules; a group's flush job is not a send job. The sweep only concerns `queued` rows and only adds send jobs.

**Why this priority**: Bounds the change to the finding; held rows and flushes are not stranded by the same path in the finding and are out of scope.

**Independent Test**: Write a `held` row and a group leader older than the window, run the sweep, and see no job added for either.

**Acceptance Scenarios**:

1. **Given** a `held` row older than the window with no job, **When** the sweep runs, **Then** it is left alone.
2. **Given** a `sent` or `failed` row, **When** the sweep runs, **Then** it is left alone.

---

### Edge Cases

- The queue is still down when the sweep runs: the add fails, the sweep logs it and ends; the next sweep tries again. A failed add never fails or marks the row.
- Two worker instances sweep at once: both add the same job id; one add is ignored, and the processor's claim (ST-522) guards the send anyway.
- A row stranded by `release` (a `held` row that became `queued` at 08:00 and whose flush or send add failed): it is a `queued` row like any other and is re-queued; its age is counted from when it was created, so it is picked up on the first sweep after release.
- The sweep's own job cannot be scheduled (Redis down at worker start): the worker still starts and serves its queue; the schedule is upserted on every start, so the next start restores it.
- A row for a deleted account is re-queued like any other; the processor fails it (`account_deleted`) when it claims it, as it does today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The worker MUST run a periodic sweep that, for every stale `queued` notification row, adds its send job under the row's usual job id (`send-<id>`, no delay), on every channel.
- **FR-002**: A row is stale when it has been `queued` for longer than the stale window (5 minutes, see Assumptions), measured from its creation time.
- **FR-003**: The sweep MUST be idempotent: adding a job whose id already exists in the queue (waiting, delayed, active or kept failed) MUST change nothing, so a row whose job is alive is never sent twice.
- **FR-004**: The sweep MUST NOT add a job for a `queued` row that carries a send claim, whether the claim is live or lapsed: such a row was handed to a send job and the system cannot know whether the provider took the message.
- **FR-005**: The sweep MUST NOT add a job for a `queued` SMS row that carries the "being sent" mark (561-FR-001).
- **FR-006**: When the provider has accepted a message and every write recording the send has failed (522-FR-002), the processor MUST keep the row's send claim rather than release it, so FR-004 shields the row from the sweep. A release that fails for other reasons keeps 522-FR-003 as it is.
- **FR-007**: The sweep MUST touch only `queued` rows: `held`, `sent` and `failed` rows and group flush jobs are outside it.
- **FR-008**: A sweep whose add fails MUST log the failure and end without changing the row; the next sweep tries again.
- **FR-009**: The sweep MUST log how many rows it re-queued whenever that number is not zero, naming the rows, so an operator sees that a hand-off failed.
- **FR-010**: The change MUST add no API route, contract, schema migration or UI.

### Key Entities

- **Notification row**: one message to one person on one channel; `queued` means it is waiting for its send job; a **send claim** (`claimedAt`) says a send job holds or held it; the **SMS sending mark** (`sendingAt`) says the provider was called for it.
- **Send job**: the queue's entry for one row, id `send-<row id>`; the queue keeps one entry per id.
- **Sweep**: the worker's periodic pass over stale `queued` rows.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001 .. FR-010
- **Modifies**: none (FR-006 narrows when the claim of 522-FR-003 is released: not after a send that could not be recorded)
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A `queued` row with no job is sent within one sweep interval plus the window (10 minutes at the defaults) instead of never.
- **SC-002**: Across the integration tests for the sweep, a row whose job exists, a row with a claim, an SMS row with the sending mark, a `held` row and a `sent` row receive zero added jobs.
- **SC-003**: The existing notifications, phone and push processor suites pass unchanged apart from the claim kept after an unrecorded send (FR-006).
- **SC-004**: No new table, column, route, contract or screen (`git diff --stat` touches `libs/domain/src/notifications/**` and the worker wiring only).

## Assumptions

- Stale window: 5 minutes, measured from `createdAt`; sweep every 5 minutes, as the scheduler's timer sweep (`scheduler/timers.ts`, `SWEEP_EVERY`) already does, on the notifications queue through a BullMQ job scheduler in the worker only. A row's first job is added with no delay, so any `queued` row older than that with no claim either has a job (the add is a no-op) or lost it. *(autonomous default)*
- A row with a claim, live or lapsed, is never re-queued, even when its claim came from a worker that died before calling the provider: that case still has its job (the queue retries a stalled job), and when it has none, not sending beats sending twice; the operator finds it by the processor's "sent but not recorded" log line or by the row's claim. *(autonomous default)*
- An SMS row with the sending mark is not re-queued either, though the processor would only fail it (`sms_unconfirmed`) and fall back: the fallback is a second message with the same content, and the finding asks that nothing sent goes twice. *(autonomous default)*
- `held` rows are out of scope by the task's text; their delayed job can be lost the same way, and that gap, if wanted, is its own task. *(autonomous default)*
- The sweep's upsert of its own schedule runs at worker start; a failed upsert is logged and does not stop the worker. *(autonomous default)*
- No cap on rows per pass: a stranded backlog is the outage's size, and each add is one queue call. *(autonomous default)*

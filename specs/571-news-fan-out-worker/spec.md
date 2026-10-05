# Feature Specification: Move the news fan-out to a worker job

**Feature Branch**: `571-news-fan-out-worker`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-571 — https://app.notion.com/p/3f0607bff0d28174bc4bc680309bc8c1
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: tech debt found by code-reviewer on ST-201 (PR #76): `NewsService.send` loops over the consenting drivers inside the admin's request, which holds the request open for the whole list and, when the loop fails part-way, gives the month back for a manual retry.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An admin's news send goes out on its own, and resumes by itself (Priority: P1)

An admin sends the month's news. Today the request writes one message per
consenting driver before it answers, and a failure part-way gives the month
back so the admin has to send again. After this change the request claims the
month, queues one job and answers at once; the worker writes the messages, and
a run that fails is tried again by the queue, reaching each driver once.

**Independent Test**: post a send; the answer is 202 with the count and no news
message exists yet; run the queued job; each consenting driver has one message.

**Acceptance Scenarios**:

1. **Given** consenting drivers, **When** an admin sends news, **Then** the answer is 202 with how many drivers consent, no news message is written in the request, and one job for the month is queued holding the title, the text and the sender.
2. **Given** the month's job, **When** the worker runs it, **Then** each consenting driver gets one message in their own language with their own unsubscribe links, as before.
3. **Given** a run that fails part-way, **When** the queue runs it again, **Then** each driver has exactly one message and the month stays claimed.
4. **Given** a run that fails on its last attempt, **When** the queue gives up, **Then** the month is given back, the release is recorded against the sender, and the admin can send again.
5. **Given** the job cannot be queued, **When** the admin sends, **Then** the month is given back and the answer is an error.
6. **Given** a worker started without the token secret, **When** a news job is queued, **Then** it stays queued (an error is logged at start) and the worker's other queues run as before.

### Edge Cases

- A driver who withdraws between the send and the run gets nothing: the run reads the consenting drivers when it runs. The answer's count is the count at the send.
- A run at night: the messages are held until 08:00 in Bucharest, as before (the pipeline decides).
- Two sends at once: the month's claim still lets only one through, so only one job is queued.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sending news MUST claim the month, queue one job for that month carrying the title, the text and the sender, and answer 202 with the number of consenting drivers, writing no news message in the request.
- **FR-002**: The worker MUST run the month's job by writing one news message per consenting driver, in the driver's language, with the driver's unsubscribe links.
- **FR-003**: A run that fails MUST be retried by the queue; a retry MUST reach each driver once and MUST keep the month claimed.
- **FR-004**: A run that fails on its last attempt MUST give the month back and record the release against the sender.
- **FR-005**: When the job cannot be queued, the send MUST give the month back and fail.
- **FR-006**: The worker MUST run news jobs only when it has the token secret the unsubscribe links are signed with and the public web address the links point to; without either, it MUST log an error at start and leave the jobs queued.

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: The admin's send answers without writing a message per driver; the drivers' messages are written by the worker's job.
- **SC-002**: A run that fails part-way finishes on a retry with no driver reached twice and no action by the admin.

## Assumptions

- (autonomous default) A queue of its own, `news`, consumed in the worker by its own BullMQ worker, rather than a job on the notifications queue: the notifications processor is left untouched (PR #127 changes it) and a news run is a different shape of work from one message's send. Evidence: `libs/domain/src/cars/reminders.module.ts` runs its daily job on a queue of its own the same way.
- (autonomous default) Retries: 6 attempts, exponential from one minute (1, 2, 4, 8, 16 minutes), as the reminders run does with 4. A retry is safe because the pipeline writes one message per event and person (`eventId news:<month>`).
- (autonomous default) The job id is `news-<month>`, so the month's claim and the queue agree on one job per month; a finished or failed job is removed, so a month given back can be sent again.
- (autonomous default) The content travels in the job's data (Redis), not in a new column: no migration, and the job lives only until it has run.
- (autonomous default) The worker reads `AUTH_TOKEN_SECRET` as optional. It is not set on the worker today, and making it required would stop the worker, and every notification with it, on a deploy without it. Without it the news queue waits and an error says why; setting it on the worker service is an operations step named in the PR.
- (autonomous default) The answer's count is taken at the send; the run reads the list again, so a driver who withdrew in between is not sent to. The count recorded on the month's claim stays the count at the send.

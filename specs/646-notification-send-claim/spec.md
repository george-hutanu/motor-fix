# Feature Specification: Send a queued notification once when two send jobs run at once

**Feature Branch**: `646-notification-send-claim`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-646 — https://app.notion.com/p/3f0607bff0d2817da2d9fb5babd9f5cd
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: tech debt deferred by test-adversary on ST-555 (PR #127), `specs/555-account-link-params/deferred.md`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A notification is sent once, whatever jobs run for it (Priority: P1)

The worker sends each queued (or held) notification row from a `send` job. Two
`send` jobs for the same row that run at the same time (a duplicate job, or a
stalled job re-run while the first still runs) both read the row as queued and
both call Brevo: the person gets the message twice — for an account e-mail, the
password-reset or confirmation link twice. After this change a job first claims
the row; only the job holding the claim sends it. A claim lapses after a lease,
so a worker that dies holding one cannot keep the row from being sent.

**Independent Test**: queue an account e-mail, run two send jobs for its row at
once against the Brevo mock: Brevo is called once and the row is sent.

**Acceptance Scenarios**:

1. **Given** a queued account e-mail, **When** two send jobs for its row run at once, **Then** Brevo receives one e-mail and the row is `sent`.
2. **Given** a held row reaching its send time, **When** two send jobs for it run at once, **Then** Brevo receives one e-mail.
3. **Given** a queued row another job has claimed within the lease, **When** a send job runs for it, **Then** the job calls nobody, leaves the row queued and fails, so the queue retries it later.
4. **Given** a queued row whose claim is older than the lease (its worker died), **When** a send job runs for it, **Then** the job takes the claim and sends it once.
5. **Given** Brevo refuses a send with a retryable error, **When** the job fails for a retry, **Then** the claim is released, so the next attempt sends the row at once.
6. **Given** a held row that a send job groups behind an earlier one (not sent now), **When** the job ends, **Then** the row holds no claim.

### Edge Cases

- A row already `sent` or `failed`: no claim is taken, nothing is sent, the job succeeds (unchanged).
- A row that does not exist: the job succeeds and sends nothing (unchanged).
- An unexpected error after the claim (database, a non-Brevo error): the claim is released before the error reaches the queue.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Before it reads a row to send, a send job MUST claim it with one conditional update that succeeds only for a `queued` or `held` row holding no claim, or a claim older than the lease; only the job whose update changed the row may send it.
- **FR-002**: A send job that cannot claim a row still `queued` or `held` MUST NOT call Brevo and MUST fail, so the queue retries it after its backoff; a job that finds the row `sent`, `failed` or gone MUST succeed without sending.
- **FR-003**: A claim MUST lapse after a lease no longer than the queue's first retry delay (1 minute), so a retry of a job whose worker died after claiming takes the row over and sends it.
- **FR-004**: When a send job ends — sent, failed, held back, retried or thrown — it MUST release its own claim (and only its own).

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: Two concurrent send jobs for one row call Brevo at most once, for a queued and for a held row.
- **SC-002**: A row whose claim outlived its worker is sent by the next job after the lease, once.
- **SC-003**: Every existing notifications processor scenario still passes.

## Assumptions

- (autonomous default) The claim is a nullable `claimed_at` timestamp on `notification`, not a new `sending` status: a status value would reach every query, the bell and the API that read `status`, while a row being sent is still queued to everyone else (Principle I). Evidence: `libs/domain/prisma/schema/notifications.prisma` `NotificationStatus`; `notifications.service.ts` filters on `queued`/`held`.
- (autonomous default) The lease is the first retry delay, `RETRY_MINUTES[0]` (1 minute): far above one job's run (Brevo's 10 s timeout, `brevo.ts`), and short enough that the first retry of a stranded row finds the claim lapsed.
- (autonomous default) A job that loses the claim on a row still queued fails rather than succeeding: succeeding would drop the only job a crashed claim leaves behind. The cost is one failed attempt, logged by BullMQ, in the rare duplicate case.
- (autonomous default) Grouped `flush` jobs are out of scope: they send rows the send job never sends (`groupLeaderId` set) and run once per leader (`jobId: flush-<leader>`). A concurrent-flush race, if any, is a separate finding.
- (autonomous default) The claim is released by matching the timestamp this job wrote; two claims cannot hold the same row at once, so the timestamp identifies the holder.

# Feature Specification: Answer a password-reset request before issuing the link

**Feature Branch**: `568-reset-answer-first`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-568 — https://app.notion.com/p/3f0607bff0d281d5bf39d6e6f897df24
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: tech debt deferred by the code review of ST-127 (PR #72), `specs/127-password-reset/deferred.md`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nobody learns from the answer time whether an address has an account (Priority: P1)

Someone asks for a reset link on "Ai uitat parola?". Today the API looks the
address up, writes the token and queues the e-mail before it answers 202, but
only for an address that has an active account; for any other address it
answers straight away. The body is already the same, so the only thing left
that tells the two apart is how long the answer takes. After this change the
API answers 202 as soon as the request is admitted, whatever the address, and
issues the link afterwards.

**Independent Test**: hold the link issuing open (the lookup or the e-mail
queue does not return) and check that the 202 still arrives; then let it go
and check that the token and the e-mail are written.

**Acceptance Scenarios**:

1. **Given** an active account, **When** its e-mail asks for a reset and queueing the e-mail does not return, **Then** the request still answers 202 with no body.
2. **Given** an active account, **When** its e-mail asks for a reset, **Then** after the 202 the token is stored and `ACCOUNT_EMAIL` with purpose `password_reset` is queued, exactly as ST-127 FR-002 says.
3. **Given** the e-mail cannot be queued, **When** the link is issued after the 202, **Then** the failure is logged without the address, as before.
4. **Given** the API is shutting down while a link is being issued, **When** the application closes, **Then** it waits for the issuing to finish before it disconnects, so an admitted request is not lost half-written.

### Edge Cases

- An address over its request limit: the limit check stays before the 202 (it runs for every address alike, so it reveals nothing) and nothing is issued.
- An unknown, suspended or deleted account: still nothing stored or queued (ST-127 FR-002), now decided after the 202.
- A link issuing that throws after the 202 is caught and logged; it never reaches the process as an unhandled rejection.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /api/v1/auth/password-reset` MUST answer 202 once the request limits have admitted or refused it, without waiting for the account lookup, the token write or the e-mail queue, for every well-formed address (modifies 127-FR-001).
- **FR-002**: The account lookup, token write and e-mail queue of 127-FR-002 MUST run after the answer, with the same effects; a failure among them MUST be logged without the address and MUST NOT surface as an unhandled rejection.
- **FR-003**: On application shutdown the API MUST wait for every link still being issued to settle before its connections close.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003
- **Modifies**: 127-FR-001 (its answer no longer waits on the issuing); `accounts.md` does not hold ST-127's requirements yet (ST-127 is not archived), so its archive takes this wording.
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: With the link issuing held open indefinitely, a request for an active account's address still gets its 202 (the test holds it open and expects the answer).
- **SC-002**: Every ST-127 request scenario (link in the account language, case and spaces, unknown address, suspended and deleted accounts, one live link, request limits, Redis keys, failed queue) still passes once the issuing has settled.

## Assumptions

- (autonomous default) The issuing runs in the same process after the answer rather than as a queued job: the story's brief says "answer 202 first and issue the link after (the issue step never throws)"; a job queue would add a worker hop for one lookup and one insert (Principle I).
- (autonomous default) The request-limit check stays before the 202: it is one Redis round trip made for every address alike, so it does not tell addresses apart, and keeping it first keeps a refused request from doing any work.
- (autonomous default) Shutdown waits for in-flight issuing (FR-003) without a timeout of its own: each issuing is one lookup, one transaction and one queue write, bounded by their clients' own timeouts.
- (autonomous default) No screen changes; the web app already shows the same neutral line whatever the answer.

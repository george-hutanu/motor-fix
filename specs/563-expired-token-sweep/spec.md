# Feature Specification: Refuse an expired token on every gated route

**Feature Branch**: `563-expired-token-sweep`
**Created**: 2026-10-06
**Status**: Draft
**Level**: 2 (feature)
**Notion task**: ST-563 — https://app.notion.com/3f0607bff0d2811b8c7bc0729cbd6d73
**Epic**: EP-1 Foundations — https://app.notion.com/3ee607bff0d281188cb4c6724bd45707

**Input**: User description: "ST-563 Test an expired token in the public-route sweep (EP-1 Foundations). Task text: So that every gated route is proved to refuse an expired session, we need the route sweep to call each route with an expired access token too."

Sources: the task text above, the Notion task page (read 2026-10-06, no
comments on it), the constitution card and this repository. The page records
the task as tech debt from ST-130 (PR #64) and states its own done-when: *the
sweep calls every route with an expired token and expects 401
`sign_in_required` on every gated route*. It notes the expired case is tested
today on one route only, in the guard's adversary spec.

## Why

The API's route sweep already proves that every route outside the public
list refuses a request that carries no credential, a malformed one, one
signed with another key or one of another scheme. It does not yet prove the
case a real user hits most often: a session that was valid and has since
run out. A route that honoured an expired session would let a signed-out or
timed-out user keep acting, and nothing today would notice. This task closes
that gap in the proof, with no change to the product itself.

## Clarifications

### Session 2026-10-06

- Q: Which call proves the expired token's account and signing are otherwise good, and what status counts? → A: One `GET /api/v1/me` with an unexpired token for the same account, expecting 200 (`libs/domain/src/auth/me.controller.ts:14,21`); no per-route expectations (Constitution I).
- Q: Is the expired case a row in the existing credential table or its own test? → A: Its own test, using the same guard-refusal check as the no-credential case (401, `sign_in_required`, no `set-cookie`); the existing table rows stay as they are.
- Q: How does the sweep avoid a parallel suite emptying its account? → A: It takes `databaseTurn` from `@motor-fix/domain/testing` for the file, as `apps/api/src/sign-up-confirmation.integration.spec.ts:23` does; no new mechanism.
- Q: Must the token's role be one the account holds? → A: Yes: `driver`, on an account created with `roles: ['driver']` (the guard refuses a role the account lacks, `actor.guard.ts` `roleInUse`).
- Q: Does the expired case cover all N routes or N minus the public list? → A: The same route list skipping the public list, as the malformed-token cases do; no count comparison.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every gated route refuses an expired session (Priority: P1)

A driver, garage or admin whose session has run out calls any route that
needs a session. The API refuses the call exactly as it refuses a call with
no session at all: the same status and the same reason, so the web app shows
the sign-in dialog and retries once signed in, as it does today for a
missing session.

**Why this priority**: it is the whole task. An expired session that is still
honoured on even one route is a security defect that no present test would
catch.

**Independent Test**: run the API test suite; the sweep calls every route
listed in the API description with an expired but otherwise genuine session
and fails if any route outside the public list answers with anything but the
sign-in-required refusal.

**Acceptance Scenarios**:

1. **Given** a real, active account and an access token issued for it that
   expired before the call, **When** every route outside the public list is
   called with that token, **Then** each one answers 401 with the code
   `sign_in_required`, and none sets a cookie.
2. **Given** the same account and a token for it that has not expired,
   **When** it is presented to `GET /api/v1/me`, **Then** it answers 200
   (the sweep proves the expired token was refused for its expiry, not because
   the account or the signature were wrong).
3. **Given** a route on the public list, **When** it is called with the
   expired token, **Then** the sweep does not require a refusal from it: a
   public route is open to visitors and an expired token is just a visitor.

---

### User Story 2 - The proof stays honest as routes are added (Priority: P2)

An engineer adds a new gated route. Without touching the sweep, the next test
run covers the new route with the expired token too, and a route that forgot
its guard fails the suite.

**Why this priority**: the sweep's value is that it is exhaustive by
construction; the expired-token case must be too, or it decays the moment the
route list grows.

**Independent Test**: the expired-token case iterates the same route list the
existing cases do (read from the API description at test time), so no route
can be left out by omission.

**Acceptance Scenarios**:

1. **Given** the API description lists N routes, **When** the sweep runs,
   **Then** the expired-token case has exercised every one of those routes
   that is not on the public list (the same list, skipping the public ones).

---

### Edge Cases

- A token that expired one second ago is refused: expiry is a strict
  boundary, and the sweep uses a token clearly past it (issued well in the
  past), not one on the edge of the clock.
- An expired token for an account that does not exist is refused too, but
  that refusal proves nothing about expiry; the sweep therefore mints the
  token for an account it created, so expiry is the only thing wrong with it.
- The sign-in renewal route also answers `sign_in_required` on its own terms
  (and clears the cookie); it is on the public list and is not required to
  behave as a guarded route.
- The sweep writes an account, so it must take its turn on the shared test
  database like the other API tests that write accounts, so a parallel suite
  emptying the account tables cannot make the test flake.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The route sweep MUST call every route outside the public list
  with an access token that is genuine in every respect (signed with the
  application's secret, for an existing active account, with a valid role)
  except that its expiry is in the past; its role is `driver`, a role the
  account holds.
- **FR-002**: For every such route the sweep MUST require the same refusal as
  for a missing session: status 401, code `sign_in_required`, no cookie set.
- **FR-003**: The expired-token case MUST iterate the same route list as the
  existing cases (derived from the API description at test time), so a new
  gated route is covered without editing the sweep.
- **FR-004**: The sweep MUST show that the account and signing used for the
  expired token are otherwise accepted: an unexpired token for the same
  account gets 200 from `GET /api/v1/me`, so a refusal cannot be mistaken for
  a refusal of an unknown account or a bad signature (scenario 2 of story 1).
- **FR-005**: The account the sweep creates for this purpose MUST be created
  by the test itself and MUST NOT depend on seed data or on another test's
  state; the file takes `databaseTurn` (`@motor-fix/domain/testing`) like
  the other account-writing API tests, so a suite emptying the account tables
  cannot run meanwhile.
- **FR-006**: No product code changes: the task adds to the test suite only.
  A gated route found to honour an expired token is a product defect reported
  by the failing test and fixed as its own bug, not silently patched here.

### Key Entities

- **Access token**: a signed, time-limited proof of a session for one account
  in one role; carries an expiry moment after which it is no longer valid.
- **Public route**: a route open to visitors, listed in the sweep; every
  other route is gated.
- **Test account**: an active account the sweep creates so that a token for
  it is otherwise genuine.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the routes outside the public list refuse an expired
  but otherwise genuine token with 401 `sign_in_required` and no cookie, and
  the suite fails if any one does not.
- **SC-002**: The expired-token case iterates the same route list as the
  existing cases, skipping the public list, on every run (the list comes from
  the API description, not a hand-kept list).
- **SC-003**: The API test suite stays green on CI after the change, and the
  product's behaviour and its API description are unchanged (zero product
  files changed in the diff).
- **SC-004**: The whole sweep file, including the new case, stays as short as
  the smallest change allows: one new test next to the existing credential
  cases, plus the account set-up and database turn it needs (Constitution I).

## Assumptions

- The refusal an expired token must receive is the one the guard already
  gives a missing or malformed credential: 401 `sign_in_required` with no
  cookie. Source: the existing sweep's cases and the guard's single refusal
  path *(autonomous default)*.
- "Otherwise genuine" means signed with the application's token secret, for
  an account the test created and that is active, with a valid role, and an
  expiry well in the past (for example a token issued one day ago with the
  default 15-minute lifetime). The exact age is not significant beyond being
  clearly past expiry *(autonomous default)*.
- The sweep uses the public list it already holds; this task does not add,
  remove or question any public route *(autonomous default)*.
- The task is test-only. If the sweep finds a route that honours an expired
  token, that is filed and fixed as a bug of its own rather than widening this
  task's scope *(autonomous default)*.
- No screens are involved: the change is in the API's test suite, so there
  is nothing to check in the clickable mock *(autonomous default)*.
- The Notion page's done-when and this spec agree; the page carried no
  comments when read. `/speckit-context` re-reads it before `/speckit-clarify`,
  and a later comment that contradicts this spec wins and is recorded in
  Clarifications *(autonomous default)*.
- The one-route expired-token test in the guard's adversary spec stays as it
  is; this task does not move or remove it *(autonomous default)*.
- SC-004's "one new test" is a target drawn from the shape of the existing
  sweep, not a number from a source *(autonomous default)*.

## Spec Delta

- **Adds**: the route sweep proves every gated route refuses an expired but
  otherwise genuine access token with the same `sign_in_required` refusal as
  a missing session.
- **Modifies**: none.
- **Removes**: none.

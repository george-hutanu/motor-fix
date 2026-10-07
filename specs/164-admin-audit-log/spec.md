# Feature Specification: Admin actions in the audit history

**Feature Branch**: `164-admin-audit-log`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "ST-164 Record every admin action with who did it and when. Notion story: https://www.notion.so/3ee607bf-f0d2-81d7-88c1-d0bf4822b656 (EP-2, High)."

**Sources read**: the story ST-164 (page content and Build brief; it has no
comments), the audit writer's story ST-390, the admin dashboard story ST-160,
the epic EP-2 and the feature MF-43 in Notion; the living capability specs
`.specify/capabilities/audit.md` and `garage-verification.md`; the code under
`libs/domain/src/audit`, `libs/domain/src/garages/verification.service.ts`,
`libs/domain/src/events/live.controller.ts`,
`libs/domain/src/notifications/` and `apps/api/src/admin-routes.integration.spec.ts`.

## What already exists, and what this story adds

The audit history is built (ST-390, ST-391): one writer called inside each
change's transaction, an append-only table, the actor with role and first
name, the `via_assistant` mark, a test that fails when a domain service method
writes without the writer, and the read endpoint whose `admin_actions` area
returns the entries an admin made. The verification transitions (ST-207)
already write their entries: the first open, each decision with its reason
and note, each reopening, and the garage's `draft` → `approved` on approval,
all in the transition's transaction, with a test that a failed write leaves
no entry.

What is missing is the story's guarantee over the *admin endpoints*: the
existing coverage test looks at service classes, so an admin route whose
controller writes directly, or whose service method is on the exemption
list, leaves no trace. Today `POST /api/v1/admin/live/test` records a live
update for an account with no audit entry, and
`POST /api/v1/admin/notifications/test` sends a test message with none. This
story adds:

1. a guard test over every `admin/*` route that changes data, read from the
   API's own route list, which fails naming the route when the call leaves
   no entry made by the admin;
2. the entries those two routes are missing;
3. the rule, for every later admin story of this epic (checks, decisions,
   platform rules, the two-admin rule, maintenance mode), that the guard
   test enforces without being edited.

It builds no table, writer, screen or log of its own.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every admin change leaves a trace (Priority: P1)

The MotorFix team needs to know, for every change an admin made through the
admin API, who made it and when, from what to what. A change that could not
be recorded is not made.

**Why this priority**: it is the story's purpose, and the epic's exit check
("every admin decision is in the audit history") rests on it.

**Independent Test**: call every `admin/*` route that changes data as a
seeded admin, then read the audit history: each call left at least one entry
with that admin as its actor, written at the time of the call.

**Acceptance Scenarios**:

1. **Given** an admin signed in, **when** they call `POST /api/v1/admin/live/test`
   for an account, **then** the request commits one audit entry with
   actor_id = the admin, actor_role `admin`, actor_name the admin's first
   name, action `create`, the target account as its subject, and `at` the
   time of the call.
2. **Given** an admin signed in, **when** they call
   `POST /api/v1/admin/notifications/test` for one or more accounts, **then**
   one audit entry records the admin as actor, action `create`, and which
   accounts the test message went to.
3. **Given** an admin signed in, **when** they call `POST /api/v1/admin/news`,
   **then** the entry the news story already writes carries the admin as its
   actor (unchanged; the guard test confirms it).
4. **Given** admin Ana approves a garage's verification file, **when** the
   transaction commits, **then** the history holds one entry on
   `verification_file`, field `status`, `in_review` → `approved`, actor Ana
   as `admin` with her first name, the garage id and the note, and a second
   entry on `garage`, field `status`, `draft` → `approved` (unchanged from
   ST-207; named here because the story's acceptance scenarios list it).
5. **Given** an admin reopens a file, **when** it commits, **then** an entry
   records the reopening (unchanged from ST-207).
6. **Given** the change's database write fails, **when** the transaction
   rolls back, **then** no audit entry remains: the entry and the change
   commit together or not at all.
7. **Given** an admin call is refused (404 for a non-admin, 400 for a bad
   body, 409 for a refused transition), **when** it answers, **then** no entry
   is written.

---

### User Story 2 - A new admin endpoint cannot forget the record (Priority: P2)

A developer adds an admin endpoint that changes data (a platform rule, a
check on a file, maintenance mode) and does not call the writer. The test
suite fails and names the endpoint before the change reaches `main`.

**Why this priority**: the epic adds eight more admin stories after this
one; the rule only holds if it is enforced by a test nobody has to remember.

**Independent Test**: the guard test lists every `admin/*` route with a
changing method from the API's route list, calls each as an admin with a
known-good request, and fails naming `METHOD /path` for each route that left
no entry made by that admin; a route with no known-good request in the
test's table is named the same way.

**Acceptance Scenarios**:

1. **Given** a new `admin/*` route that changes data and writes no entry,
   **when** the test suite runs, **then** the guard test fails and its
   message names the route.
2. **Given** a new `admin/*` route that changes data, **when** no request
   fixture exists for it in the guard test, **then** the test fails naming the
   route, so the fixture is added with the route.
3. **Given** the admin routes in the API today, **when** the guard test runs
   after this story, **then** it names no route.

---

### User Story 3 - Reads leave no trace (Priority: P3)

An admin opening the dashboard's overview is not logged: the history holds
actions, not page views.

**Why this priority**: it keeps the history readable and is the story's own
rule ("Reads are not logged"); it is one assertion in the guard test.

**Independent Test**: call every `admin/*` route whose method is `GET` as an
admin; the number of entries made by that admin does not change.

**Acceptance Scenarios**:

1. **Given** an admin signed in, **when** they read
   `GET /api/v1/admin/overview`, **then** no audit entry is written.

---

### Edge Cases

- An action that writes two entries (an approval: the file and the garage)
  passes the guard: "at least one entry by this admin".
- An action done by the system on an admin's behalf (the test switch's
  automatic approval, actor `system`) is not an admin action; it is recorded
  as MotorFix, as ST-207 already does, and the guard test does not call it.
- An admin acting through an AI assistant: the writer marks `via_assistant`
  when a grant is given; there is no admin assistant at launch, so every
  admin entry has `via_assistant` = false.
- A route whose call is refused before any change (404 to a non-admin, 400
  to an invalid body, 409 to a refused transition) writes nothing; the guard
  test only counts entries after a successful call.
- The guard test runs against the real API and database, like the admin
  routes test it sits beside; an admin route that needs a body gets a
  known-good request from a table in the test, keyed by `METHOD /path`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every `admin/*` route whose method is `POST`, `PUT`, `PATCH` or
  `DELETE` MUST write, inside the same transaction as its change, at least
  one audit entry whose actor is the calling admin: `actor_id` the admin's
  account, `actor_role` `admin`, `actor_name` the admin's first name, with
  the action, the subject, the old and new values, and the time, as the
  audit capability stores them. When the entry cannot be written the whole
  request fails and nothing of the change is saved.
- **FR-002**: `POST /api/v1/admin/live/test` MUST write one entry per
  successful call: action `create`, subject the target account
  (`subject_type` `account`, `subject_id` the account), kind `live.test`
  (proposed), no old value, and the new value naming what was sent.
- **FR-003**: `POST /api/v1/admin/notifications/test` MUST write one entry
  per successful call: action `create`, subject the calling admin's account,
  kind `notification.test` (proposed), and the new value listing the account
  ids the test message went to.
- **FR-004**: A guard test MUST take every `admin/*` route and method from the
  API's own route list (the OpenAPI document, as the admin routes test does),
  call each `POST`, `PUT`, `PATCH` or `DELETE` route once as a seeded admin
  with a known-good request from a table keyed by `METHOD /path`, and fail,
  naming every such route, when the successful call left no entry whose
  `actor_id` is that admin, or when the table holds no request for the route.
  Each `GET` route is called the same way and MUST leave no entry. After this
  story the test names no route; a route added later joins the test without
  the test being edited beyond its fixture table.
- **FR-005**: The verification entries ST-207 writes for an admin's open,
  decision, reopening and the garage's publication MUST stay as they are;
  this story changes none of them, and the guard test confirms the
  decision's two entries only once a decision endpoint exists (it does not
  yet; the use case's own tests cover the entries today).
- **FR-006**: The entries this story adds MUST be returned by
  `GET /api/v1/audit-history` in the `admin_actions` area to an admin, as
  every entry an admin makes is (391-FR-008 unchanged; no change to the
  endpoint).
- **FR-007**: Tests: Jest, API — FR-002's entry and its fields; FR-003's
  entry and its fields; the guard test of FR-004 (every changing admin route
  leaves an admin entry; every `GET` admin route leaves none; a route without
  a fixture is named); the rolled-back change leaves no entry (the existing
  verification and audit tests, unchanged). Playwright: none in this story;
  the admin's audit history view (a later story) tests the end-to-end walk.

### Key Entities

- **Audit entry**: one row of the audit history (ST-390): actor (id, role,
  first name), action, subject type and id, field, old and new value, scope
  ids, flags, kind, text, time. Unchanged.
- **Admin route**: an API route under `/api/v1/admin/` that only an admin may
  call (ST-160). Its method says whether it changes data (`POST`, `PUT`,
  `PATCH`, `DELETE`) or reads (`GET`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the `admin/*` routes that change data (three in the API
  today: live test, news, notifications test) leave at least one audit entry
  made by the calling admin, and the guard test names 0 routes.
- **SC-002**: 0 entries are written by the `admin/*` routes that read (one
  today: the overview).
- **SC-003**: An `admin/*` route added without an entry, or without a request
  fixture, is named by one failing test on the next run of the suite, with no
  change to the test's logic.
- **SC-004**: 0 audit entries remain after an admin change whose transaction
  rolled back.

## Assumptions

- The actor's name is the admin's first name, as 390-FR-006 stores it; the
  story's "Ana P." is a display form and the living capability wins
  *(autonomous default)*.
- The admin tools that exist for testing (`admin/live/test`,
  `admin/notifications/test`) are admin actions and get entries: the Build
  brief counts the test-only switches among the covered actions
  *(autonomous default)*.
- Opening a legal document (the story's scenario 3) has no endpoint yet; the
  download address is issued by the file story (ST-206 / ST-302). Its `open`
  entry is that story's requirement, under the audit capability's rule that
  it is one of the two logged reads; this story builds no hook for it, and
  the guard test, which checks changes, does not cover logged reads
  *(autonomous default)*.
- The platform rules, the two-admin rule, maintenance mode and the warning
  limits (scenario 4) are not built; their stories (ST-258 to ST-260) write
  their entries through the writer, and FR-004 catches an endpoint that does
  not *(autonomous default)*.
- The checks on a file and the decision endpoints (ST-300 to ST-306) are not
  built; their use cases already write entries (ST-207), and their endpoints
  join the guard test when they appear *(autonomous default)*.
- The append-only rule (390-FR-011) and the insert-only grant test exist and
  are not repeated here.
- Entries are not outbox events and nobody is notified (story: Events, none).
- Retention stays open with the lawyer (owner's proposal: while the account
  or garage is active, then 5 years); nothing is deleted.
- Success Criteria numbers come from the API's route list today (three
  changing admin routes, one reading one) and the story's own scenarios; no
  other number is claimed.

## Out of scope

- The general audit writer, its table and the entries of non-admin actions
  (ST-390); the read endpoint (ST-391).
- The screens that show the audit history, and the overview's "Jurnal"
  panel (MF-49, epic Operations).
- The technical System status log.
- The entries of admin stories not yet built (checks, decisions, platform
  rules, the two-admin rule, maintenance mode): each writes its own, and the
  guard test of FR-004 holds them to it.
- Opening a legal document and a driver's private repair: the two logged
  reads belong to the stories that issue those reads.

## Spec Delta

### Capability: `audit`

- **Adds**: FR-001, FR-002, FR-003, FR-004
- **Modifies**: none
- **Removes**: none

FR-001 is the rule over the admin routes (every changing `admin/*` route
writes an entry by the calling admin; a reading one writes none). FR-002 and
FR-003 are the two entries missing today. FR-004 is the guard test that
holds every later admin route to FR-001. FR-005 and FR-006 restate what the
garage-verification and audit capabilities already hold (207-FR-008,
391-FR-008) and FR-007 names tests; they add no requirement to a capability.

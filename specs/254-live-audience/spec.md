# Feature Specification: Send live updates only to the people involved

**Feature Branch**: `254-live-audience`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-254 Send live updates only to the people involved (Notion story https://app.notion.com/p/3ee607bff0d281769e64ff763a743def, epic EP-1 Foundations)."

**Sources**: Notion story ST-254 (https://app.notion.com/p/3ee607bff0d281769e64ff763a743def), read 2026-10-05; its Build brief wins over the criteria above it. Foundations timeline row ST-254 (note: "GARAGE_FEATURE arrives with EP-2: every feature counts as on until then"). Blockers, both Done: ST-253 "Set up the real-time connection to open dashboards" (PR #57, capability `live-updates`), ST-79 "Set up the account model, the four roles and their rights" (PR #3). Out of scope per the brief: publishing events and the outbox (ST-257), the public stream's own channels and kinds, permissions on API reads.

## Clarifications

### Session 2026-10-05

- Q: Requests, jobs and cars do not exist yet. What does this story build for them? → A: The audience table (subject → channel keys) and the per-connection filter, keyed on event kinds; both are proved with unit tests for each subject and kind family, and end to end with the test update sent to one driver and not received by another (story Notes: "In this epic the rule is shown with a test update sent to one person and not received by another").
- Q: How does a `job:{jobId}` audience reach people when no connection joins a job channel? → A: The relay resolves a job subject to the job's driver `account:{accountId}`, the garage `garage:{garageId}` and the job's mechanic `mechanic:{mechanicId}`; the three job kinds the brief also names for the driver's account are therefore covered by the same keys.
- Q: How does the hub learn whom `member.removed` removed, when a live message carries only kind, id and time? → A: Its `id` is the removed person's account id and its audience holds `garage:{garageId}`; the hub reads the garage from that key.
- Q: How does an open stream end when its account is suspended or deleted? → A: The server sends `bye` with reason `evicted` and ends every stream of the account; the web app already never reconnects after `evicted` (253-FR-014).
- Q: A mechanic with *can_answer_quotes* gets "requests and messages". Do quote events count? → A: No: the brief lists requests and messages only; quote kinds reach a mechanic through nothing but their own channels.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A person gets only the updates about what is theirs (Priority: P1)

Every live event names a subject (a request, quote, booking, job, review, message, car, repair, verification, platform rule, or an account). The server turns the subject into the channel keys of the people who may read it, and each API copy forwards the event only to its own connections in those channels. A driver never gets anything about another customer's job.

**Why this priority**: it is the story: no one sees another customer's data.

**Independent Test**: the audience table for each subject, and two drivers' open dashboards where a test update sent to one never reaches the other.

**Acceptance Scenarios**:

1. **Given** drivers Andrei and Maria each have a job at the same garage, **When** a step of Andrei's job is ticked, **Then** Andrei and the garage's owner get `job.step_done` and Maria never does.
2. **Given** the test update is sent to driver A, **When** driver B's dashboard is open, **Then** A's dashboard shows it and B gets nothing.
3. **Given** an event with no audience, **When** it reaches an API copy, **Then** it is dropped and logged, never broadcast.

---

### User Story 2 - Garage staff get only what their role and rights allow (Priority: P1)

Events addressed to a garage reach its staff by role: the owner gets everything, a receptionist everything but prices, settings, feature switches and the team, and a mechanic only what their permissions open, with their own jobs and bookings arriving on their own channel. Nothing about a feature the garage switched off is forwarded to its staff.

**Why this priority**: the garage channel is shared by every staff member, so without this filter a mechanic or receptionist sees what their role may not read.

**Independent Test**: one garage with an owner, a receptionist and mechanics with and without permissions; publish each kind family to the garage and read who got it.

**Acceptance Scenarios**:

1. **Given** mechanics Elena and Mihai at the same garage, **When** Mihai's job changes, **Then** Elena's connection does not get it.
2. **Given** a mechanic without *can_answer_quotes*, **When** a request reaches the garage, **Then** the mechanic does not get `request.created`; with the permission, they do.
3. **Given** a receptionist, **When** the owner changes the price list, **Then** the receptionist does not get `price_list.updated`.
4. **Given** a garage with `live_media` off, **When** any media event would be forwarded to its staff, **Then** it is not.
5. **Given** a person is removed from a garage, **When** `member.removed` is processed, **Then** their open connections leave `garage:{garageId}` at once.

---

### User Story 3 - Streams follow the account (Priority: P2)

A suspended or deleted account's open streams close; a role switch reconnects with the new role's channels; a public connection never gets a private event.

**Why this priority**: these keep the rule true over time, after the stream has opened.

**Independent Test**: open streams, publish the account event, read `bye`; publish private kinds to `public:` keys and read nothing.

**Acceptance Scenarios**:

1. **Given** an account is suspended or deleted, **When** that happens, **Then** its open connections are closed.
2. **Given** a person switches from the garage role to the driver role, **When** the switch completes, **Then** the tab reconnects with the driver role's channels.
3. **Given** a connection on the public stream, **When** any private event is published (request, quote, booking, job, message, car), **Then** it is never forwarded there.

### Edge Cases

- A connection that meets the audience on several keys gets the event once, after the first key that allows it.
- Loading a garage's staff or switches fails: that event is dropped for that garage's staff connections and logged; other connections still get it, and the next event loads again.
- A staff connection whose membership was removed without a `member.removed` event stops receiving through the garage within 60 seconds, when the cached staff list expires.
- A garage with no `garage_feature` row has every feature on.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The audience of an event MUST be worked out from its subject: request → the driver's `account:` and each recipient `garage:`; quote → the driver and the quoting garage; booking → the driver, the garage and the booking's `mechanic:` when it has one; job (with its media and live kinds) → the driver, the garage and the job's mechanic when it has one; review → the garage, the author, `public:garage` and `public:mechanic`; message → the driver and the garage; car and repair → the owner's account, plus the named garage for a shared repair; verification and documents → `admin` and the garage; platform rules and copy voices → `admin` and `system`; account → that `account:`.
- **FR-002**: An API copy MUST drop and log an event whose audience is empty, and MUST NOT forward it to any connection.
- **FR-003**: Through `garage:{garageId}`, an owner MUST get every kind; a receptionist MUST NOT get price-list, settings, feature-switch or team kinds (`price_list.*`, `garage.settings_changed`, `garage.features_changed`, `member.*`, `mechanic.*`); a mechanic MUST get only `request.*` and `message.*` kinds with *can_answer_quotes* and `booking.move*` kinds with *can_move_bookings*, and nothing else.
- **FR-004**: A garage-staff connection MUST receive through `garage:{garageId}` or `mechanic:{mechanicId}` only while its account is still that garage's staff in the role of the connection (owner or receptionist membership, or the mechanic record).
- **FR-005**: An event of a feature the garage switched off MUST NOT be forwarded to that garage's staff connections: `media.*` kinds belong to `live_media`; a garage with no row for a feature has it on.
- **FR-006**: Each API copy MUST read a garage's staff, mechanic permissions and feature switches once and keep them for 60 seconds, and MUST drop them at once when `member.removed`, `mechanic.updated` or `garage.features_changed` for that garage passes through it.
- **FR-007**: When `member.removed` passes through with `garage:{garageId}` in its audience, the open connections of the account named by its `id` MUST leave `garage:{garageId}` and their `mechanic:` channel at once.
- **FR-008**: When `account.suspended` or `account.deleted` passes through, every open stream of the account named by its `id` MUST receive `bye` with reason `evicted` and end.
- **FR-009**: A request, quote, booking, job, media, live, message, car or repair kind MUST NOT be forwarded through a `public:` key.
- **FR-010**: A failure to read a garage's staff or switches MUST drop that event for that garage's staff connections only and be logged; every other connection MUST still get it.
- **FR-011**: After a role switch the web app MUST close its live connection and open a new one, so it joins the new role's channels.
- **FR-012**: A test update sent to one driver MUST show on that driver's open dashboard and MUST NOT reach another driver's open dashboard.
- **FR-013**: Events MUST be fanned out through one Redis pub/sub channel, each message holding the event and its audience as a list of channel keys; every API copy MUST forward an event only to its own connections whose channels meet the audience and whose role, rights and garage switches allow it (FR-003 to FR-005, FR-009), each such connection exactly once.

### Key Entities

- **Audience**: the channel keys an event goes to, worked out from its subject.
- **Garage access**: per garage and API copy, its owner and receptionist accounts, its mechanics with their permissions, and the features it switched off; kept 60 seconds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the end-to-end test, the driver the test update was sent to sees it within 2 seconds and the other driver's dashboard gets nothing.
- **SC-002**: Each kind family in FR-003 and FR-005 is proved for every garage role with a unit test.

## Spec Delta

### Capability: `live-updates`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012
- **Modifies**: 253-FR-006 → FR-013
- **Removes**: none

## Assumptions

- (autonomous default) Level 1: one backend unit in `libs/domain/src/events`, no screen; no plan, checklist or analyze phase (`node .claude/scripts/level.mjs`).
- (autonomous default) Kind names for later events follow the brief's examples (`request.created`, `price_list.updated`, `job.step_done`, `member.removed`); the receptionist and mechanic rules match on these prefixes, and a later story that names a kind outside them extends the list.
- (autonomous default) `GARAGE_FEATURE` exists already (`libs/domain/prisma/schema/garages.prisma`) with a missing row meaning on; the timeline note says every feature counts as on until EP-2 writes the switches.
- (autonomous default) Suspension and removal have no writer yet; the hub acts on the events when they pass through, and the stories that suspend accounts and remove members publish them.
- (autonomous default) The 60-second cache is per API copy and per garage; it holds no personal data beyond account ids.
- (autonomous default) The role-switch reconnect (FR-011) was built with ST-394 (`apps/web/src/app/dashboard/frame.ts`); this story keeps its tests as the proof.

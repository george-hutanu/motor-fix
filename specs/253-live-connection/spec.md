# Feature Specification: Set up the real-time connection to open dashboards

**Feature Branch**: `253-live-connection`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-253 Set up the real-time connection to open dashboards (Notion story https://app.notion.com/p/3ee607bff0d281739e3df7b8fc484d49, epic EP-1 Foundations). Scope: signed-in SSE stream GET /api/v1/live in the events module (fetch-based reader with Authorization header, channels per role: account/garage/mechanic/admin/system, Redis pub/sub fan-out across API copies, 25s heartbeat, end at token expiry + one reconnect, 10-stream cap), the Angular `live` library opening one connection per tab, and an admin-only POST /api/v1/admin/live/test event shown as a toast on each role's dashboard within 2 seconds."

**Sources**: Notion story ST-253 (https://app.notion.com/p/3ee607bff0d281739e3df7b8fc484d49), read 2026-10-04 (last edited 2026-10-04 15:43); its Build brief wins over the criteria above it. Blockers, all Done: ST-252 "Decide: WebSocket or server-sent events" (server-sent events, A8), ST-82 "Sign in with e-mail and password" (PR #45), ST-79 "Set up the account model, the roles and their rights" (PR #3). Siblings read for the boundary: ST-254 (who receives which event), ST-255 (reconnect and catch-up), ST-256 (live updates in place), ST-257 (outbox and typed events), ST-394 (role switch). Feature: https://app.notion.com/p/3ee607bff0d281de9544d2b4e8331043.

## Clarifications

### Session 2026-10-04

- Q: Which stream ends trigger the one reconnect, and how does the client know which end it got? → A: The server's last message before it closes a stream is `bye` with a reason, `expired`, `evicted` or `shutdown`; the web app reconnects after `expired` and `shutdown`, never after `evicted` or a sign-out; a drop with no `bye` is ST-255's (backoff and catch-up).
- Q: Does "the dashboard" mean the whole signed-in shell, or the dashboard home route? → A: The shell: the connection opens when the dashboard frame starts and closes when it is destroyed or at sign-out; moving between views inside it keeps the connection.
- Q: For an account with staff membership at more than one garage, does the connection join one garage channel or all of them for the role in use? → A: One: the garage of the role in use, the same garage every signed-in call resolves; a role or garage switch (ST-394) reopens the stream.
- Q: Does the mechanic have a dashboard of its own in this story, and must it show the toast? → A: A mechanic lands on the garage dashboard (`landingFor`, `libs/domain/src/auth/policy.ts`), so the garage dashboard serves owner, receptionist and mechanic; the toast shows for all four roles there and on the driver and admin dashboards.
- Q: With Redis down, does a new stream open, and when Redis returns do open streams resume receiving events without reconnecting? → A: A new stream opens (`hello`, heartbeats); when Redis returns, the API copy's one subscriber resubscribes and open streams receive events again without reconnecting. Only the test address answers 503 meanwhile.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - My open dashboard keeps a live connection to the server (Priority: P1)

A signed-in person (driver, garage owner, receptionist, mechanic or admin) opens their dashboard. The dashboard opens one live connection to the server for that tab, signed in as them. The server greets the connection and places it in the audiences the person belongs to: their own account and everyone, plus their garage for garage staff, their mechanic record for a mechanic, and the admins for an admin.

**Why this priority**: every live feature in later epics (quotes, bookings, the workshop stream, the bell) needs this connection; nothing else in this story works without it.

**Independent Test**: sign in as each role, open the stream, read the greeting and the audiences the server reports for the connection.

**Acceptance Scenarios**:

1. **Given** a signed-in driver opens the dashboard, **When** the dashboard starts, **Then** one stream opens to the live address, the first message is `hello` carrying a connection id, and the connection is in `account:{accountId}` and `system`.
2. **Given** a garage owner, a receptionist, a mechanic and an admin open their dashboards, **When** their streams open, **Then** each is in `account:{accountId}` and `system`; garage staff (owner, receptionist, mechanic) are also in `garage:{garageId}`; the mechanic is also in `mechanic:{mechanicId}`; the admin is also in `admin`.
3. **Given** no valid access token, **When** the live address is called, **Then** the answer is 401 and no stream opens.
4. **Given** a suspended account's valid token, **When** the live address is called, **Then** the answer is 403 and no stream opens, as for every other signed-in call.

---

### User Story 2 - An admin's test update shows on every open dashboard within two seconds (Priority: P1)

A MotorFix admin sends a test update to a person. Every dashboard that person has open, in any tab or device, shows a short toast within two seconds, without a reload.

**Why this priority**: it is the story's proof that a change made by one person reaches another person's open screen; the real events come from later epics.

**Independent Test**: open the driver and garage dashboards in two browsers; as an admin send the test update to each; both toasts show within 2 seconds and neither page reloads.

**Acceptance Scenarios**:

1. **Given** all four dashboards (driver, garage, mechanic, admin) are open, **When** an admin sends the test update to each of their accounts, **Then** a toast "Actualizare de test în direct" ("Live test update") shows on each within 2 seconds, without a reload.
2. **Given** a driver has the dashboard open on a phone and on a laptop, **When** a test update is sent to them, **Then** both show it.
3. **Given** a driver, a garage owner, a receptionist or a mechanic, **When** they call the test address, **Then** the answer is 404 and nothing is sent.
4. **Given** an admin sends a test update to an account that does not exist, **When** the call is made, **Then** the answer is 404 and nothing is sent.
5. **Given** two copies of the API run against one Redis, **When** a test update is published, **Then** each copy forwards it only to its own connections in the update's audience, and each connection gets it exactly once.

---

### User Story 3 - The connection stays healthy for as long as the dashboard is open (Priority: P2)

A quiet connection is kept open with a heartbeat so proxies do not cut it. When the person's 15-minute access token expires, the server ends the stream; the dashboard renews the token the normal way and reconnects. One account cannot hold an unbounded number of streams.

**Why this priority**: without it a connection silently dies after a proxy timeout or 15 minutes, and the live updates of later epics would stop arriving.

**Independent Test**: hold a stream open with a fake clock; read the heartbeat after 25 s, the end at token expiry, the reconnect, and the eleventh stream closing the first.

**Acceptance Scenarios**:

1. **Given** a quiet stream, **When** 25 seconds pass with no event, **Then** the server sends a comment line.
2. **Given** a stream whose access token expires, **When** the expiry passes, **Then** the server sends `bye` with reason `expired` and ends the stream; the dashboard renews the token through the normal refresh and reconnects within 3 seconds.
3. **Given** the renewal fails (the session is over), **When** the stream ends, **Then** the dashboard does not reconnect.
4. **Given** an account already has 10 open streams on an API copy, **When** an 11th opens, **Then** the oldest gets `bye` with reason `evicted` and is closed, and its tab does not reconnect.
5. **Given** the API copy shuts down, **When** shutdown starts, **Then** it sends `bye` with reason `shutdown` and ends its streams; the dashboards reconnect.
6. **Given** Redis is unavailable, **When** a stream is open or a new one opens, **Then** it stays open and sends only heartbeats; a test update asked for in that time answers 503; when Redis returns, events reach the open streams again without a reconnect.

### Edge Cases

- The person signs out or leaves the dashboard: the tab's connection closes and is not reopened.
- The page is rendered on the server: no connection is opened there; the browser opens it after start.
- A message in Redis that is not valid JSON or has no audience: dropped and logged, the stream stays open.
- A stream whose client has gone away: its slot and subscriptions are released at once.
- A tab that already has its connection open: a second start in the same tab reuses it, never opens another.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The API MUST serve a signed-in server-sent events stream at `GET /api/v1/live`, with `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`, signed in by the `Authorization: Bearer` header only, never a token in the address.
- **FR-002**: The stream MUST answer 401 without a valid access token, and 403 for a suspended account, before any stream data is sent.
- **FR-003**: The first message of a stream MUST be `hello` with a connection id.
- **FR-004**: A connection MUST join `account:{accountId}` and `system`; for the role in use, garage staff (owner, receptionist, mechanic) MUST also join `garage:{garageId}` for the one garage that role resolves to, a mechanic MUST also join `mechanic:{mechanicId}`, and an admin MUST also join `admin`.
- **FR-005**: Every message MUST use the SSE `event:` line for its kind and one `data:` line `{"kind":"…","id":"…","at":"…"}`, carrying no personal data.
- **FR-006**: Events MUST be fanned out through one Redis pub/sub channel, each message holding the event and its audience as a list of channel keys; every API copy MUST forward an event only to its own connections whose channels meet the audience, each such connection exactly once.
- **FR-007**: A stream with no event for 25 seconds MUST receive a comment line.
- **FR-008**: The server MUST end a stream when its access token expires. Before it ends a stream itself, the server MUST send `bye` whose `reason` is `expired`, `evicted` or `shutdown`.
- **FR-009**: When an account opens an 11th stream on one API copy, the oldest of its streams MUST be closed.
- **FR-010**: On shutdown an API copy MUST end its streams; when a client goes away its connection MUST be released.
- **FR-011**: With Redis unavailable a stream MUST open and stay open with heartbeats only; when Redis returns, open streams MUST receive events again without reconnecting; a malformed fan-out message MUST be dropped without closing any stream.
- **FR-012**: `POST /api/v1/admin/live/test` with an account id MUST publish a `live.test` event to `account:{accountId}` for a MotorFix admin; a call with no valid token MUST get 401 and a signed-in non-admin 404; an unknown account MUST get 404; with Redis unavailable it MUST answer 503.
- **FR-013**: The web app MUST open one live connection per browser tab on a signed-in dashboard, reading the stream with the access token in the `Authorization` header, and MUST close it at sign-out or when the dashboard frame is destroyed; moving between views inside the frame keeps it; no connection is opened during server rendering.
- **FR-014**: After `bye` with reason `expired` or `shutdown`, the web app MUST renew the access token through the normal refresh and reconnect within 3 seconds; after `evicted`, after sign-out, or when the renewal fails it MUST NOT reconnect.
- **FR-015**: Every dashboard (driver; garage, serving owner, receptionist and mechanic; admin) MUST show the shared toast "Actualizare de test în direct" / "Live test update" on a `live.test` event, in the person's language.

### Key Entities

- **Live connection**: one open stream, held in the memory of one API copy: connection id, account id, its channel keys, opened time, token expiry. Nothing is written to the database.
- **Live event**: kind, object id, time; published with its audience (a list of channel keys).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A test update sent by an admin shows on the target's open dashboard within 2 seconds (Notion acceptance criterion).
- **SC-002**: With two API copies, each open connection in the audience receives an event exactly once (Build brief scenario 8).
- **SC-003**: After an access-token expiry the dashboard is connected again within 3 seconds (Build brief scenario 6, proposed).
- **SC-004**: No account holds more than 10 streams on one API copy (Build brief scenario 9, proposed).

## Spec Delta

### Capability: `live-updates`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015
- **Modifies**: none
- **Removes**: none

## Assumptions

- (autonomous default) The test update's toast text is "Actualizare de test în direct" in Romanian and "Live test update" in English; the Build brief names only "a test toast".
- (autonomous default) The test address takes `{ "accountId": "<uuid>" }` and answers 202; the brief says the admin sends it "to each of them" without naming the body.
- (autonomous default) The 10-stream cap is counted per API copy; a cap across copies needs shared counting and is left to ST-255 or later. The current deployment runs one API copy.
- (autonomous default) "Reconnect once after token expiry" means: one renew-and-reconnect attempt after a `bye` of `expired` or `shutdown`; a failed renewal stops. Backoff, catch-up, drops without `bye` and repeated attempts are ST-255.
- (autonomous default) The channels are worked out from the role in use when the stream opens (the same rule every signed-in call uses, `roleInUse`); switching role (ST-394) reopens the stream.
- (autonomous default) A mechanic is garage staff and so also joins `garage:{garageId}`; the per-event filtering by role and permission is ST-254.
- (autonomous default) `bye` and `hello` are control messages with the same `kind`, `id` (the connection id), `at` shape, plus `reason` on `bye`; the `id` of a `live.test` event is a fresh event id, never the account id.
- The Notion story was last edited at 16:55 on 2026-10-04 by this run's own status and PR writes, not a content change; the Build brief read at 15:43 stands (context.md contradiction 1).
- Redis is the existing one (`REDIS_URL`); nothing in it is the only copy of anything (Constitution VI): the stream carries no state of its own.
- Out of scope, per the Build brief: event filtering (ST-254), the outbox and typed event kinds (ST-257), reconnect with backoff and catch-up (ST-255), the public stream.

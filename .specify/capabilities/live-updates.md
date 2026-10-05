---
capability: live-updates
updated: 2026-10-05
features:
  - 253-live-connection
  - 254-live-audience
  - 257-live-events
  - 256-live-in-place
---

# Capability: Live updates

The signed-in server-sent events connection from the API to every open dashboard: who joins which channel, how events fan out across API copies, and how the connection stays healthy.

## Requirements

### 253-FR-001 — The API MUST serve a signed-in server-sent events stream at `GET /api/v1/live`, with `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`, signed in by the `Authorization: Bearer` header only, never a token in the address.

_From 253-live-connection._

### 253-FR-002 — The stream MUST answer 401 without a valid access token, and 403 for a suspended account, before any stream data is sent.

_From 253-live-connection._

### 253-FR-003 — The first message of a stream MUST be `hello` with a connection id.

_From 253-live-connection._

### 253-FR-004 — A connection MUST join `account:{accountId}` and `system`; for the role in use, garage staff (owner, receptionist, mechanic) MUST also join `garage:{garageId}` for the one garage that role resolves to, a mechanic MUST also join `mechanic:{mechanicId}`, and an admin MUST also join `admin`.

_From 253-live-connection._

### 253-FR-005 — Every message MUST use the SSE `event:` line for its kind and one `data:` line `{"kind":"…","id":"…","at":"…"}`, carrying no personal data.

_From 253-live-connection._

### 254-FR-013 — Events MUST be fanned out through one Redis pub/sub channel, each message holding the event and its audience as a list of channel keys; every API copy MUST forward an event only to its own connections whose channels meet the audience and whose role, rights and garage switches allow it (FR-003 to FR-005, FR-009), each such connection exactly once.

_From 254-live-audience._

### 253-FR-007 — A stream with no event for 25 seconds MUST receive a comment line.

_From 253-live-connection._

### 253-FR-008 — The server MUST end a stream when its access token expires. Before it ends a stream itself, the server MUST send `bye` whose `reason` is `expired`, `evicted` or `shutdown`.

_From 253-live-connection._

### 253-FR-009 — When an account opens an 11th stream on one API copy, the oldest of its streams MUST be closed.

_From 253-live-connection._

### 253-FR-010 — On shutdown an API copy MUST end its streams; when a client goes away its connection MUST be released.

_From 253-live-connection._

### 253-FR-011 — With Redis unavailable a stream MUST open and stay open with heartbeats only; when Redis returns, open streams MUST receive events again without reconnecting; a malformed fan-out message MUST be dropped without closing any stream.

_From 253-live-connection._

### 256-FR-012 — `POST /api/v1/admin/live/test` with an account id MUST record a `live.test` event for that account through the outbox in one transaction and answer 202 for a MotorFix admin; a call with no valid token MUST get 401, a signed-in non-admin 404, and an unknown account 404. The account's open dashboards MUST show the test update on their status line within 2 seconds while the worker runs.

_From 256-live-in-place._

### 253-FR-013 — The web app MUST open one live connection per browser tab on a signed-in dashboard, reading the stream with the access token in the `Authorization` header, and MUST close it at sign-out or when the dashboard frame is destroyed; moving between views inside the frame keeps it; no connection is opened during server rendering.

_From 253-live-connection._

### 253-FR-014 — After `bye` with reason `expired` or `shutdown`, the web app MUST renew the access token through the normal refresh and reconnect within 3 seconds; after `evicted`, after sign-out, or when the renewal fails it MUST NOT reconnect.

_From 253-live-connection._

### 256-FR-011 — Every dashboard (driver; garage, serving owner, receptionist and mechanic; admin) MUST show the epic's test update on the status line under its header, "Actualizare de test în direct · <time>" / "Live test update · <time>", changed in place in the person's language, and MUST raise no toast for it.

_From 256-live-in-place._

### 254-FR-001 — The audience of an event MUST be worked out from its subject: request → the driver's `account:` and each recipient `garage:`; quote → the driver and the quoting garage; booking → the driver, the garage and the booking's `mechanic:` when it has one; job (with its media and live kinds) → the driver, the garage and the job's mechanic when it has one; review → the garage, the author, `public:garage` and `public:mechanic`; message → the driver and the garage; car and repair → the owner's account, plus the named garage for a shared repair; verification and documents → `admin` and the garage; platform rules and copy voices → `admin` and `system`; account → that `account:`.

_From 254-live-audience._

### 254-FR-002 — An API copy MUST drop and log an event whose audience is empty, and MUST NOT forward it to any connection.

_From 254-live-audience._

### 254-FR-003 — Through `garage:{garageId}`, an owner MUST get every kind; a receptionist MUST NOT get price-list, settings, feature-switch or team kinds (`price_list.*`, `garage.settings_changed`, `garage.features_changed`, `member.*`, `mechanic.*`); a mechanic MUST get only `request.*` and `message.*` kinds with *can_answer_quotes* and `booking.move*` kinds with *can_move_bookings*, and nothing else.

_From 254-live-audience._

### 254-FR-004 — A garage-staff connection MUST receive through `garage:{garageId}` or `mechanic:{mechanicId}` only while its account is still that garage's staff in the role of the connection (owner or receptionist membership, or the mechanic record).

_From 254-live-audience._

### 254-FR-005 — An event of a feature the garage switched off MUST NOT be forwarded to that garage's staff connections: `media.*` kinds belong to `live_media`; a garage with no row for a feature has it on.

_From 254-live-audience._

### 254-FR-006 — Each API copy MUST read a garage's staff, mechanic permissions and feature switches once and keep them for 60 seconds, and MUST drop them at once when `member.removed`, `mechanic.updated` or `garage.features_changed` for that garage passes through it.

_From 254-live-audience._

### 254-FR-007 — When `member.removed` passes through with `garage:{garageId}` in its audience, the open connections of the account named by its `id` MUST leave `garage:{garageId}` and their `mechanic:` channel at once.

_From 254-live-audience._

### 254-FR-008 — When `account.suspended` or `account.deleted` passes through, every open stream of the account named by its `id` MUST receive `bye` with reason `evicted` and end.

_From 254-live-audience._

### 254-FR-009 — A request, quote, booking, job, media, live, message, car or repair kind MUST NOT be forwarded through a `public:` key.

_From 254-live-audience._

### 254-FR-010 — A failure to read a garage's staff or switches MUST drop that event for that garage's staff connections only and be logged; every other connection MUST still get it.

_From 254-live-audience._

### 254-FR-011 — After a role switch the web app MUST close its live connection and open a new one, so it joins the new role's channels.

_From 254-live-audience._

### 254-FR-012 — A test update sent to one driver MUST show on that driver's open dashboard and MUST NOT reach another driver's open dashboard.

_From 254-live-audience._

### 257-FR-001 — The backend MUST offer one call that records an event (kind, subject id, payload, subject) inside the caller's transaction, writing one OUTBOX_EVENT row with the audience worked out from the subject (254-FR-001), so the change and its event commit or roll back together.

_From 257-live-events._

### 257-FR-002 — The worker's relay MUST read unrelayed OUTBOX_EVENT rows in ascending id order, publish each to Redis `live:events` as `{ event: { kind, id: subject id, at: created at }, audience }`, and set `relayed_at`, polling every 200 ms.

_From 257-live-events._

### 257-FR-003 — When publishing fails, the relay MUST leave the rows unrelayed and retry them, oldest first, on the next poll; a row whose `relayed_at` was not saved MUST be published again (at least once).

_From 257-live-events._

### 257-FR-004 — Two relays polling at once MUST each relay a different row set (`FOR UPDATE SKIP LOCKED`), so each row is relayed once.

_From 257-live-events._

### 257-FR-005 — For each relayed event whose kind has registered consumers, the relay MUST add one job per consumer to that consumer's queue, with the job id derived from the event id, so a second relay of the same event adds no second job.

_From 257-live-events._

### 257-FR-006 — Every event kind of the Backend architecture events list, plus `account.signed_out_everywhere` and `live.test`, MUST be named in one typed catalogue in the shared contracts library; recording or subscribing to a kind outside it MUST fail to compile.

_From 257-live-events._

### 257-FR-007 — The relay MUST delete relayed rows older than 7 days, and MUST log an error when the oldest waiting row is older than 30 seconds, at most once every 30 seconds.

_From 257-live-events._

### 257-FR-008 — The web app's live service MUST let a view subscribe to a list of kinds, optionally for one object id, and receive only the matching events.

_From 257-live-events._

### 256-FR-002 — The web app MUST offer a helper that loads a view's data through the API and re-reads it when an event about the shown object arrives. Events that arrive within 300 ms of each other cause one re-read, events about other objects cause none, and only one read runs at a time.

_From 256-live-in-place._

### 257-FR-011 — Account sign-up (`account.created`) and sign-out everywhere (`account.signed_out_everywhere`) MUST record their events through the outbox, with the account as their subject.

_From 257-live-events._

### 256-FR-001 — A re-read is merged into the view's value by structural sharing. Equal objects and rows (rows matched by `id`) keep their previous reference, and an equal result leaves the value unchanged.

_From 256-live-in-place._

### 256-FR-003 — A background re-read that fails leaves the last value on screen and shows no error. The view re-reads on the next event, or 60 seconds after the failure, whichever comes first.

_From 256-live-in-place._

### 256-FR-004 — A re-read that answers 404 marks a single-object view `gone`, and the view keeps its last value. A drawer that shows it says "Nu mai este disponibil" / "No longer available" and stays open.

_From 256-live-in-place._

### 256-FR-005 — A live update never reloads the page, changes the route, closes a dialog, drawer or sheet, or moves focus.

_From 256-live-in-place._

### 256-FR-006 — A form edits a local copy taken when it opens. A re-read never writes into it. While the shown object differs from that copy's source, `changed()` holds the new object, a line "S-a schimbat între timp: <value>" shows, and accepting it makes the new object the source.

_From 256-live-in-place._

### 256-FR-007 — While a list is not at its top, new rows that sort before the rows shown are held back and counted. A pill "{count} actualizare nouă / actualizări noi / de actualizări noi" (EN "{count} new update / updates") shows at the top. Tapping it shows the held rows and scrolls up to the first. At the top, new rows show at once.

_From 256-live-in-place._

### 256-FR-008 — Across an update, a scrolled list keeps its first visible row at the same place on screen.

_From 256-live-in-place._

### 256-FR-009 — A changed row or value is highlighted for 1 second, and not at all with reduced motion.

_From 256-live-in-place._

### 256-FR-010 — A changed visible value is announced politely (`aria-live="polite"`), without moving focus.

_From 256-live-in-place._

## Retired

- `253-FR-006` — superseded by `254-FR-013` (2026-10-05)

- `253-FR-012` — superseded by `257-FR-010` (2026-10-05)

- `253-FR-015` — superseded by `256-FR-011` (2026-10-05)
- `257-FR-009` — superseded by `256-FR-002` (2026-10-05)
- `257-FR-010` — superseded by `256-FR-012` (2026-10-05)

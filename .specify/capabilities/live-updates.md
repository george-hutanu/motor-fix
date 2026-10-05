---
capability: live-updates
updated: 2026-10-05
features:
  - 253-live-connection
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

### 253-FR-006 — Events MUST be fanned out through one Redis pub/sub channel, each message holding the event and its audience as a list of channel keys; every API copy MUST forward an event only to its own connections whose channels meet the audience, each such connection exactly once.

_From 253-live-connection._

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

### 253-FR-012 — `POST /api/v1/admin/live/test` with an account id MUST publish a `live.test` event to `account:{accountId}` for a MotorFix admin; a call with no valid token MUST get 401 and a signed-in non-admin 404; an unknown account MUST get 404; with Redis unavailable it MUST answer 503.

_From 253-live-connection._

### 253-FR-013 — The web app MUST open one live connection per browser tab on a signed-in dashboard, reading the stream with the access token in the `Authorization` header, and MUST close it at sign-out or when the dashboard frame is destroyed; moving between views inside the frame keeps it; no connection is opened during server rendering.

_From 253-live-connection._

### 253-FR-014 — After `bye` with reason `expired` or `shutdown`, the web app MUST renew the access token through the normal refresh and reconnect within 3 seconds; after `evicted`, after sign-out, or when the renewal fails it MUST NOT reconnect.

_From 253-live-connection._

### 253-FR-015 — Every dashboard (driver; garage, serving owner, receptionist and mechanic; admin) MUST show the shared toast "Actualizare de test în direct" / "Live test update" on a `live.test` event, in the person's language.

_From 253-live-connection._

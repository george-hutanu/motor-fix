---
capability: live-updates
updated: 2026-10-07
features:
  - 253-live-connection
  - 254-live-audience
  - 257-live-events
  - 256-live-in-place
  - 255-live-resync
  - 582-live-toast-axe
  - 574-live-hub-capabilities
  - 586-live-e2e-typed-text
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

### 574-FR-001 — Whether an event kind reaches a garage-staff stream that met it only on `garage:{garageId}` MUST be derived from the connection role's capabilities (`capabilitiesOf(role, permissions)`, the one capability table) through one table mapping kind families to the capability needed to read them: `price_list.*` → `garage.prices`; `member.*`, `mechanic.*`, `invite.*` → `garage.team`; `garage.settings_changed`, `garage.features_changed` → `garage.feature_switches`; `garage.updated` → `garage.profile`; `review.*` → `garage.reviews`; `request.*`, `message.*` → `garage.requests`; `booking.move*` → `garage.schedule`. The hub MUST hold no other per-role list of kinds. (Modifies 254-FR-003.)

_From 574-live-hub-capabilities._

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

### 255-FR-001 — The web app's live connection MUST expose its state: `closed` (not wanted: signed out, closed or evicted), `reconnecting` (wanted, no stream open yet or after a drop), `polling` (3 or more tries in a row have failed) and `open` (a stream answered 200).

_From 255-live-resync._

### 255-FR-002 — When the stream fails to open or ends for a reason other than `close()`, sign-out or `bye` `evicted`, the client MUST try again after 1, 2, 5, 10 and then every 30 seconds, each delay multiplied by a random factor between 0.9 and 1.1. A stream that opens resets the sequence. `bye` with reason `expired` or `shutdown` renews and reconnects at once, as before. A 401 renews the token before the next try and is not counted as a failure; a refused renewal sets the state `closed`.

_From 255-live-resync._

### 255-FR-003 — After 3 failed tries in a row, the state MUST be `polling`, and every open live view and the signed-in account MUST re-read at once and then every 60 seconds until a stream opens. Tries go on, on the backoff, meanwhile.

_From 255-live-resync._

### 255-FR-004 — When a stream opens after the tab already had one (any reconnect), every open live view and the signed-in account MUST re-read their data through the API as soon as the state becomes `open`, never waiting for missed events to be replayed.

_From 255-live-resync._

### 255-FR-005 — When a hidden tab becomes visible after being hidden for 60 seconds or more, the client MUST drop its stream, reset the backoff and open a fresh one at once, which re-reads every open view (FR-004). A stream that receives no bytes for 60 seconds MUST be treated as dropped. When the browser fires `online`, a try waiting on its backoff MUST start at once.

_From 255-live-resync._

### 255-FR-006 — Every dashboard MUST show a thin bar under its header, "Fără conexiune. Ce vezi poate fi vechi." / "No connection. What you see may be out of date.", as a polite status, once its live connection has not been `open` for more than 10 seconds while it is wanted (first load included), and MUST hide it as soon as a stream opens. It never covers content, moves focus or scrolls the page sideways at 320 px.

_From 255-live-resync._

### 255-FR-007 — The web app MUST offer a queue for small workshop actions: tick a job step, change a job's stage, change a job's estimated finish time. These kinds always go through the queue, online or not. An action is a request to its normal endpoint, carrying a fresh `Idempotency-Key` that stays the same on every resend. It is `waiting` until sent, `sent` while its answer is awaited, and leaves the queue once `accepted` (2xx) or `refused`.

_From 255-live-resync._

### 255-FR-008 — Waiting actions MUST be kept in the browser's IndexedDB, per account, so they survive a reload and are sent after it. Sign-out MUST drop the account's waiting actions.

_From 255-live-resync._

### 255-FR-009 — The queue MUST send actions in the order they were made, one at a time. It sends when an action is added, when the browser fires `online`, when a live stream opens, when the page loads, and 60 seconds after a send that kept an action. A send with no answer, or a 408, 429 or 5xx answer, keeps the action first in line, as `waiting`, and stops sending until the next of those moments. A 401 goes through the app's normal renewal and is sent once more; the answer after it counts. A 401 that survives that renewal keeps the action: the session is ending, and the sign-out drops it (FR-011's sign-out rule).

_From 255-live-resync._

### 255-FR-010 — A send answered 423, 409, 404 or any other 4xx not kept by FR-009 MUST drop the action and show a notice: the API's `detail` when it gives one, else "S-a schimbat între timp. Vezi starea de acum." for 409, "Nu mai este disponibil." for 404, and "Acțiunea nu a fost primită." for any other status. Every open live view then re-reads.

_From 255-live-resync._

### 255-FR-011 — A waiting action made more than 24 hours ago MUST be dropped without being sent, with the notice "O acțiune făcută fără semnal a expirat și nu a fost trimisă." / "An action made without signal expired and was not sent.".

_From 255-live-resync._

### 255-FR-012 — While the device is offline (the browser says so, or the offline bar shows), an action of a kind that may not wait MUST NOT be kept or sent, and the message "Ai nevoie de conexiune pentru asta" / "You need a connection for this" MUST show.

_From 255-live-resync._

### 582-FR-001 — The toast stack MUST pass axe with no violation (`list` and `aria-allowed-role` included) whenever at least one toast is shown, on every screen that mounts `hlm-toaster`.

_From 582-live-toast-axe._

### 582-FR-002 — Each shown toast MUST stay a live region: `aria-live="polite"` (`"assertive"` for an important toast) and `aria-atomic="true"` on the element that holds its text.

_From 582-live-toast-axe._

### 582-FR-003 — The toast stack MUST keep list semantics: the stack is a list and each toast one item of it.

_From 582-live-toast-axe._

### 582-FR-004 — FR-001–FR-003 MUST hold for every toast, including toasts added while others are shown.

_From 582-live-toast-axe._

### 574-FR-002 — For an owner or a receptionist who is still that garage's staff in that role (the 254 membership check, done before the table), a kind in a mapped family MUST reach the stream only when the role holds that family's capability, and a kind in no family MUST reach it. In consequence the owner still receives every kind, and a receptionist no longer receives `review.*`, `garage.updated` or `invite.*`, on top of the `price_list.*`, `member.*`, `mechanic.*`, `garage.settings_changed` and `garage.features_changed` kinds already withheld.

_From 574-live-hub-capabilities._

### 574-FR-003 — For a mechanic, a kind MUST reach the stream through the garage channel only when it is in a mapped family whose capability the mechanic holds through their permissions (`can_answer_quotes` → `request.*`, `message.*`; `can_move_bookings` → every kind starting `booking.move`, `booking.moved` included), and a kind in no family MUST NOT; a kind met on the mechanic's own `mechanic:{mechanicId}` channel, the staff-membership check and the feature switches (254 live audience: membership and feature-switch rules) are unchanged.

_From 574-live-hub-capabilities._

### 586-FR-001 — The live end-to-end suite MUST include a check in which a signed-in garage owner has the "Invită în echipă" dialog open with text typed into a text field and that field focused, and an admin sends the live test update to that account from another context; the check MUST assert that the update's line "Actualizare de test în direct" is visible on the dashboard within 2 seconds.

_From 586-live-e2e-typed-text._

### 586-FR-002 — After the update arrives, the check MUST assert, in the running application, that the dialog is still open, that the text field holds exactly the typed text, that the same field is still focused, and that no document load happened since the dashboard opened.

_From 586-live-e2e-typed-text._

### 586-FR-003 — The check MUST never submit the dialog and MUST assert that no invite request (`POST …/garages/:garageId/invites`) left the page; it changes no seeded data and needs no mailbox.

_From 586-live-e2e-typed-text._

### 586-FR-004 — The change MUST be test-only: no product code, no new dialog, and the existing live checks (two dashboards, confirm dialog, isolation between drivers) stay as they are.

_From 586-live-e2e-typed-text._

## Retired

- `253-FR-006` — superseded by `254-FR-013` (2026-10-05)

- `253-FR-012` — superseded by `257-FR-010` (2026-10-05)

- `253-FR-015` — superseded by `256-FR-011` (2026-10-05)
- `257-FR-009` — superseded by `256-FR-002` (2026-10-05)
- `257-FR-010` — superseded by `256-FR-012` (2026-10-05)

- `254-FR-003` — superseded by `574-FR-001` (2026-10-07)

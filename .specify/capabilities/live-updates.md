---
capability: live-updates
updated: 2026-10-30
features:
  - 253-live-connection
  - 254-live-audience
  - 257-live-events
  - 256-live-in-place
  - 255-live-resync
  - 582-live-toast-axe
  - 574-live-hub-capabilities
  - 586-live-e2e-typed-text
  - 419-live-garage-updates
  - 258-platform-rules-switches
  - 261-maintenance-mode
  - 260-rule-off-confirm
  - 267-brand-results
  - 1175-valkey
  - 290-save-garage
  - 049-garage-suspension
  - 270-card-pin-link
  - 172-price-list-states
  - 173-price-range-in-place
  - 1190-live-reconnects
  - 398-garage-feature-switches
  - 025-review-mechanic
  - 067-restore-suspended-garage
  - 532-lost-session-home
  - 588-live-changed-gone
  - 587-live-list-e2e
  - 413-verification-file-presence
  - 102-garage-members
  - 1193-fast-nav
  - 074-garage-reviews
  - 1263-admin-dashboard-customise
  - 1250-live-video-provider
  - 177-reported-reviews
  - 1254-assistant-approvals
  - 275-live-stage-updates
  - 427-time-blocks
  - 011-dashboard-sections
  - 1316-swr-resource-store
  - 1389-reported-reviews-admin
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

### 1190-FR-002 — Every `notification.created` message on a signed-in stream MUST name the created row's position in the SSE `id` field, so a client's `Last-Event-ID` is a position; no other message carries an `id` line (a `notification.read` moves no cursor, so a capped replay never skips unreplayed rows).

_From 1190-live-reconnects._

### 254-FR-013 — Events MUST be fanned out through one Redis pub/sub channel, each message holding the event and its audience as a list of channel keys; every API copy MUST forward an event only to its own connections whose channels meet the audience and whose role, rights and garage switches allow it (FR-003 to FR-005, FR-009), each such connection exactly once.

_From 254-live-audience._

### 1190-FR-006 — The server MUST send `retry: 3000` when a signed-in stream opens, a comment line after 25 seconds without data (as today), and MUST end a signed-in stream it has held for 14 minutes with a final message of kind `reconnect` (a planned close, not a `bye`); the interval MUST be settable for tests. The web client MUST honour the `retry` value as the delay of its first reopen after an unplanned drop.

_From 1190-live-reconnects._

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

### 1190-FR-007 — The web app MUST hold one signed-in live stream per browser and role: the tab that wins the browser lock named for the account and role opens the stream and fans every message, state change and resync out to the other tabs of that account and role over the browser channel; a tab that does not hold the lock opens no stream and exposes the same events, state, offline signal and resync as if it did. The holder releases the lock only when its tab closes or hides, it is evicted or stops, or the browser goes offline; a transient drop or a token renewal keeps the lock and fans out `reconnecting`. On release and the next tab takes it over within 3 seconds, opening from the latest position any tab saw.

_From 1190-live-reconnects._

### 253-FR-014 — After `bye` with reason `expired` or `shutdown`, the web app MUST renew the access token through the normal refresh and reconnect within 3 seconds; after `evicted`, after sign-out, or when the renewal fails it MUST NOT reconnect.

_From 253-live-connection._

### 256-FR-011 — Every dashboard (driver; garage, serving owner, receptionist and mechanic; admin) MUST show the epic's test update on the status line under its header, "Actualizare de test în direct · <time>" / "Live test update · <time>", changed in place in the person's language, and MUST raise no toast for it.

_From 256-live-in-place._

### 419-FR-006 — The audience resolver MUST name the public channels with their ids: a review's audience is the garage, the author, `public:garage:{garageId}` and `public:mechanic:{mechanicId}` when the review names a mechanic (today it names bare `public:garage` and `public:mechanic`); an approval's published audience is `public:garage:{garageId}` and `public:search` (today it carries an empty brand list); a garage's public change (`garage.updated`, `garage.suspended`, `garage.restored`, `price_list.updated`, `facility.removed`, `facility.re_add_decided`, `mechanic.updated`, `garage.slots_changed`) is the garage's staff channel, `public:garage:{garageId}` and, for `garage.updated`, `garage.suspended` and `garage.restored`, `public:search`; a brand-stance change keeps `public:search:{brandId}` for each changed brand (254-FR-001 modified; the `garage_brands` subject unchanged).

_From 419-live-garage-updates._

### 254-FR-002 — An API copy MUST drop and log an event whose audience is empty, and MUST NOT forward it to any connection.

_From 254-live-audience._

### 102-FR-010 — The live filter of `garage:{garageId}` MUST keep deriving from the shared table (398-FR-008): owner and receptionist receive every garage event their row allows, a mechanic receives their own bookings and jobs (the `mechanic:` channel) plus the inbox kinds only with `can_answer_quotes`, everyone receives `garage.features_changed` and `mechanic.updated` about themselves, and `invite.*` and `member.removed` reach the owner only. The `booking.move*` family MUST map to `garage.move_bookings`. A test MUST show a mechanic receiving nothing about another mechanic's booking and an owner receiving it.

_From 102-garage-members._

### 254-FR-004 — A garage-staff connection MUST receive through `garage:{garageId}` or `mechanic:{mechanicId}` only while its account is still that garage's staff in the role of the connection (owner or receptionist membership, or the mechanic record).

_From 254-live-audience._

### 1250-FR-013 — An event of a feature the garage switched off MUST NOT be forwarded to that garage's staff connections: `media.*` and `live.*` kinds belong to `live_media`; a garage with no row for a feature has it on.

_From 1250-live-video-provider._

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

### 025-FR-009 — When a recalculation changed a garage's or a mechanic's figures, it MUST record, in the same transaction as that write, one event per changed subject of a new kind `rating.updated` (added to the typed catalogue, 257-FR-006) whose payload names the garage and the mechanic whose figures changed, and whose audience is `garage:{garageId}`, `public:garage:{garageId}`, `public:search` and, when a mechanic changed, `public:mechanic:{mechanicId}`, and which joins the live hub's public allow-lists for those three channel kinds; the open pages on those channels re-read and the cached public reads and searches of the garage are purged through the existing purge by audience (1182-FR-007). When nothing changed, no event is recorded.

_From 025-review-mechanic._

### 257-FR-007 — The relay MUST delete relayed rows older than 7 days, and MUST log an error when the oldest waiting row is older than 30 seconds, at most once every 30 seconds.

_From 257-live-events._

### 257-FR-008 — The web app's live service MUST let a view subscribe to a list of kinds, optionally for one object id, and receive only the matching events.

_From 257-live-events._

### 1316-FR-002 — Each resource type MUST declare its own stale time; when a view opens and the held value's age (measured from the time its last full read answered) is equal to or greater than its type's stale time, the app MUST read the resource again in the background, the held value staying on screen until the answer replaces it in place (256-FR-001's structural sharing); when the held value is younger, the view's open MUST start no read. The stale time gates only that read: re-reads caused by live events, a reconnect, the polling state or a failed read's retry keep their own rules (FR-003, FR-004).

_From 1316-swr-resource-store._

### 257-FR-011 — Account sign-up (`account.created`) and sign-out everywhere (`account.signed_out_everywhere`) MUST record their events through the outbox, with the account as their subject.

_From 257-live-events._

### 256-FR-001 — A re-read is merged into the view's value by structural sharing. Equal objects and rows (rows matched by `id`) keep their previous reference, and an equal result leaves the value unchanged.

_From 256-live-in-place._

### 256-FR-003 — A background re-read that fails leaves the last value on screen and shows no error. The view re-reads on the next event, or 60 seconds after the failure, whichever comes first.

_From 256-live-in-place._

### 588-FR-006 — When the request drawer has shown a request and a re-read answers 404, it MUST keep the request's detail on screen and show the text `shell.live.gone` as its banner (the place the close-reason banner takes), with Trimite oferta and Refuză disabled; it MUST NOT close, empty or replace what it showed. The gone banner replaces any close-reason banner (one banner) and is announced like it (the existing banner's `role="status"`).

_From 588-live-changed-gone._

### 256-FR-005 — A live update never reloads the page, changes the route, closes a dialog, drawer or sheet, or moves focus.

_From 256-live-in-place._

### 588-FR-004 — The line MUST go when the row's range on the list equals the range the form was last filled from again. The 409 re-read that refills the form makes the re-read range the one the form was filled from, so the line goes once the list shows it; while the list still shows a row older than that re-read (by `updatedAt`), no line names that older range.

_From 588-live-changed-gone._

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

### 586-FR-001 — The live end-to-end suite MUST include a check in which a signed-in garage owner has the "Invită în echipă" dialog open with text typed into a text field and that field focused, and an admin sends the live test update to that account from another context; the check MUST assert that the update's line "Actualizare de test în direct" is visible on the dashboard within 2 seconds.

_From 586-live-e2e-typed-text._

### 586-FR-002 — After the update arrives, the check MUST assert, in the running application, that the dialog is still open, that the text field holds exactly the typed text, that the same field is still focused, and that no document load happened since the dashboard opened.

_From 586-live-e2e-typed-text._

### 586-FR-003 — The check MUST never submit the dialog and MUST assert that no invite request (`POST …/garages/:garageId/invites`) left the page; it changes no seeded data and needs no mailbox.

_From 586-live-e2e-typed-text._

### 586-FR-004 — The change MUST be test-only: no product code, no new dialog, and the existing live checks (two dashboards, confirm dialog, isolation between drivers) stay as they are.

_From 586-live-e2e-typed-text._

### 419-FR-001 — The API MUST serve a public server-sent events stream at `GET /api/v1/live/public`, open to anyone with no session (`@Public()`, listed with the public routes), with `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`; `hello` with a connection id first, a comment line after 25 seconds without an event, and `bye` with reason `shutdown` before the API copy ends it. It never reads an access token, never expires with one and never evicts for an account.

_From 419-live-garage-updates._

### 267-FR-018 — The page MUST open the public live stream with `garages` naming every loaded garage and `brand` naming the brand; the stream (419-FR-002) MUST accept up to 20 garage ids (one page) instead of one, joining `public:garage:{id}` for each that is public; a reopen when the loaded set changes follows 419-FR-008.

_From 267-brand-results._

### 419-FR-003 — A public stream MUST join `system`, plus `public:garage:{garageId}` when the id names an approved garage, `public:mechanic:{mechanicId}` when the id names a mechanic of an approved garage (no hidden state exists yet; the mechanic-page story adds that check), and `public:search:{brandId}` together with the all-brands results channel `public:search` when the id names a brand of the catalogue (retired brands included); an id that names nothing, or a garage that is not approved, MUST be ignored silently: the stream opens, joins nothing for it and answers exactly as for an unknown id.

_From 419-live-garage-updates._

### 419-FR-004 — A public stream MUST receive only the public kinds: through `public:garage:{garageId}` — `garage.updated`, `price_list.updated`, `mechanic.updated`, `facility.removed`, `facility.re_add_decided`, `review.posted`, `review.edited`, `review.deleted`, `review.replied`, `review.reply_edited`, `review.reported`, `review.decided`, `review.appeal_decided`, `garage.suspended`, `garage.restored` and `garage.slots_changed`; through `public:mechanic:{mechanicId}` — `mechanic.updated` and the same review kinds; through `public:search` — `verification.decided`, `garage.suspended`, `garage.restored` and `garage.updated`; through `public:search:{brandId}` — `garage.updated`; through `system` — the platform kinds every connection gets. Any other kind MUST NOT reach a public connection, whatever audience the publisher named (an allow-list on the public keys, keeping 254-FR-009's rule as a consequence).

_From 419-live-garage-updates._

### 419-FR-005 — Every message of a public stream MUST be `{ kind, id, at }` and nothing else, the `id` being the garage, mechanic, review, verification file or garage the kind is about; no personal data, no account id and no payload travels on it (253-FR-005 holds for the public stream).

_From 419-live-garage-updates._

### 419-FR-007 — One address MUST hold at most 20 public streams on one API copy; the 21st MUST be refused with 429 and code `too_many_streams`, and a closed stream frees its place; when the address cannot be read the limit MUST be skipped and logged, never refusing a visitor for it. A request refused with 400 is judged before the limit and never holds a place; a refused 429 holds none either.

_From 419-live-garage-updates._

### 1193-FR-001 — The public pages' live stream (`apps/web/src/app/public/live.ts`) MUST abort its stream on `pagehide`, leaving the page with no open request, and MUST want it again on `pageshow`, reopening from its current query; the reopen MUST trigger the views' re-read (the existing resync), so a page restored from the back/forward cache shows fresh data. The dashboard stream's existing behaviour (1190-FR-009) is unchanged. Modifies 419-FR-008 (`pagehide` joins the closes and `pageshow` the reopens of the public connection).

_From 1193-fast-nav._

### 419-FR-009 — The web app MUST offer a public live view helper, built on the in-place helper of 256-FR-001 to 256-FR-004: it loads its data through the API, re-reads once when the stream first opens (to cover a page served from a cache) and whenever a stream opens again after a drop, re-reads when an event of its kinds about its object arrives, coalesces events within 300 ms into one re-read, runs one read at a time, merges by structural sharing, keeps its last value and shows no error on a failed re-read and arms no retry timer (256-FR-003 without its 60-second retry: the next event or reopen re-reads), and marks the view `gone` on 404 or 410.

_From 419-live-garage-updates._

### 267-FR-019 — On a review kind, `garage.updated` or `garage.restored` about a loaded garage, the page MUST re-read those cards through `ids=` and change them in place (rating, dial, review count, lamp, lists, facilities, rate) without re-ordering the list and without a reload; `garage.suspended` about a loaded garage MUST fade its card out over 300 ms (at once with reduced motion), remove it and lower the counts by one. The 300 ms coalescing, one-read-at-a-time and structural-sharing rules of 419-FR-009 hold. 419-FR-010 is modified: a results view no longer re-reads its whole list on a garage event.

_From 267-brand-results._

### 419-FR-011 — The stream, the connection and the helper MUST write nothing: no row, no audit entry, no event, no search log; the only reads are the public garage, mechanic and search APIs on re-read and, at open, the garage's, mechanic's and brand's existence.

_From 419-live-garage-updates._

### 419-FR-012 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the stream opening with no sign-in and its headers, `hello` and heartbeat; the parameter limits (400); a draft, suspended and unknown id ignored alike; each public kind reaching the channel FR-004 names; every private family and every non-public kind blocked from every public key; the results channel receiving approval, suspension, restoration and `garage.updated` for any garage and a brand's stance change for that brand only; the 21st stream answering 429 and a freed place reopening; the public route listed in `public-routes.integration.spec.ts`. Web unit tests MUST cover the connection's open-and-close with views, the parameters it sends, no stream on the server, no polling and no error on failure, and the helper's re-read rules (FR-009, FR-010). The Playwright scenarios of the brief (a review posted in one context updating an open profile in another; a suspension showing the "no longer available" state) run when the garage profile page and the review use case exist, in those stories (Assumptions).

_From 419-live-garage-updates._

### 258-FR-006 — The `platform_rule.changed` event MUST reach every open admin Setări view on the `admin` channel, and the view MUST re-read the rules and show the new state without a reload; only a change of `maintenance_mode` MUST also go out on the `system` channel to every connection.

_From 258-platform-rules-switches._

### 261-FR-009 — An open screen MUST switch to the maintenance page without a reload within 5 seconds of `platform_rule.changed` for `maintenance_mode` arriving on the `system` channel, and MUST return to the address the person was on, without a reload, within 5 seconds of the change to off. On each such event the app re-reads `GET /api/v1/platform-status` and acts on that answer, not on the event's payload, so a quick on-off ends in the last state. While the page shows, the screen under it is kept, so unsaved form text is there when it returns.

_From 261-maintenance-mode._

### 260-FR-007 — `platform_rule.change_requested` and `platform_rule.change_decided` MUST reach every admin's open Setări view on the `admin` channel and no other channel; the view MUST re-read the rules and the requests and show the new state without a reload. The `platform_rule.changed` of an approval follows 258-FR-006 (the `admin` channel).

_From 260-rule-off-confirm._

### 267-FR-020 — On `verification.decided`, `garage.updated`, `garage.restored` or `garage.suspended` about a garage not loaded, or a brand-stance change for the brand, the page MUST re-read the counts (the first page's counts, uncached after FR-010); when the total rose a "Reîncarcă" chip MUST appear and the list MUST change only when it is tapped (re-reading the first page, not logged); when the total fell, or stayed the same with a different split, the counts change in place.

_From 267-brand-results._

### 267-FR-021 — A changed value is highlighted for 1 second (none with reduced motion) and announced politely, and no live update reloads the page, changes the route or moves focus (256-FR-005, FR-009, FR-010).

_From 267-brand-results._

### 1175-FR-009 — The clients MUST run on ioredis's default protocol (RESP3, `replyMapping: "legacy"`): no client pins `protocol`, except the live subscriber, which MUST be pinned to `protocol: 2` if and only if a live-update test (publisher, subscriber and relay specs in Jest; the web-e2e live scenarios) fails twice under RESP3 against Valkey 9 and passes under `protocol: 2` on the same head; the pin, when made, carries a comment naming the failing case and the plan records it.

_From 1175-valkey._

### 290-FR-008 — In the same transaction the system MUST hand `saved_garage.added` and `saved_garage.removed` (both already in the contracts' event kinds) to the event port with `{ accountId, garageId, savedAt }`; an idempotent save and a removal of nothing emit nothing. Their audience MUST be `account:{accountId}` alone (the live-updates audience resolver learns the two kinds); no garage, mechanic or public channel ever receives them, and nobody is notified.

_From 290-save-garage._
### 067-FR-007 — The `garage.restored` event MUST reach, through the existing audience resolver (049-FR-007's audience for the pair): the garage's staff channel `garage:{garageId}`, `public:garage:{garageId}`, `public:search` and `admin`. On it: an open results page re-reads its counts and map pins without a reload, as it does today for any garage it has not loaded (`results.ts` `heard`: a card is added only by a new search, never pushed into the shown list), so the restored garage's card shows on the next search; the Service-uri counts line, the suspended panel and the re-check list re-read (066-FR-008, 1351-FR-010, existing) and an open file drawer re-reads the file; the garage dashboard MUST re-read the session's garage and drop the red suspension banner without a reload (049-FR-012 names `garage.suspended` only; `garage.restored` joins its list) and the legal panel re-reads its date.

_From 067-restore-suspended-garage._

### 270-FR-006 — When the selected garage's card fades out (267-FR-019) the selection MUST pass to the first card left in the list (none when the list is empty); a pointed garage whose card fades out MUST stop being pointed.

_From 270-card-pin-link._

### 172-FR-007 — The view MUST be live as the dashboard's other views are: it re-reads on `price_list.updated` and `catalogue_job.decided` events of its garage and on every resync, with a 300 ms burst as one re-read; `price_list.updated` already reaches the owner's stream through the garage channel (386-FR-010, the hub's `garage.prices` family); `catalogue_job.decided`, once a story emits it, MUST reach the garage's stream for the owner through the same `garage.prices` family: this story adds `/^catalogue_job\./ → garage.prices` to the hub's family table (`KIND_CAPABILITY`), so a receptionist or mechanic does not hear it. A re-read that fails keeps the rows shown. A failed read is tried again by itself after 60 seconds (`liveView`'s `retryAfter`), as the dashboard's other live views do.

_From 172-price-list-states._

### 173-FR-009 — Each write that changed something MUST emit, in the same transaction through the outbox, one `price_list.updated` event with `garageId`, `jobTypeIds` (the job, or `[]` for labour) and `brandIds` (`[]` for a default row or labour), so the open profile (`public:garage:{garageId}`) and other open Prețuri views (`garage:{garageId}`, the `garage.prices` holders) re-read; the live hub's existing mapping carries it. It MUST drop the garage's brandless public profile cache key (the relay's purge covers the brand variants), so the next profile read answers the new range at once. It notifies nobody.

_From 173-price-range-in-place._

### 1190-FR-003 — A signed-in stream opened with `Last-Event-ID: <position>` (or `?since=<position>`, the header winning when both are present) MUST, after `hello`, replay the account's in-app notifications with a position greater than it, oldest first, at most 200, each as a `notification.created` message carrying the unread count read at replay time, before any live event of any kind (every live event arriving during the replay is held and sent after it); a missing, non-numeric, non-positive or foreign position replays nothing. The rows are read from PostgreSQL (the log); Redis stays the wake-up only.

_From 1190-live-reconnects._

### 1190-FR-004 — A live `notification.created` whose position is not above the last replayed one MUST be dropped on that stream, and one arriving during the replay MUST be delivered after it, so the stream delivers each notification once and in order.

_From 1190-live-reconnects._

### 1190-FR-008 — Every tab MUST keep the latest position it has seen (its own or fanned out), and every stream the client opens after a first one MUST name it (`Last-Event-ID`); a `reconnect` message MUST be followed by a reopen at once, with no backoff and no token renewal, at most once a minute per connection (a second `reconnect` within a minute of the last reopen at once waits the backoff a failure would), and every reconnect keeps re-reading the open views (255-FR-004 unchanged: replay covers the bell, not the screens).

_From 1190-live-reconnects; modified by 1190-reopen-cap._

### 1190-FR-009 — On `pagehide` the tab MUST close its stream (releasing the browser's lock when it holds it) and keep no open request, so the page is eligible for the back/forward cache; on `pageshow` it MUST want the stream again, taking the lock if free, from its latest position.

_From 1190-live-reconnects._

### 1190-FR-010 — Where the browser has no lock or cross-tab channel, each tab MUST open its own stream as today (253-FR-013's behaviour), with the position rules of FR-008.

_From 1190-live-reconnects._

### 1190-FR-012 — The signed-in and the public stream MUST answer `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, never a `Content-Encoding`, and the live paths MUST fall under the CDN's no-cache rule for `/api/*` (`infra/cdn/bunny.json`); a test MUST assert each.

_From 1190-live-reconnects._

### 1190-FR-013 — In the specs repo, MF-52's Build brief MUST say one stream per browser with a leader tab and replay of notifications from the last position (Final rules 1, Edge cases "Many tabs", "A proxy buffers the stream", "The access token expires"), its "Data and events" channel list MUST name `public:search`, `public:search:{brandId}`, `public:garage:{garageId}` and `public:mechanic:{mechanicId}` matching `PublicLiveController.channels()`, the front-end architecture page MUST agree, `node scripts/docs-lint.mjs` MUST pass and `llms.txt` MUST hold every page's current summary (from #621).

_From 1190-live-reconnects._

### 1190-FR-015 — Tests MUST cover: in Jest on real PostgreSQL and Redis, a stream dropped, five notifications created, a reconnect with the last position receiving all five in order with the right count, a foreign and a missing position replaying nothing, the 200 cap, the count kept across create, read and read-all in one transaction, the `retry` line, the heartbeat and the planned `reconnect` close with a shortened interval, and the headers and no-compression rule for both streams; in web unit tests, the lock holder and follower roles, the position kept and sent, the reopen on `reconnect` without backoff and the backoff on a second `reconnect` within a minute, `pagehide`/`pageshow`, and the fallback without the primitives; in Playwright, two tabs of one browser holding one stream and both showing a test update within 2 seconds, and the stream moving when the holder closes.

_From 1190-live-reconnects; modified by 1190-reopen-cap._

### 532-FR-004 — After a lapse, a sign-in as the same account MUST send the kept actions in order; a sign-in as another account MUST NOT send them and drops them.

_From 532-lost-session-home._

### 532-FR-003 — A refused renewal (a lapse) MUST NOT drop the account's waiting actions; only a real sign-out (this tab's sign-out, sign-out on all devices, a `session.revoked` message, a sign-out in another tab) drops them (refines 255-FR-008: a lapse is not a sign-out).

_From 532-lost-session-home._

### 532-FR-005 — Each send of the waiting queue MUST be bounded at 30 seconds; a send that has no answer by then is treated as a send with no answer under 255-FR-009: the action is kept first in line as `waiting`, the request is aborted, and the line stops until the next sending moment (60 s after the attempt ends, an `online` event, a live stream opening).

_From 532-lost-session-home._

### 588-FR-001 — While the price range editor is open on a job's own row, it MUST see that row as the live price list currently shows it (a `shown` signal of that row, required on the kind `row` data and handed over by the list), so a re-read of the list reaches the open editor; it sees no other row and opens no live read of its own.

_From 588-live-changed-gone._

### 588-FR-002 — When the row's range (both ends and the duration) on the live list differs from the range the form was last filled from, the editor MUST show the text `shell.live.changed` under the range fields, driven by `liveDraft(…).changed()` over the shown range compared by range, its value being the new range written as the Prețuri list writes it (`formatWholeLeiRange`; an open top as `garage.prices.from`), followed by " · " and the new duration as `formatDuration` writes it when the row has one. The line is `role="status"` and is announced once.

_From 588-live-changed-gone._

### 588-FR-003 — The line MUST NOT write into any field: what the person typed, and what the form was filled with, stay as they are until the person changes them or the existing 409 re-read refills the form.

_From 588-live-changed-gone._

### 588-FR-005 — A re-read that changes only other fields of the row (visibility, state, brand ranges) or other rows MUST show no line; the editor open for a brand range, the labour rate, a new job or a proposal shows no line and is otherwise unchanged.

_From 588-live-changed-gone._

### 588-FR-007 — When the drawer's very first read answers 404 (nothing shown yet), it MUST keep today's `garage.requests.detail.notFound` refusal.

_From 588-live-changed-gone._

### 588-FR-008 — When a later re-read answers the request again, the gone banner MUST go and the drawer MUST behave as before it.

_From 588-live-changed-gone._

### 588-FR-009 — Unit specs MUST cover FR-002 to FR-008 in Romanian and in English, asserting the rendered texts, and MUST prove that each of `shell.live.changed` and `shell.live.gone` is rendered by at least one screen.

_From 588-live-changed-gone._
### 587-FR-001 — The live end-to-end suite MUST include a check in which a signed-in garage owner has the garage's quote requests list (a live list that already uses `liveRows`, `LivePill` and `LiveAnchor`) open at a phone-size viewport, scrolled so the top of the list is off screen, and a driver creates a request for that garage from another context; the check MUST assert that the pill is inside the viewport within 5 seconds of the request's 201 with a count of at least 1, and that no pill showed before that request.

_From 587-live-list-e2e._

### 587-FR-002 — Across that arrival, the check MUST assert that the first row that was on screen before the request keeps its on-screen position within 1 px, and that the new request's row is absent from the list (no element with its `data-live-id`) until the pill is clicked.

_From 587-live-list-e2e._

### 587-FR-003 — The check MUST click the pill and assert that the new request's row is then in the list and inside the viewport.

_From 587-live-list-e2e._

### 587-FR-004 — No product change MUST be needed for the check to pass (a product bug it exposes is fixed in this pull request with its own test); the existing live checks (two dashboards, confirm dialog, typed text, the garage's requests arriving live) stay as they are; the check creates the rows it needs, waits on visible elements and polled conditions only, and tolerates rows added to the same garage by other workers.

_From 587-live-list-e2e._

### 413-FR-007 — When an admin's entry is created or removed by a call, the system MUST publish a `presence.changed` message with the file's id straight to the live stream, to the `admin` audience, through the existing direct publish (not the outbox); a heartbeat that only renews an entry and an expiry publish nothing. `presence.changed` stays out of the shared list of event kinds (`EVENT_KINDS` holds the outbox kinds; its header already names presence among the kinds published straight to the store), as `session.revoked` and `notification.created` do; the drawer reads it from the stream's messages by kind and file id (plan, research R3).

_From 413-verification-file-presence._

### 074-FR-006 — The panel and the view MUST re-read, without a reload and without issuing any scroll-to-top, on any `review.posted`, `review.edited`, `review.deleted`, `review.replied`, `review.reply_edited`, `review.reported`, `review.decided`, `review.appeal_decided` or `rating.updated` message for the garage on `garage:{garageId}`, which the owner's and the receptionist's connections MUST receive, and on the live client's reconnect resync; the view re-reads its first page and drops the extra pages (024-FR-011). One read at a time, coalesced as 419-FR-009. The hub already lets these kinds through `garage:{garageId}` to the owner and the receptionist and to no mechanic (`live.hub.ts` `KIND_CAPABILITY`, 102-FR-010 unchanged); FR-017 proves it.

_From 074-garage-reviews._

### 1263-FR-007 — A save (FR-004) and a reset (FR-005) MUST write the `dashboard_layout.updated` event (`accountId`, `role`) in the same transaction as the record (the outbox, Principle VI), with the audience `account:{accountId}` only, so the person's other open tabs and devices receive it on their signed-in stream; nobody is notified, and no audit entry is written (a personal view preference, as MF-32).

_From 1263-admin-dashboard-customise._

### 1389-FR-006 — (from 177-FR-010, its web part; modifies 177-FR-010) The view, the panel, the counter and the tile MUST re-read on `review.reported`, `review.decided`, `review.deleted` and `review.report_closed` arriving on the admin's live connection, so a new item is on screen within 5 seconds and a decided, deleted or closed one leaves within 5 seconds, and MUST re-read when the connection resyncs after a loss; these review kinds, and no other review kind, reach the `admin` channel, carrying the same event payload the review audiences receive and nothing more (built by ST-177, unchanged here: the reporter, the reason and the facts stay in the admin-only read); the queue and the overview re-read through the dashboard's shared live re-read, so a re-read keeps the items and numbers already shown until the new ones arrive (no skeleton flash), events within 300 ms cause one read, and a failed re-read keeps what is shown; the first read of the queue shows skeletons in the view and the panel; a failed first read shows "Nu am putut citi recenziile raportate." / "Could not read the reported reviews." with a "Reîncearcă" / "Retry" button that reads again. The view and the panel add no polling and no cache.

_From 1389-reported-reviews-admin._

### 427-FR-010 — Each write MUST record its event in the same transaction through the outbox (257-FR-001): `time_block.created`, `time_block.updated` (added to the kinds), `time_block.deleted`, subject `time_block` with `blockId`, `garageId`, `mechanicId`, `lift`, `startsAt`, `endsAt` in the payload and never the note; the audience resolver gains the `time_block` subject: `garage:{garageId}`, `mechanic:{mechanicId}` when set, `public:garage:{garageId}` (so open profiles re-read their free slots; the public stream carries the kind and the id only, as every event). The live hub MUST deliver the three kinds to the owner and a receptionist and, through her `mechanic:` channel, to the mechanic (as it does the unclaimed `booking.confirmed`: no `KIND_CAPABILITY` entry is added, plan.md R4), and the `public:garage:` allow-list gains the three kinds. Nobody is notified.

_From 427-time-blocks._

### 011-FR-009 — Panou MUST re-read the person's layout on `dashboard_layout.updated` from `account:{accountId}` (1263-FR-007) and follow the answer within 5 seconds without a reload, except while one of its own saves is in flight, when the event is ignored and the save's answer is the truth: a section hidden in another tab or on another device leaves, the count follows, and an open panel shows the new switch states. This story adds no event, sender, audience, channel or endpoint; it joins the account stream the frame already holds.

_From 011-dashboard-sections._

### 1254-FR-010 — The signed-in frame (once, in the frame every `/app` area shares, else once per area frame) MUST show, for an account with pending approvals,, above the view, the strip "n acțiuni așteaptă aprobarea ta" / "n actions await your approval" (Romanian plural rules: "1 acțiune", "2 acțiuni"; absent at 0) linking to the oldest pending approval's sheet; after a decision the sheet shows the next pending one or closes. The strip and an open sheet MUST re-read on `assistant_approval.requested` and `assistant_approval.decided` received on the account's live stream, so every open tab updates without a reload. The strip is one component with one mount line, so ST-368 moves it into the Asistent AI view. (AC 6; brief Live updates; build plan ST-376 ↔ ST-368)

_From 1254-assistant-approvals._

### 275-FR-004 — The driver's tracker MUST hear about a job through the audience its events already carry, `account:{driverAccountId}`, with the garage's staff through `garage:{garageId}` and the job's mechanic through `mechanic:{mechanicId}` (254-FR-001, 276-FR-007); no client joins a job channel and no other account's stream receives the job's, its booking's or its quotes' events. This is the brief's `job:{jobId}` realised on the server (Assumptions), and a test proves it (FR-009).

_From 275-live-stage-updates._

### 1316-FR-003 — A background read that fails MUST leave the held value on screen and show no error; the view MUST re-read on the next event or after 60 seconds, as 256-FR-003 says.

_From 1316-swr-resource-store._

### 1316-FR-004 — A re-read caused by a live event, a reconnect or the polling state (256-FR-002, 255-FR-003, 255-FR-004) MUST update the held value, so that every view showing that resource changes in place and the next visit shows the re-read's answer.

_From 1316-swr-resource-store._

### 1316-FR-008 — The store MUST read personal resources only through the signed-in API calls the views make today; the API's answer to each of these reads (`GET /api/v1/cars`, `GET /api/v1/requests`, `GET /api/v1/quote-requests/active`, `GET /api/v1/garage/requests`) MUST carry `Cache-Control: private, no-cache` (the existing rule of the cache interceptor for every read made with a session), so that no edge or CDN cache can hold or serve a copy.

_From 1316-swr-resource-store._

### 1316-FR-009 — The store MUST keep its copy in the page's memory only: nothing is written to local storage, session storage, IndexedDB or a cookie, and a page reload starts from an empty store (ST-1330 owns the copy kept across reloads).

_From 1316-swr-resource-store._

### 1316-FR-010 — Tests MUST cover, in Jest: a return within the stale time shows the held value and starts no read; a return past the stale time shows the held value and starts one read whose answer replaces it; two resource types with different stale times behave by their own; a failed background read keeps the held value; a live-event re-read replaces the held value for every view showing it, whatever the stale time; the store writes nothing to local storage, session storage, IndexedDB or cookies; an answer arriving after the account changed is dropped; a car added, edited and removed on one view is what another view shows next; sign-out, a revoked session, a sign-in of account B after account A and a role switch each leave the store empty, with the A-then-B test proving none of A's data is held or shown after B signs in; and the four routes' signed-in answers carry `private, no-cache`.

_From 1316-swr-resource-store._

## Retired

- `253-FR-006` — superseded by `254-FR-013` (2026-10-05)
- `253-FR-012` — superseded by `257-FR-010` (2026-10-05)
- `253-FR-015` — superseded by `256-FR-011` (2026-10-05)
- `257-FR-009` — superseded by `256-FR-002` (2026-10-05)
- `257-FR-010` — superseded by `256-FR-012` (2026-10-05)
- `254-FR-003` — superseded by `574-FR-001` (2026-10-07)
- `254-FR-001` — superseded by `419-FR-006` (2026-10-07)
- `419-FR-002` — superseded by `267-FR-018` (2026-10-14)
- `419-FR-010` — superseded by `267-FR-019` (2026-10-14)
- `253-FR-013` — superseded by `1190-FR-007` (2026-10-19)
- `253-FR-007` — superseded by `1190-FR-006` (2026-10-19)
- `253-FR-005` — superseded by `1190-FR-002` (2026-10-19)
- `574-FR-001` — superseded by `398-FR-008` (2026-10-22)
- `574-FR-002` — superseded by `398-FR-008` (2026-10-22)
- `574-FR-003` — superseded by `398-FR-008` (2026-10-22)
- `257-FR-006` — superseded by `025-FR-009` (2026-10-23)
- `254-FR-001` — superseded by `025-FR-009` (2026-10-23)
- `049-FR-007` — superseded by `067-FR-007` (2026-10-23)
- `256-FR-006` — superseded by `588-FR-004` (2026-10-24)
- `256-FR-004` — superseded by `588-FR-006` (2026-10-24)
- `398-FR-008` — superseded by `102-FR-010` (2026-10-25)
- `419-FR-008` — superseded by `1193-FR-001` (2026-10-25)
- `254-FR-005` — superseded by `1250-FR-013` (2026-10-26)
- `256-FR-002` — superseded by `1316-FR-002` (2026-10-30)
- `177-FR-010` — superseded by `1389-FR-006` (2026-10-30)

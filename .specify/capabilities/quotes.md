---
capability: quotes
updated: 2026-10-17
features:
  - 220-requests-quotes-bookings
  - 221-quote-request
  - 343-live-quote-requests
  - 344-send-quote
  - 030-new-account-empty-states
  - 345-decline-request
  - 1025-answers-same-day
  - 357-public-price-jobs
  - 347-read-request
  - 222-booking-from-quote
  - 1169-prefetch-intent
  - 049-garage-suspension
  - 313-compare-quotes
---

# Capability: Quotes

The request flow's shared data: a driver's quote request to several garages, the garages' quotes, the booking an accepted quote becomes, their statuses and allowed moves, the constants, and the read endpoints of both sides.

## Requirements

### 221-FR-008 — The send MUST be idempotent per driver: a QUOTE_REQUEST stores the key (a new column, unique with the driver), and a second call with the same key and driver MUST answer the same status and body as the first without writing anything; a different key creates a new request. The replay is by key alone: a second call with the same key and a different body still answers the first answer and writes nothing. A refused call (400, 404, 429) stores nothing, so its key stays free and a retry with it is judged afresh. The web app sends the key the form-saving helper issues per dialog, and a retry after a network failure reuses it.

_From 221-quote-request._

### 220-FR-002 — A request's status MUST be one of `sent`, `quoted`, `booked`, `in_work`, `done`, `closed`; `closed_reason` MUST be one of `expired`, `cancelled`, `booking_lapsed`, `booking_cancelled`, `no_show`, `account_closed`, set together with `closed_at` exactly when the request is `closed`, and absent otherwise.

_From 220-requests-quotes-bookings._

### 220-FR-003 — The system MUST provide one label map, in the contracts library so both apps read it, giving each request status its Romanian and English label for the driver: `sent` Trimisă / Sent, `quoted` Ofertă / Quote received, `booked` Programată / Booked, `in_work` În lucru / In progress, `done` Gata / Done, `closed` Încheiată / Closed; the map covers every status and nothing else (a test fails when a status is added without a label).

_From 220-requests-quotes-bookings._

### 345-FR-006 — REQUEST_RECIPIENT MUST gain `decline_told_at` (timestamp, null until the decline's window has been handled once, whether a message went, the request was closed or every channel was muted; only ever set when `declined`), cleared together with the other decline columns by the `declined` → `waiting` undo move (220-FR-008); the migration adds it with no backfill.

_From 345-decline-request._

### 220-FR-005 — A QUOTE MUST store: request, recipient, garage, `from_bani`, `to_bani`, `duration_minutes`, `slot` (the proposed start, timestamp with time zone), `note` (optional), status ∈ `waiting`, `accepted`, `withdrawn`, `expired`, `lost`, `declined_by_driver`, `sent_at`, `changed_at`, `withdrawn_at`, `expires_at` (= `sent_at` + QUOTE_VALIDITY_DAYS, counted as for the request, stored UTC), `accepted_at`; one QUOTE_JOB per requested job (quote, request job, `included` true or false, so the driver sees which jobs the garage left out). The database MUST refuse a quote without `from_bani`, `to_bani`, `slot` or `duration_minutes`, one with `from_bani` ≤ 0, `to_bani` < `from_bani` or `duration_minutes` ≤ 0.

_From 220-requests-quotes-bookings._

### 220-FR-006 — A BOOKING MUST store: quote, request, garage, driver, `starts_at` (the quote's slot at creation), `duration_minutes`, status ∈ `awaiting_confirmation`, `confirmed`, `lapsed`, `cancelled`, `no_show`, `completed`, `confirm_by` (set at creation: the earlier of `created_at` + BOOKING_CONFIRM_LAPSE_HOURS and `starts_at`), `confirmed_at`, `confirmed_by`, `mechanic_id` (optional until confirmation), `lift` (optional integer, the lift's number), `move_count` (integer, default 0, at most BOOKING_MAX_MOVES; written by the move story), `history_shared` (default false), `cancelled_at`, `cancelled_by_side` ∈ `driver`, `garage`, `system`, `cancelled_by` (account, absent for `system`), `cancel_reason` (one of CANCEL_REASONS for the side, or `garage_suspended` / `driver_account_closed` for `system`), `cancel_note` (optional), `late_cancellation` (default false), `no_show_at`, `no_show_recorded_by`, `completed_at`, `created_at`; one booking per quote (FR-009). `completed` is set at handover (`job.handed_over`), never when the job is merely done.

_From 220-requests-quotes-bookings._

### 220-FR-008 — The system MUST hold, in one place per entity, the transition tables of the feature's state diagrams and refuse every other move with a domain error that carries the entity, the current status and the asked status, which the API answers as 409 problem details with code `invalid_transition` and the current status in the body. The allowed moves are, QUOTE_REQUEST: `sent`→`quoted`, `sent`→`closed`, `quoted`→`booked`, `quoted`→`closed`, `booked`→`quoted`, `booked`→`in_work`, `booked`→`closed`, `in_work`→`done`; REQUEST_RECIPIENT: `waiting`→`quoted`, `waiting`→`declined`, `declined`→`waiting` (undo), `waiting`→`expired`, `waiting`→`closed`; QUOTE: `waiting`→`accepted`, `waiting`→`withdrawn`, `waiting`→`expired`, `waiting`→`lost`, `waiting`→`declined_by_driver`, `accepted`→`expired` (its booking lapsed), `accepted`→`lost` (the request was cancelled or closed); BOOKING: `awaiting_confirmation`→`confirmed`, `awaiting_confirmation`→`lapsed`, `awaiting_confirmation`→`cancelled`, `confirmed`→`cancelled`, `confirmed`→`no_show`, `confirmed`→`completed`; JOB: `to_do`→`in_work`, `to_do`→`cancelled`, `in_work`→`paused`, `paused`→`in_work`, `in_work`→`done`. A transition MUST read its row with a lock inside the caller's transaction, judge the move against that state, set the status and the matching time column (`closed_at`, `answered_at`, `accepted_at`, `withdrawn_at`, `confirmed_at`, `cancelled_at`, `no_show_at`, `completed_at`, `started_at`, `paused_at`, `finished_at`), and write the audit entry and the event of FR-011 (a JOB move also appends one JOB_STAGE_ENTRY with the actor, the role and the optional text). The moves of QUOTE_REQUEST, REQUEST_RECIPIENT, QUOTE and BOOKING live in the `quotes` module and the moves of JOB in the `workshop` module, each module the only writer of its own tables. The service applies one entity's move; the cascades between entities (a quote accepted moves its request to `booked`) are composed by the writing stories in one transaction. No transition in this story runs on a clock or on a consumed event; the timers and the `garage.suspended` consumer are later stories'.

_From 220-requests-quotes-bookings._

### 220-FR-009 — The database MUST enforce: at most one `accepted` quote per request (a partial unique index); at most one booking per quote; at most one quote per (request, garage); one recipient row per (request, garage); one job per booking; a request's recipients at most REQUEST_MAX_GARAGES (checked in the sending story, not here). A violation MUST be answered, through one error mapper the transition service and the later stories' inserts share, as the 409 `invalid_transition` of FR-008 carrying `entity`, the moved row's current state as `currentStatus` (absent for an insert) and `rule`, the name of the refused uniqueness; never a 500.

_From 220-requests-quotes-bookings._

### 221-FR-009 — A driver MUST be able to send at most 20 requests per Bucharest calendar day; the 21st MUST be refused with 429 `too_many_requests` and nothing written. The count MUST read the driver's stored requests of that day in the same transaction as the insert, after locking the driver's account row and after the idempotency look-up (a replay answers its first answer, never 429) (PostgreSQL is the truth; no Redis counter), and the limit MUST be a named constant of the `quotes` config module (220-FR-010).

_From 221-quote-request._

### 220-FR-011 — Every status change through the transition service MUST, in the caller's transaction, write one audit entry through the existing audit writer (390-FR-001: action `update`, subject type the entity's singular lowercase key (`quote_request`, `request_recipient`, `quote`, `booking`, `job`), subject id, field `status`, old and new value, the actor and role the caller gives, `garage_id`, `car_id` and `job_id` when known) and one outbox event through the existing event port (the kind the caller names from the contracts' event kinds, the subject id, and the audience: the driver's account and the garage, or the garages, concerned). When either write fails, the status change MUST roll back with it. This story emits no event of its own and notifies nobody; it gives later stories the transition service that writes both.

_From 220-requests-quotes-bookings._

### 222-FR-005 — The garage's requests list read (`GET /api/v1/garage/requests?status=quoted`, 344-FR-008) MUST also return the garage's recipients whose quote is `accepted` and whose booking is `awaiting_confirmation`, in the same order, shape, paging and total; each such row MUST carry the booking's `status` and `confirmBy` and, for the owner and a receptionist only, the driver's `phone` (absent when the account has none; never for a mechanic; never on any other row). The driver's phone MUST never appear in a list response before acceptance, and the plate never before confirmation (347-FR-005 unchanged).

_From 222-booking-from-quote._

### 344-FR-007 — `GET /api/v1/garage/requests/:id` MUST gain, per job, the garage's pre-fill (`price`: `fromBani`, `toBani` (nullable), `durationMinutes` (nullable), in bani like the price list's own reads, or null when the garage has no row for the job): the GARAGE_PRICE row for the job and the car's brand where one exists, else the job's default row (no brand), else null; a row not `visible` counts the same as a visible one. The shape is unchanged otherwise; the read's policy (343-FR-005) is unchanged.

_From 344-send-quote._

### 220-FR-014 — Every list endpoint of FR-012 MUST return `{ items, nextCursor, total }` (`total` the count of rows in the caller's scope) with at most PAGE_SIZE (20) items, newest first with equal times ordered by id, `nextCursor` the id of the last item or null on the last page, and MUST answer 400 `invalid_cursor` to a cursor that is not an existing row inside the caller's scope (a cursor that is not a uuid fails validation first: 400 `validation_failed`, FR-015) (391-FR-009, 391-FR-010).

_From 220-requests-quotes-bookings._

### 220-FR-015 — Errors MUST follow the platform's problem details (421-FR-008): 404 for a row that is not the caller's or a caller without the capability, 409 `invalid_transition` with the current state for a refused move or a refused uniqueness, 400 `validation_failed` with the field names for invalid input (the brief's 422 is replaced by the repository's convention, see Assumptions), 400 `invalid_cursor` for a bad cursor.

_From 220-requests-quotes-bookings._

### 221-FR-018 — The two new endpoints MUST be listed in `infra/observability/inventory.json`; the send (a product action) MUST emit one counter of requests sent with the outcome (`sent`, `cannot_receive`, `limit`, `invalid`) and the recipients count as a histogram or attribute, its dashboard panel added by the dashboards story (ST-879) while the repository holds no dashboard file (the inventory entry records `dashboard: none` with that reason), and one structured log line per send with the outcome and the request id, never the description, the plate or a phone (SC-006); the PR's Observability section names them and says why no alert is added (no agreed threshold yet) or adds one.

_From 221-quote-request._

### 220-FR-017 — Tests MUST cover, in Jest on real PostgreSQL where rows are written: every allowed and every refused transition of QUOTE_REQUEST, REQUEST_RECIPIENT, QUOTE, BOOKING and JOB, including quote `waiting` → `declined_by_driver` and the suspension moves (recipient `waiting` → `closed`, quote `waiting` → `withdrawn`); each uniqueness of FR-009 under two concurrent transactions; the quote's field checks of FR-005; the audit entry and the outbox event written in the same transaction and both absent after a rollback; the cancellation key change; 404 for another driver, another garage, a mechanic without `can_answer_quotes`, and a mechanic reading another mechanic's job; no phone or plate before acceptance and confirmation, and the phone never for a mechanic; the page size, order and `invalid_cursor` of FR-014; the label map in Romanian and English covering every status; the constants read from one module. No end-to-end test: the story has no screen.

_From 220-requests-quotes-bookings._

### 221-FR-001 — Sending a quote request MUST be available to a signed-in actor in the `driver` role holding the capability `driver.requests`, for a car that is the actor's own and not removed; a car of another account or a removed one answers 404. A call with no session answers 401 `sign_in_required` (the sign-in gate of FR-003). A caller without the capability (a signed-in account with no `driver.requests`, a garage-role or admin session) gets the capability answer the API already gives, 404; the web app shows Cere ofertă only to a visitor or a driver-role session, never in the garage role. An AI assistant acting through the driver's tools uses the same endpoint and is recorded as such in the audit entry (FR-012).

_From 221-quote-request._

### 221-FR-002 — The garage profile page (ST-307) MUST carry a primary "Cere ofertă" / "Request a quote" button that opens the request dialog for that garage; the dialog MUST be a `dialog` task of the overlays service (158-FR-010) using the shared form-saving helper (159-FR-001..004, 496-FR-001), titled "Cere ofertă" / "Request a quote", with: a Select of the driver's cars, the garage's jobs as switches, a Textarea for the description with a live counter, the garage picker of FR-006, and the main button "Trimite" / "Send". When the page hands over a job selection (the estimate box of ST-356 once it exists), those jobs start switched on; otherwise none is.

_From 221-quote-request._

### 221-FR-003 — The car Select MUST list the driver's cars not removed, "<brand> <model> <year>", the only car preselected when there is one; with no car the dialog MUST show "Adaugă mai întâi o mașină" / "Add a car first" with a link to Mașinile mele and no Trimite button. A visitor who opens the dialog MUST get the sign-in gate (130-FR-004) over it when the cars read answers 401, and after signing in the dialog MUST still hold every chosen value and the refused read is sent again (130-FR-005).

_From 221-quote-request._

### 357-FR-006 — The public garage profile's job list MUST contain exactly the public jobs, each once, in the price list's order (a job's default row's position; a job with no default row by its lowest position; equal positions by row id, so the order is stable), replacing the current filter of approved and visible rows (modifies 221-FR-004: the jobs a request from the profile can ask for are the public jobs).

_From 357-public-price-jobs._

### 221-FR-005 — `POST /api/v1/quote-requests` MUST take the car id, the garage ids (1 to REQUEST_MAX_GARAGES, no repeats), the job type ids (0 or more, no repeats), the optional description and, per garage, its `source`; it MUST require the `Idempotency-Key` header, 1 to 64 characters, and answer 400 `validation_failed` (field `idempotency-key`) without it. The DTOs live in the contracts library and the OpenAPI document and the generated client are regenerated (421-FR-015, 421-FR-016). The route needs a session and joins no public route (the public-routes test list is unchanged).

_From 221-quote-request._

### 221-FR-006 — The dialog's garage picker MUST start with the profile's garage ticked and MUST list up to five other garages, read through `GET /api/v1/quote-requests/garages` for the chosen car, the switched-on jobs and a place (the driver's shared location or typed address): approved garages that pass FR-007 for that car and those jobs within 25 km of the place, plus mobile mechanics whose service radius covers it, ordered as the garage search orders them (garage-search 043), the profile's garage left out; without a place the picker offers only the profile's garage and says so in one line, with the place picker to add one. The driver MUST be able to tick at most REQUEST_MAX_GARAGES (5) in all; a sixth tick is refused with "Poți alege cel mult 5 service‑uri" / "You can pick at most 5 garages". MotorFix never adds a garage the driver did not tick. The read needs a session and the `driver.requests` capability; it carries only each garage's id, name, slug, distance (none for a mobile mechanic) and whether it comes to the driver. A missing or malformed `carId`, `near` or job id answers 400 `validation_failed`; a car that is not the driver's answers 404; without `near` the read answers an empty list.

_From 221-quote-request._

### 049-FR-008 — The server MUST check routing for every garage of the call, in one query of the use case, never only in the browser: the garage's status is `approved`; GARAGE_BRAND for the car's brand has stance `works_on`; the car's fuel is ticked on that row; and, when the request has jobs, at least one requested job type is ticked in GARAGE_BRAND_JOB for that brand (a request with no job skips this check). A garage id that does not exist, or a garage that is `draft`, is treated as a garage that is not taking requests (`not_taking_requests`), so the answer never tells an existing unpublished garage from a missing one. Garages are checked in the order of `garageIds`; the first garage that fails MUST be answered with code `garage_cannot_receive`, carrying `garageId`, `garageName` and `reason` ∈ `brand`, `fuel`, `jobs`, `not_taking_requests`, `garage_suspended`: 409 for `garage_suspended` (the garage is `suspended`; it was public, so naming it hides nothing), 400 for every other reason; nothing is written. The dialog translates the reason in the driver's language naming the garage ("Nu lucrează pe Dacia", "Nu lucrează pe motorină la Dacia", "Nu face lucrările cerute la Dacia", "Service‑ul nu mai primește cereri" for both `not_taking_requests` and `garage_suspended`, English "This garage no longer takes requests"), unticks that garage, and for `not_taking_requests` and `garage_suspended` offers "Înapoi la căutare" / "Back to search". On the profile, when the address carries a brand the garage does not work on (ST-307's red lamp), Cere ofertă MUST be disabled with that lamp's text; in the dialog, a chosen car whose brand or fuel the profile's garage does not take shows the same line under the Select and disables Trimite.

_From 049-garage-suspension._

### 221-FR-008 — The send MUST be idempotent per driver: a QUOTE_REQUEST stores the key (a new column, unique with the driver), and a second call with the same key and driver MUST answer the same status and body as the first without writing anything; a different key creates a new request. The replay is by key alone: a second call with the same key and a different body still answers the first answer and writes nothing. A refused call (400, 404, 429) stores nothing, so its key stays free and a retry with it is judged afresh. The web app sends the key the form-saving helper issues per dialog, and a retry after a network failure reuses it.

_From 221-quote-request._

### 221-FR-009 — A driver MUST be able to send at most 20 requests per Bucharest calendar day; the 21st MUST be refused with 429 `too_many_requests` and nothing written. The count MUST read the driver's stored requests of that day in the same transaction as the insert, after locking the driver's account row and after the idempotency look-up (a replay answers its first answer, never 429) (PostgreSQL is the truth; no Redis counter), and the limit MUST be a named constant of the `quotes` config module (220-FR-010).

_From 221-quote-request._

### 221-FR-010 — A successful send MUST write, in one transaction: one QUOTE_REQUEST (driver, car, car snapshot copied from the car: brand name, model, year, fuel, engine; description; status `sent`; `created_at`; `expires_at` = `created_at` + REQUEST_VALIDITY_DAYS Bucharest days, as 220-FR-001; the idempotency key), one REQUEST_JOB per job type in the order of `jobTypeIds` (position 1..n), one REQUEST_RECIPIENT per garage with status `waiting` and its `source`; the audit entry of FR-012 and the event of FR-011. When any write fails, nothing of the send remains.

_From 221-quote-request._

### 221-FR-011 — The same transaction MUST record one outbox event `request.created` through the existing event port, subject the request id, payload `{ requestId, driverId, garageIds }` and nothing else (no description, no car data), audience the request's driver account and recipient garages (254-FR-001), so `account:{accountId}` refreshes Cererile mele and `garage:{garageId}` the garages' inboxes; the notifications and timers that consume it are later stories'.

_From 221-quote-request._

### 221-FR-012 — The same transaction MUST write one audit entry through the existing audit writer: action `create`, subject type `quote_request`, subject id the request, actor the driver with role `driver` (the assistant grant when the call came through an AI assistant, as 390 records it), `car_id`, and new value the recipients' garage ids and the jobs' type ids; never the description or the plate.

_From 221-quote-request._

### 221-FR-013 — The API MUST answer 201 with the request as the driver reads it (the request DTO of 220-FR-012, with its recipients as garage id, name, slug and status); the dialog MUST then replace its form with the confirmation "Trimis către <garage>." / "Sent to <garage>." for one garage, "Trimis către <n> service‑uri." / "Sent to <n> garages." with the names listed for several, and a link "Vezi Cererile mele" / "See My requests" to the driver's requests view; closing the dialog returns to the profile with the button back. Each recipient that qualifies under 1025-FR-002 also gets the 1025-FR-001 line.

_From 221-quote-request; modified by 1025-answers-same-day._

### 030-FR-009 — The views MUST show, with no data, exactly this text and action:

_From 030-new-account-empty-states._

### 030-FR-002 — For a driver with no active request (a request is active while its status is neither `done` nor `closed`), the first row MUST replace Cererea activă with the invitations: "Adaugă prima ta mașină" + button "Adaugă o mașină" when the driver has no car, and "Caută un service pentru mașina ta" + button "Caută un service" always.

_From 030-new-account-empty-states._

### 221-FR-016 — `source` MUST be stored per recipient: `profile_direct` for the garage whose profile the dialog was opened from, `shared_link` for that garage when the profile's address carries `?src=share`, `search` for every garage ticked in the picker; the API MUST accept only the contracts' source values and MUST refuse a garage id given twice. `home`, `map`, `saved` and `unknown` are not produced by this story. The source is a recorded fact for later statistics, never an input to routing or the limit.

_From 221-quote-request._

### 221-FR-017 — States: while the cars and jobs load, the dialog shows them from the profile's data at once and the picker behind a skeleton; offline, Trimite is disabled with "Fără conexiune" / "No connection" and every typed value stays; while the send is in flight Trimite is disabled and shows the form-saving helper's busy state; a failed send keeps the form and shows the shared error with a retry carrying the same key; a 429 shows "Ai trimis deja 20 de cereri azi. Încearcă mâine." / "You already sent 20 requests today. Try again tomorrow." Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen using U+2011; every control at least 44 px tall; the dialog MUST pass the sweep at 320 px, 390 px, tablet and desktop, light and dark, both languages, with no sideways scroll.

_From 221-quote-request._

### 221-FR-018 — The two new endpoints MUST be listed in `infra/observability/inventory.json`; the send (a product action) MUST emit one counter of requests sent with the outcome (`sent`, `cannot_receive`, `limit`, `invalid`) and the recipients count as a histogram or attribute, its dashboard panel added by the dashboards story (ST-879) while the repository holds no dashboard file (the inventory entry records `dashboard: none` with that reason), and one structured log line per send with the outcome and the request id, never the description, the plate or a phone (SC-006); the PR's Observability section names them and says why no alert is added (no agreed threshold yet) or adds one.

_From 221-quote-request._

### 221-FR-019 — Tests MUST cover, in Jest on real PostgreSQL where rows are written: routing for a refused brand, no brand row, fuel not ticked, some jobs ticked, no job ticked, a suspended garage, a request with no job; idempotency (two calls with one key, one request; a different key, two); six garage ids, zero, and a repeated id refused; `source` stored per recipient as given; an unconfirmed e-mail may send; no job and no description, a 10-character floor, a 1,001-character description, another driver's car (404), a removed car (404), a garage-role actor (404); the 20-a-day limit at the boundary; the audit entry and the outbox event written in the same transaction and both absent after a forced rollback; the candidates read's distance, mobile-mechanic and routing filters; the public-routes list unchanged; the dialog's disabled states and the confirmation texts in both languages; the Cererile mele row and its live re-read. End to end (Playwright): sign in as a seeded driver with a Dacia, open an approved garage's profile, switch on a job, send, read the confirmation, open Cererile mele and see the request as Trimisă; then, as that garage's owner, read it through the garage requests endpoint (the garage inbox screen is another story's).

_From 221-quote-request._

### 343-FR-001 — A *waiting row* MUST be a REQUEST_RECIPIENT of the reader's garage with status `waiting` on a request whose status is `sent` or `quoted`. The two counters (the panel's "N fără răspuns" / "N unanswered" and the number on the Cereri de ofertă menu entry and bottom tab) MUST equal the count of exactly these rows, read with the list, never counted in the browser.

_From 343-live-quote-requests._

### 345-FR-012 — `GET /api/v1/garage/requests?status=closed` MUST also answer the garage's recipients `declined` within the last 24 hours (close time `declined_at`), with the close reason `declined` added to the typed set of 343-FR-004, label "Refuzată" / "Declined", taking precedence over the request's own close reasons (rows stay ordered by close time); the `waiting` read never answers a `declined` recipient (unchanged); the `quoted` read is unchanged. A `declined` row carries its `declineReason` as the shipped `GarageRecipientDto` does.

_From 345-decline-request._

### 343-FR-003 — Each garage-side request summary MUST mark, per job, whether the garage does that job on the request's car brand (`offered`: GARAGE_BRAND_JOB has the job type ticked for that brand), so the screen can show "nu faceți" / "not offered" on the others. A request with no jobs has nothing to mark.

_From 343-live-quote-requests._

### 345-FR-012 — `GET /api/v1/garage/requests?status=closed` MUST also answer the garage's recipients `declined` within the last 24 hours (close time `declined_at`), with the close reason `declined` added to the typed set of 343-FR-004, label "Refuzată" / "Declined", taking precedence over the request's own close reasons (rows stay ordered by close time); the `waiting` read never answers a `declined` recipient (unchanged); the `quoted` read is unchanged. A `declined` row carries its `declineReason` as the shipped `GarageRecipientDto` does.

_From 345-decline-request._

### 347-FR-008 — The detail read MUST answer 403 `forbidden` to a mechanic of a recipient garage who lacks `can_answer_quotes` (today 404, 343-FR-005; the decline and the send already answer 403 to that mechanic, 344-FR-002), and 404 `not_found` to every other caller without a recipient row for their garage, another recipient garage's staff included, and to a caller with no garage; the list read is unchanged. The web MUST show "Nu ai dreptul să citești cererile" / "You are not allowed to read requests" on 403 and "Cererea nu mai este disponibilă" / "The request is no longer available" on 404 and 400, with no request data.

_From 347-read-request._

### 343-FR-006 — Panou MUST gain a section "Cereri de ofertă" / "Quote requests" above its empty state, replacing that empty state once the section exists: its heading, the counter "N fără răspuns" / "N unanswered", the four newest waiting rows and, when there are more than four, a link "Vezi toate" / "See all" to the Cereri de ofertă view. The section is present for the owner, the receptionist and a mechanic with `can_answer_quotes` (the session's `garageAccess` permissions, 097-FR-005), absent for a mechanic without it, and absent while the garage is `draft` (097-FR-008's line stays).

_From 343-live-quote-requests._

### 343-FR-007 — The Cereri de ofertă view MUST replace its empty-state placeholder with the waiting rows, newest first, 20 at a time, the next page loading when the list's end comes into view until `nextCursor` is null, and the closed rows of the last 24 hours greyed under the waiting rows loaded so far, each with its FR-004 label; the closed rows come from one `closed` read (its first page, not paged further) made with the first waiting read and re-read on the same events. Its title and subtitle stay as 097-FR-003 gives them. The view's menu entry and bottom tab MUST show the FR-001 count in the counter slot 097-FR-001 reserved, with no number at zero.

_From 343-live-quote-requests._

### 345-FR-013 — Each waiting row on Panou and in the Cereri de ofertă view MUST show, next to "Trimite oferta", a secondary button "Refuză" / "Decline" for the owner, the receptionist and a mechanic with `can_answer_quotes` (the session's `garageAccess` permissions, 343-FR-015), absent for every other reader, on desktop and on the phone layout; it opens the decline dialog in the shared overlay (`dialog` shape from 768 px, the bottom sheet under it; 157, 158, 491) for that request.

_From 345-decline-request._

### 345-FR-016 — The panel, the view and the counters MUST show the decline within 5 seconds of the commit on every staff screen of the garage, through the existing re-read on `request.declined` (343-FR-009, already wired), the first visible row kept in place (256-FR-008) and the changed row highlighted (256-FR-009); the driver's open request views MUST re-read on the window-close `request.declined` received on `account:{driverId}` through the same helper, so the driver's screens show the decline within 5 seconds of the window closing and never before.

_From 345-decline-request._

### 343-FR-010 — With any garage dashboard route open and the tab visible, a `request.created` for the garage MUST raise one short toast "Cerere nouă: <brand> <model> · <first job>" / "New request: <brand> <model> · <first job>" (the description's first line, cut at 40 characters, when there is no job), through the shared toast, once per event, with no sound; a hidden tab raises none, and the toast is never raised for the other kinds.

_From 343-live-quote-requests._

### 343-FR-011 — States: while the first read is in flight the panel and the view show three skeleton rows and no counter; with no waiting row they show "Nicio cerere nouă. Te anunțăm când apare una." / "No new requests. We will tell you when one arrives." and the counter "0 fără răspuns" / "0 unanswered"; while the live state is `reconnecting` or `polling` a thin banner "Reconectare…" / "Reconnecting…" shows above the list; once offline (the live service's `offline`, 10 seconds without the connection) the last list stays with the line "Lista poate fi veche" / "This list may be out of date". A failed read after a list was shown keeps the list (256-FR-003); a failed first read shows the shared error with a retry.

_From 343-live-quote-requests._

### 343-FR-015 — The web app MUST hide the panel, the menu entry, the tab and the counter from a mechanic whose `garageAccess` permissions lack `canAnswerQuotes`, and from an account with no membership, without a call; the server is the authority (FR-005) and a 404 on the read is treated as "not allowed", showing nothing and no error.

_From 343-live-quote-requests._

### 343-FR-016 — Every new text MUST exist in Romanian and English (hyphenated Romanian words with U+2011); the rows, counters, banner and toast MUST pass the sweep at 320 px, 390 px, tablet and desktop, light and dark, both languages, with no sideways scroll, no text under 12 px, every link at least 44 px tall and the greyed closed rows' text at a contrast of at least 4.5:1 against its background in both schemes; the row's parts wrap on a phone rather than overflow.

_From 343-live-quote-requests._

### 343-FR-018 — Tests MUST cover, before the code (Principle II): in Jest on real PostgreSQL — the `waiting` filter returns only `waiting` recipients of this garage on `sent` or `quoted` requests, newest first, with `total` equal to the rows; the `closed` filter and each FR-004 reason, including a row closed more than 24 hours ago left out, and the suspended garage; the `offered` mark per job; an invalid `status` 400; 404 for a mechanic without `can_answer_quotes` and for another garage's owner; the consumer's recipients (owner, receptionist, permitted mechanic; not an unpermitted mechanic), the per-channel mute, the garage WhatsApp switch, never SMS, the no-device fallback, quiet hours not holding it, the same event building once, and the parameters carrying no plate, phone or description. In Jest, web — the row format and the age wording in both languages, the four-row panel with "Vezi toate" at five, the counters, the toast once per `request.created` and only when visible, the hidden panel and entry for an unpermitted mechanic, the empty, loading, reconnecting and offline states. End to end (Playwright): with the seeded owner's dashboard open, a seeded driver sends a request; the row and both counters update within 5 seconds without a reload; a mechanic without the permission sees no panel and no Cereri entry.

_From 343-live-quote-requests._

### 344-FR-001 — `POST /api/v1/quotes` MUST take `requestId` (uuid), `fromLei` and `toLei` (integers, 1 ≤ `fromLei` ≤ `toLei` ≤ 1 000 000), `durationMinutes` (integer, 15 to 7 200, a multiple of 15), `slot` (an ISO date-time with an offset or `Z`, later than now; the 15-minute grid is not enforced here) and an optional `note` (plain text, trimmed, 1 to 500 characters; whitespace alone is no note), DTOs in the contracts library validated at the edge; any other value MUST answer 400 `validation_failed` naming the field (`fromLei` for a low price above the high one). The OpenAPI document and the generated client are regenerated; the route needs a session and joins no public route.

_From 344-send-quote._

### 344-FR-002 — The send MUST be allowed to the owner and the receptionist of a garage that holds a REQUEST_RECIPIENT for the request, and to a mechanic of it with `can_answer_quotes`; a mechanic of that garage without the permission MUST get 403 `forbidden` ("Nu ai dreptul să trimiți oferte" / "You are not allowed to send quotes") and every other caller, another garage's staff included, MUST get 404, nothing written in either case (A31, A34, 220-FR-012). The garage is the actor's garage; the request must be one of its recipients, else 404.

_From 344-send-quote._

### 344-FR-003 — In one transaction that locks the recipient row, the send MUST judge the state and write: one QUOTE (request, recipient, garage, `from_bani` = `fromLei` × 100, `to_bani` = `toLei` × 100, `duration_minutes`, `slot`, `note`, status `waiting`, `sent_at` now, `expires_at` = `sent_at` + 7 days); one QUOTE_JOB per REQUEST_JOB of the request with `included` = the job's `offered` mark (GARAGE_BRAND_JOB ticked for the car's brand, 343-FR-003), none when the request has no jobs; the recipient's move `waiting` → `quoted` with `answered_at` now through the transition service (220-FR-008); the request's move `sent` → `quoted` when it is `sent`, unchanged when already `quoted`; one outbox event `quote.sent` (subject the quote id, payload `{ quoteId, requestId, garageId, driverId }`, audiences `garage:{garageId}` and `account:{driverId}`); and one audit entry (action `create`, subject type `quote`, subject id the quote, the actor, their role, garage scope, new values the range in lei, the duration, the slot and whether the note is set — never the note's text — `via_assistant` when the grant sent it, 390-FR-001..008). A failure anywhere writes nothing.

_From 344-send-quote._

### 344-FR-004 — The send MUST be refused with 409 `already_answered` ("Altcineva a răspuns deja la această cerere" / "Someone else already answered this request") when the garage's recipient is `quoted` or `declined` past its undo window, and with 409 `request_not_open` ("Cererea nu mai este deschisă" / "The request is no longer open") when the request is not `sent` or `quoted`, when the recipient is `expired` or `closed`, or when the garage is `suspended`; a recipient `declined` inside its undo window MUST be treated as `already_answered` too (the undo is the decline story's). Two concurrent sends for the same recipient MUST end with exactly one quote: the row lock and the database's one-quote-per-request-and-garage rule (220-FR-009) make the loser a 409 `already_answered`, never a 500.

_From 344-send-quote._

### 344-FR-005 — The send MUST be idempotent per garage: the `Idempotency-Key` header (required, 1 to 200 characters) is stored on the quote itself (`idempotency_key`, unique with the garage; 221-FR-008's pattern, scoped to the garage because the quote is the garage's), and a second call with the same key from the same garage, whoever the actor, MUST answer the first status and body without writing anything; a refused call (400, 404, 409) stores nothing, so its key stays free. The web app sends the key the form-saving helper issues per dialog opening, and a retry after a network failure reuses it.

_From 344-send-quote._

### 344-FR-006 — The API MUST answer 201 with the quote as the garage reads it, the shipped `GarageQuoteDto`: id, request id, the range in bani (`fromBani`, `toBani`, integer bani, VAT included, as every garage-side read returns money; the screen shows lei), `durationMinutes`, `slot`, `note`, status, `sentAt`, `expiresAt` and the jobs with their `included` flags; errors MUST follow the platform's problem details (421-FR-008) with the codes of FR-001, FR-002 and FR-004 and their Romanian and English messages.

_From 344-send-quote._

### 344-FR-007 — `GET /api/v1/garage/requests/:id` MUST gain, per job, the garage's pre-fill (`price`: `fromBani`, `toBani` (nullable), `durationMinutes` (nullable), in bani like the price list's own reads, or null when the garage has no row for the job): the GARAGE_PRICE row for the job and the car's brand where one exists, else the job's default row (no brand), else null; a row not `visible` counts the same as a visible one. The shape is unchanged otherwise; the read's policy (343-FR-005) is unchanged.

_From 344-send-quote._

### 344-FR-008 — `GET /api/v1/garage/requests` MUST accept a third `status` value, `quoted`: the garage's recipients `quoted` whose quote is `waiting`, newest quote first (`sent_at` descending, equal times by id), with the existing shape, paging and `total` (343-FR-002); each row MUST carry its quote summary (`quote`: the shipped quote summary, id, `fromBani`, `toBani`, `durationMinutes`, `slot`, `sentAt`, `expiresAt`, status); a `waiting` row carries null `quote`, and a `closed` row keeps the quote it had, as shipped (343). A value outside the three answers 400 `validation_failed` naming `status`.

_From 344-send-quote._

### 344-FR-009 — Each waiting row on Panou and in the Cereri de ofertă view MUST show a primary button "Trimite oferta" / "Send a quote" in its actions column for the owner, the receptionist and a mechanic with `can_answer_quotes` (the session's `garageAccess` permissions, 343-FR-015), absent for every other reader; it opens the send dialog in the shared overlay (`dialog` shape from 768 px, the bottom sheet under it; 157, 158, 491) for that request.

_From 344-send-quote._

### 344-FR-010 — The dialog MUST be titled "Trimite oferta" / "Send a quote" and, under the title, name the driver's short name and the included jobs' names in the person's language joined by " · " (the description's first line, cut at 60 characters, when the request has no jobs); when some jobs are not offered it MUST show, under that line, "Nu face: <names>" / "Not offered: <names>". It MUST hold, in this order: "Preț de la (lei)" / "Price from (lei)" and "până la (lei)" / "to (lei)" side by side, "Durată" / "Duration" as hours and minutes in 15-minute steps, "Primul loc liber" / "First free slot" as a day and a time (a day picker refusing past days, a time picker in 15-minute steps refusing past times of today, in Europe/Bucharest), an optional "Mesaj pentru client" / "Message to the customer" with a 500-character counter, a hint "Intervalul acoperă piese și manoperă, cu TVA, pentru mașina exactă a clientului; prețul final se stabilește după ce vezi mașina." / "The range covers parts and labour, VAT included, for the customer's exact car; the final price is set after you see the car.", and the buttons "Renunță" / "Cancel" and "Trimite" / "Send". There is no mechanic or lift field.

_From 344-send-quote._

### 344-FR-011 — The dialog MUST pre-fill the price fields with the sum of the included jobs' FR-007 `fromBani` and `toBani`, shown in lei (any included job with a price but no `toLei` leaves the top empty while the bottoms still sum; a job with no price adds nothing) and the duration with the sum of their `durationMinutes` (empty when every included job has none; a sum over 5 days pre-fills as is and FR-012 marks it); the slot and the note start empty. A re-opened dialog starts from the pre-fill again.

_From 344-send-quote._

### 344-FR-012 — Validation in the dialog MUST mirror FR-001: Trimite stays disabled while a price, the duration or the slot is empty or any field is invalid; an empty required field is marked "Obligatoriu" / "Required" on blur; a low price above the high one marks both with "Prețul de la nu poate fi mai mare decât prețul până la" / "The low price cannot be above the high price"; a price outside 1–1 000 000, a duration outside 15 minutes–5 days or off the 15-minute grid, a past slot and a note over 500 characters are marked with their rule; a top more than three times the bottom shows the warning "Intervalul este foarte larg; șoferul așteaptă un interval strâns." / "This range is very wide; the driver expects a narrow one." without disabling Trimite. Enter in a text field sends when the form is valid.

_From 344-send-quote._

### 344-FR-013 — States: while sending, Trimite shows a spinner, every field and Renunță are disabled and the dialog stays open; on 201 it closes with the shared toast "Ofertă trimisă" / "Quote sent"; on 409 it closes and the toast shows the error's message, the lists re-reading at once; on 400 the named field is marked with the message; on any other error or a network failure the dialog stays open with everything typed, shows the shared error line with a retry that reuses the same idempotency key; offline, Trimite is disabled with "Ești offline" / "You are offline".

_From 344-send-quote._

### 344-FR-014 — The Cereri de ofertă view MUST gain, under the waiting panel, a panel "Oferte trimise" / "Quotes sent" listing the `quoted` rows of FR-008 newest first, 20 at a time with the same infinite scroll, each row showing the driver's short name, the car ("<brand> <model> · <year>"), the included jobs' names, the range "650–800 lei", the slot in Europe/Bucharest in the person's language ("mâine, 09:00" / "tomorrow, 09:00" when the Bucharest date is the next day, "azi, 16:00" / "today, 16:00" the same day, else "joi, 15 oct., 14:00" / "Thu, 15 Oct, 14:00") and the status line "Așteaptă răspunsul clientului" / "Waiting for the customer"; with no row it shows "Nicio ofertă trimisă încă." / "No quotes sent yet."; while loading, three skeleton rows. The panel is present for the same readers as the waiting panel (343-FR-006) and has no row action in this story (changing and withdrawing come with their story); it shows the waiting state only, the outcomes being ST-346's.

_From 344-send-quote._

### 344-FR-015 — The waiting panel, the view's counters and the Oferte trimise panel MUST re-read on `quote.sent` through the existing live helper (343-FR-009 already names the kind); a sent quote MUST leave the waiting list and appear under Oferte trimise within 5 seconds of the commit on every staff screen of the garage, without a reload, the first visible row kept in place (256-FR-008) and the changed row highlighted (256-FR-009). `quote.sent` on `account:{driverId}` MUST re-read the driver's request views through the same helper, so the driver's request read shows the quote within 5 seconds; the driver's comparison screen itself is its own story.

_From 344-send-quote._

### 344-FR-019 — Tests MUST cover, before the code (Principle II): in Jest on real PostgreSQL — every FR-001 rule (both prices, low ≤ high, the price bounds, the duration range and grid, the future slot, the note length, the required key) as 400 naming the field; 201 for the owner, the receptionist and the permitted mechanic; 403 for the unpermitted mechanic; 404 for another garage's owner and a request not sent to the garage; the QUOTE, QUOTE_JOB (included flags following the brand's ticks; none for a request with no jobs), recipient and request moves with `answered_at`, `sent_at` and `expires_at`; `quote.sent` and the audit entry in the same transaction and nothing written on a failure; 409 on a second quote, on a declined recipient, on a cancelled, expired and booked request and for a suspended garage; two concurrent sends ending with one quote; the same key answering the first answer; the pre-fill with a brand row, with only a default row, with an open-ended row and with none; the `quoted` filter and its quote summary; the consumer building one QUOTE_RECEIVED for the driver, honouring the mute, the no-device fallback and building once per event; the single templates in both languages. In Jest, web — the button's presence per permission, the dialog's title line and left-out jobs, the pre-fill sums, every FR-012 rule and the wide-range warning, the 15-minute pickers refusing the past, the sending, 201, 409, 400, error and offline states, the Oferte trimise row format and slot wording in both languages and its empty and loading states. End to end (Playwright): the seeded owner sends 650–800 lei, 2 h, tomorrow 09:00 on a waiting request; the row moves to Oferte trimise within 5 seconds; signed in as the driver, the request shows the quote.

_From 344-send-quote._

### 345-FR-001 — `POST /api/v1/garage/requests/:id/decline` MUST take the request id in the path and a body `{ reason }` with `reason` one of DECLINE_REASONS (`fully_booked`, `job_not_done`, `make_model_engine_not_done`, `need_to_see_car`), the DTO in the contracts library validated at the edge; a missing, empty or unknown reason MUST answer 400 `validation_failed` naming `reason`, nothing written. The OpenAPI document and the generated client are regenerated; the route needs a session and joins no public route (the public-routes list is unchanged).

_From 345-decline-request._

### 345-FR-002 — The decline MUST be allowed to the owner and the receptionist of a garage that holds a REQUEST_RECIPIENT for the request, and to a mechanic of it with `can_answer_quotes`; a mechanic of that garage without the permission MUST get 403 `forbidden` ("Nu ai dreptul să răspunzi la cereri" / "You are not allowed to answer requests"); every other caller, another garage's staff, a driver, an admin and a request not sent to the garage, MUST get 404; nothing written in either case (344-FR-002's policy, A31/A34). The garage is the actor's garage.

_From 345-decline-request._

### 345-FR-003 — In one transaction that locks the recipient row, the decline MUST move the recipient `waiting` → `declined` through the transition service (220-FR-008) with `decline_reason`, `declined_at` now, `declined_by` the actor's account and `answered_at` now; write the audit entry of 220-FR-011 (action `update`, subject `request_recipient`, field `status`, the actor, their role, `garage_id`, and the reason in the new value; `via_assistant` when the grant made the call, 390-FR-001..008); and record one outbox event `request.declined` (subject the recipient id, payload `{ requestId, garageId, recipientId, driverId, reason }`, audience `garage:{garageId}` only). A failure anywhere writes nothing. The request's own status is unchanged by a decline.

_From 345-decline-request._

### 345-FR-004 — The decline MUST be refused with 409 `already_answered` ("Altcineva a răspuns deja la această cerere" / "Someone else already answered this request") when the garage's recipient is `quoted` or `declined`, and with 409 `request_not_open` ("Cererea nu mai este deschisă" / "The request is no longer open") when the request is not `sent` or `quoted`, when the recipient is `expired` or `closed`, or when the garage is `suspended` (the codes and messages of 344-FR-004). Two concurrent declines, or a decline beside a send, for the same recipient MUST end with exactly one answer: the row lock makes the loser a 409, never a 500.

_From 345-decline-request._

### 345-FR-005 — The API MUST answer 200 with the garage's recipient as the garage reads it (the shipped `GarageRecipientDto`: status, source, `answeredAt`, `declinedAt`, `declineReason`); errors MUST follow the platform's problem details (421-FR-008) with the codes of FR-001, FR-002 and FR-004 and their Romanian and English messages.

_From 345-decline-request._

### 345-FR-007 — The worker MUST run the shipped one-timer-per-object helper on a queue `quote-timers` with the timer kind `decline-window` (job id `decline-window-<recipientId>`, the brief's `decline-window:{recipientId}`; the job carries only the recipient id) and its 5-minute sweep; a consumer of `request.declined` on the worker MUST set that timer at `declined_at` + DECLINE_UNDO_MINUTES for the event's recipient (setting it again replaces it, so a redelivered event is harmless) and MUST ignore an event marked `windowClosed`. The queue joins the worker's own health and metrics as the notifications queue does.

_From 345-decline-request._

### 345-FR-008 — When the timer fires, or the sweep finds a recipient `declined` for at least DECLINE_UNDO_MINUTES with `decline_told_at` null, the job MUST, in one transaction that locks the recipient row, read it afresh and act only when it is still `declined`, its `declined_at` is at least DECLINE_UNDO_MINUTES old and `decline_told_at` is null (one rule for the timer and the sweep); then set `decline_told_at` now, and, when the request is still `sent` or `quoted`, build REQUEST_DECLINED for the driver (FR-009) and record one outbox event `request.declined` (the FR-003 payload plus `windowClosed: true`, audience `account:{driverId}` only). A recipient already told, undone, re-declined with a newer `declined_at`, or on a request no longer open, gets no message, and a told recipient is never told again. When the worker was down at the mark, the sweep sends late, once.

_From 345-decline-request._

### 345-FR-011 — The driver's request read (`GET /api/v1/requests/:id` and every other driver read that carries recipients, through one shared mapping) MUST hide a decline younger than DECLINE_UNDO_MINUTES: such a recipient answers `status` `waiting`, `answeredAt` null and `declineReason` null; from `declined_at` + 5 minutes it answers `declined`, `answeredAt` and `declineReason` (a new nullable field on `RecipientDto`, the reason code; the screens label it). The judgement is made from `declined_at` at read time, never from `decline_told_at`, so a muted driver and a late message see the same thing. `declinedBy` is never exposed to the driver (the shipped rule).

_From 345-decline-request._

### 345-FR-014 — The dialog MUST be titled "De ce refuzați cererea?" / "Why are you declining the request?", name the driver's short name and the car ("Vlad P. · Renault Mégane 2019") under the title, hold exactly four radio options in the order of DECLINE_REASONS with the labels "Suntem ocupați complet" / "We are fully booked", "Nu facem această lucrare" / "We don't do this job", "Nu lucrăm pe această marcă, model sau motor" / "We don't work on this make, model or engine", "Trebuie să vedem mașina mai întâi" / "We need to see the car first" (one map in the contracts library, FR-010), no "other" option and no free text, and the buttons "Renunță" / "Cancel" and "Refuză" / "Decline"; "Refuză" stays disabled until an option is picked. The labels live with the reason map so the garage's dialog, the garage's row and the driver's screens (#60, #262) read one source.

_From 345-decline-request._

### 345-FR-015 — States: while saving, "Refuză" shows a spinner, the options and "Renunță" are disabled and the dialog stays open; on 200 it closes with the shared toast "Cerere refuzată" / "Request declined"; on 409 it closes and the toast shows the error's message, the lists re-reading at once; on 403 or 404 it closes with the error's message; on any other error or a network failure it stays open with the reason still picked and shows the shared error line with a retry; offline, "Refuză" is disabled with "Ești offline" / "You are offline". The greyed declined row under the waiting list reads "Refuzată" / "Declined" as its FR-012 label.

_From 345-decline-request._

### 345-FR-017 — The MCP garage tools MUST gain `decline_quote_request` (`acts: true`, scope `motorfix.act`, capability `garage.requests`, annotations `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`), input `{ requestId: uuid, reason: one of the four }`, running the same use case as the owner's garage actor and answering the recipient's status, `declinedAt` and `declineReason`; its description MUST tell the assistant to confirm the request and the reason with the person before calling; a refused state or actor answers the API's error as the registry maps errors today; the audit entry carries `via_assistant` (221-FR-001's rule for the assistant). The maintenance switch refuses it as every acting tool.

_From 345-decline-request._

### 345-FR-018 — Observability (AGENTS.md): the new endpoint, the `quote-timers` queue and the `decline-window` timer MUST be listed in `infra/observability/inventory.json`; the decline (a product action) MUST emit one counter of declines with the outcome (`declined`, `already_answered`, `request_not_open`, `invalid`) and the reason as an attribute; the window job one counter of windows closed with the outcome (`sent`, `muted` when no channel built a message, `skipped_undone`, `skipped_closed`, `already_told`) and whether the sweep ran it; one structured log line per decline and per window with the recipient id and the outcome, never the description, the plate or a phone. The PR's Observability section names them, the dashboard panel being the dashboards story's while the repository holds no dashboard file, and names the alert for a sweep that keeps finding overdue windows or says why none is added.

_From 345-decline-request._

### 345-FR-019 — Every new text MUST exist in Romanian and English (hyphenated Romanian words with U+2011); the button, the dialog and the declined row MUST pass the sweep at 320 px, 390 px, tablet and desktop, light and dark, both languages, with no sideways scroll, no text under 12 px and every option and button at least 44 px tall.

_From 345-decline-request._

### 345-FR-020 — Tests MUST cover, before the code (Principle II): in Jest on real PostgreSQL — a missing, empty and unknown reason as 400 naming `reason`; 200 for the owner, the receptionist and the permitted mechanic with `declined_by` each; 403 for the unpermitted mechanic; 404 for another garage's owner, a driver, an admin and a request not sent to the garage; the recipient's move with every column, the audit entry with the reason and the `request.declined` event to the garage audience in one transaction, and nothing written after a forced rollback; 409 `already_answered` on a quoted and on a declined recipient, 409 `request_not_open` on a cancelled, an expired and a booked request, on an `expired` and a `closed` recipient and for a suspended garage; two concurrent declines, and a decline beside a send, ending with one answer; the timer set from the event and the marked event ignored; the window job sending once for a decline 5 minutes old, nothing on a `declined_at` under 5 minutes old, on an undone recipient, on a told recipient, on a closed request, and the sweep sending late once; the driver's mute leaving the recipient told; the driver's read hiding at 4:59 and showing at 5:00 with the reason, never `declinedBy`; the `closed` read listing the declined row within 24 hours with reason `declined` and leaving it out after; the response rate counting a declined recipient as answered; the templates in both languages per channel and the reason map covering every reason; the tool's schema, scope, maintenance refusal and audit mark. In Jest, web — the button's presence per permission on desktop and phone, the dialog's title line and four options, the disabled confirm until picked, the saving, 200, 409, 403, other-error and offline states, the declined row's label in both languages. End to end (Playwright): the seeded owner declines a waiting request with "Trebuie să vedem mașina mai întâi"; the row shows Refuzată and the counter drops within 5 seconds; with `declined_at` moved back 5 minutes (the e2e moves the clock by backdating the row), the driver's request read shows the recipient declined with `need_to_see_car`; the message itself is covered by the worker's integration specs.

_From 345-decline-request._

### 1025-FR-001 — After a quote request is sent, the confirmation MUST show, for each recipient garage that qualifies under FR-002, one short line stating that the garage usually answers the same day: Romanian "{garage} răspunde de obicei în aceeași zi.", English "{garage} usually answers the same day." Both texts MUST exist in Romanian and English; the two sentences contain no hyphenated word, so the U+2011 rule of the existing texts ("service‑uri") does not apply to them.

_From 1025-answers-same-day._

### 1025-FR-002 — A garage qualifies when its public response rate is in the `rate` state and the rate is at or above RESPONSE_SAME_DAY_MIN_RATE = 70 percent (answered, quoted or declined, within 24 hours over the last 30 days, as the nightly stats compute it, which already requires at least 10 requests ever). The threshold is one named constant, owned by the stats module, so the owner changes it in one place.

_From 1025-answers-same-day._

### 1025-FR-003 — A garage in the `new` state, in the `none` state, or with a rate below the threshold MUST get no line and no empty element: the confirmation reads exactly as before this story for that garage. No text ever states that a garage answers slowly or rarely.

_From 1025-answers-same-day._

### 1025-FR-004 — The rule of FR-002 MUST be applied in one place on the server and carried as a decided fact (`answersSameDay`) on each recipient's garage in the request the send returns, so the dialog does not re-derive it from the percentage; the same rule serves one recipient and several.

_From 1025-answers-same-day._

### 1025-FR-005 — The line MUST never delay or fail the send: the confirmation is rendered from the send response alone (no further call for the line), and a garage with no stats row is treated as `new` (no line, no error).

_From 1025-answers-same-day._

### 1025-FR-006 — For a single recipient the line MUST sit under the sent line, inside the same status region, so a screen reader announces it with the confirmation; for several recipients the qualifying garage's list item MUST read as the FR-001 sentence (same text key), plain text. The line MUST pass the sweep at 320 px, 390 px, tablet and desktop, light and dark, both languages, with no sideways scroll.

_From 1025-answers-same-day._

### 1025-FR-007 — The public garage profile and every other screen that shows the rate MUST be unchanged by this story; the line exists only in the send confirmation.

_From 1025-answers-same-day._

### 347-FR-001 — Every waiting row (closed rows do not open) in the Cereri de ofertă panel on Panou and in the Cereri de ofertă view MUST open the request on click (and on Enter or Space when focused, the row being a button-like element with an accessible name "Deschide cererea <customer> · <car>"), for the owner, the receptionist and a mechanic with `can_answer_quotes`; the row's existing Trimite oferta and Refuză buttons stop the click from opening it.

_From 347-read-request._

### 347-FR-002 — The request MUST open in the shared overlay's `drawer` shape (right-hand drawer from 768 px, bottom sheet under it, 158-FR-011), titled "Cerere de ofertă" / "Quote request", with the two actions Trimite oferta and Refuză fixed at the bottom while the body scrolls; closing follows the overlay's three ways (close button, Escape, the dimmed page); focus moves into the drawer when it opens and returns to the row (or the opener) when it closes, as the shared overlay does for every drawer.

_From 347-read-request._

### 347-FR-003 — The drawer MUST show, from the existing detail read: the driver's `shortName`; the car as "<brand> <model> · <year> · <fuel in the reader's language> · <engine>" (the engine part left out when the snapshot has none); every job in the reader's language, the offered ones in the main list and the not-offered ones apart under "Nu faceți această lucrare pe <brand>" / "You do not do this job on <brand>" (plural "aceste lucrări" / "these jobs" when more than one); the description as plain text with its line breaks, links not made clickable; "orice mecanic" / "any mechanic" (see Assumptions); "primită <relative age>" / "received <relative age>" with the row's existing age wording; "expiră <relative>" / "expires <relative>" from `expiresAt`, rounded down: "în N zile" / "in N days" from 24 h (exactly 24 h is "în 1 zi" / "in 1 day"), "în N ore" / "in N hours" from one hour, "în mai puțin de o oră" / "in less than an hour" under it, "a expirat" / "expired" once past, computed in Europe/Bucharest by one formatter that mirrors the row's age helper.

_From 347-read-request._

### 347-FR-004 — When the description is null or whitespace, the drawer MUST say "Clientul nu a adăugat o descriere." / "The customer added no description." in the description's place.

_From 347-read-request._

### 347-FR-005 — The drawer MUST show no e-mail ever, the phone only when the detail read carries it (this garage's quote accepted, never to a mechanic) and the plate only when the read carries it (a confirmed booking), with no new field added to the read for them.

_From 347-read-request._

### 347-FR-006 — Trimite oferta MUST open the existing send-quote dialog and Refuză the existing decline dialog, for this request, on top of the drawer; when either dialog returns a success the drawer MUST close and the feed MUST move the row out of the waiting list as it does today. The buttons MUST follow the row's current permission rule (the session's `garageAccess`).

_From 347-read-request._

### 347-FR-007 — The drawer MUST have the address `/app/garage/requests/:requestId` under the garage's requests view: opening the address loads the view with the drawer open on that request, opening a row navigates to it carrying its origin (Panou or the view) in router state, and closing the drawer navigates to that origin, else `/app/garage/requests`; the URL is the source of truth, so browser Back closes the drawer. The view's existing `**` sub-path ownership carries it; no new route guard.

_From 347-read-request._

### 347-FR-009 — `REQUEST_RECIPIENT` MUST gain a nullable `first_seen_at` (timestamptz), set to now by any successful detail read for the reader's garage when it is still null (the send-quote dialog's read included), and never changed afterwards (the update is conditional on null, so two concurrent reads keep the earlier time); a refused read writes nothing; no audit entry and no event is written for it.

_From 347-read-request._

### 347-FR-010 — While the drawer is open, the web MUST re-read the request within 5 seconds when the garage's live channel delivers `quote.sent`, `request.declined`, `request.cancelled`, `request.expired` or `quote.accepted` for that request id, through the existing garage feed's subscription, and MUST show a closed banner when the read's `closedReason` or `recipient.status` says the garage can no longer answer: one text per reason ("Cererea s-a închis: clientul a anulat-o" / "The request closed: the customer cancelled it"; "… a expirat" / "… it expired"; "… un coleg a trimis o ofertă" / "… a colleague sent a quote"; "… un coleg a refuzat-o" / "… a colleague declined it"; "… clientul a ales alt service" / "… the customer chose another garage"; "… service-ul este suspendat" / "… the garage is suspended"; "… contul clientului a fost închis" / "… the customer's account was closed"), both buttons disabled. The banner keys on `recipient.status` / `closedReason` only: `quoted` shows the colleague text whoever sent it (no actor lookup); this garage's own accepted quote shows no banner but disables both buttons; an unknown reason shows "Cererea s-a închis." / "The request closed.". A request already closed when opened by its address shows the same banner. The banner is a live region (`role="status"`), so a screen reader announces it when it appears. A re-read keeps the fields already shown in place (no return to the skeleton). A banner that appears while the send-quote or decline dialog is open sits under that dialog; the dialog's own 409 handling stands and the drawer shows the banner once the dialog closes.

_From 347-read-request._

### 347-FR-011 — The detail read MUST tell the web why the garage can no longer answer when it opens a closed request: `closedReason` filled on the detail from the same rule the list uses for its closed rows (today the detail leaves it null) and `recipient.status`, so FR-010 needs no second source.

_From 347-read-request._

### 347-FR-012 — The drawer MUST show, while the read is in flight, the drawer frame with its title and skeleton lines in place of the fields and both buttons disabled; on a failed read, "Nu am putut încărca cererea. Încearcă din nou." / "We could not load the request. Try again." with a retry button; when offline, what was loaded, the dashboard's existing offline line and both buttons disabled until the connection returns.

_From 347-read-request._

### 347-FR-013 — Every new text MUST exist in Romanian and English (hyphenated Romanian words with U+2011); the drawer MUST pass the sweep at 320 px, 390 px, tablet and desktop, light and dark, both languages, with no sideways scroll, no text under 12 px, every button at least 44 px tall and the banner's text at a contrast of at least 4.5:1; the web component is a folder (`<name>.ts`, `<name>.html`, `<name>.css`) under `apps/web/src/app/dashboard/garage-requests/`.

_From 347-read-request._

### 347-FR-014 — Tests MUST exist before the code (Principle II). In Jest on real PostgreSQL: the detail carries the snapshot, the jobs with `offered`, the description and `expiresAt`, and never e-mail, a phone before acceptance or a plate before confirmation; `first_seen_at` set by the first read and unchanged by a second, also under two concurrent reads; nothing written by a refused read; 403 for a mechanic without the permission; 404 for another garage's owner and for a request not sent to the garage; `closedReason` on the detail of a cancelled, expired, declined, quoted-by-colleague, accepted-elsewhere and suspended request. In Jest, web: the row opens the drawer and its buttons do not; the car line with and without an engine; the not-offered heading in singular and plural; the no-description text; the received and expiry wording in both languages; the phone and plate shown only when the read carries them; the address opens the drawer and closing returns; each banner text per reason and the disabled buttons; the loading, error, retry and offline states. End to end (Playwright): the seeded owner opens a waiting request from the list, reads the customer, car, jobs and description, sends a quote from the drawer, and sees the row leave the list.

_From 347-read-request._

### 222-FR-001 — The API MUST offer `POST /api/v1/quotes/:id/accept` to the driver who owns the quote's request, taking a body `{ historyShared?: boolean }` (default false; any other type is 400 `validation_failed` naming `historyShared`) and the `Idempotency-Key` header with the send's rules (1 to the existing maximum of characters, else 400 naming it); it MUST answer 201 with the booking as the driver reads it (the existing booking DTO) and 404 `not_found` to every other caller, a garage account or another driver included, writing nothing; a visitor with no session is asked to sign in (401 `sign_in_required`, the platform's guard on every route not public), writing nothing.

_From 222-booking-from-quote._

### 222-FR-002 — The accept MUST lock the request row (`SELECT … FOR UPDATE`) before judging anything, then, in that one transaction: check, in this order, the quote is `waiting`, the request holds no booking `awaiting_confirmation` or `confirmed`, the request is `quoted`, the quote is not past `expires_at`, its slot is not past and its garage is not `suspended`; create the BOOKING first, so its id exists for the event; move the quote to `accepted` and the request to `booked` through the transition service (their audit entries included, 220-FR-008, 220-FR-011), the BOOKING created with `quote`, `request`, `garage`, `driver`, `starts_at` = the quote's slot, `duration_minutes` = the quote's, status `awaiting_confirmation`, `confirm_by` = the earlier of `accepted_at` + BOOKING_CONFIRM_LAPSE_HOURS and `starts_at`, `history_shared` as given; record one audit entry for the booking's creation (subject `booking`, field `stage`, old value null, new value `awaiting_confirmation`) and one for the history choice (field `history_shared`) through the audit port, which marks an assistant grant's call `via assistant` as it does today; and write exactly one outbox event `quote.accepted`, the quote's move's own event, with `{ quoteId, requestId, bookingId, historyShared }` to the audiences `account:{driverId}` and `garage:{garageId}`; the request's move is filed with no event of its own (as the send's is), never a second `quote.accepted`. The other quotes of the request MUST stay `waiting`; nothing is written when any check fails.

_From 222-booking-from-quote._

### 222-FR-003 — The accept MUST be idempotent per driver: BOOKING gains `idempotency_key` (text, nullable for rows other stories create, unique with `driver_id`), and a second call with the same key and driver MUST answer 200 with that booking as it reads now (no stored response body) without writing anything, whatever its body or quote id; two calls with the same key at the same moment are serialised by the request lock, so the second answers that replay; a refused call stores nothing, so its key stays free. A different key on an already accepted quote is refused as FR-004 says.

_From 222-booking-from-quote._

### 222-FR-004 — A refused accept MUST answer the platform's problem details (220-FR-015): 409 `invalid_transition` carrying the entity and current state for a quote `expired`, `withdrawn`, `lost`, `declined_by_driver` or `accepted`, for a `waiting` quote past `expires_at` (state `expired`, the row left to the sweep), for a `suspended` garage's quote (state `withdrawn`, the row left as it is) and for a request not `quoted`; 409 `booking_pending` with the message "Ai deja o programare în așteptare" / "You already have a booking waiting" when the request holds a booking `awaiting_confirmation` or `confirmed` (checked after the quote's own state and before the request's, so a second quote of a booked request names the booking, while the same quote accepted twice names `accepted`); 409 `slot_passed` with "Ora propusă a trecut" / "The proposed time has passed" when the slot is not after now. Two concurrent acceptances on one request MUST end with exactly one booking: the loser reads the winner's rows after the lock and answers 409 as above; the database's one-accepted-quote index is the last guard (220-FR-009) and answers 409, never 500.

_From 222-booking-from-quote._

### 222-FR-006 — The driver's requests list read (`GET /api/v1/requests`, 220-FR-012 lineage) MUST carry, per request, its newest booking's `status` and `confirmBy` when one exists (null otherwise), so the row can show the waiting line without a detail read; the detail is unchanged.

_From 222-booking-from-quote._

### 222-FR-007 — The driver's Cererile mele row of a `booked` request whose booking is `awaiting_confirmation` MUST show, under the existing status label Programată / Booked, the line "Așteaptă confirmarea service‑ului · încă N h" / "Waiting for the garage · N h left", N the whole hours left until `confirmBy` (rounded down), "încă N min" / "N min left" under one hour, "încă câteva secunde" / "moments left" under one minute or past; the line re-renders at least every minute while shown and shows for no other booking status.

_From 222-booking-from-quote._

### 222-FR-008 — The garage's Oferte trimise row of an accepted quote (FR-005) MUST read "Acceptată · așteaptă confirmarea ta" / "Accepted · waiting for your confirmation" in place of "În așteptare", followed by the time left in FR-007's wording ("încă N h" / "N h left"), and, when the row carries it, the driver's phone as a `tel:` link; the row keeps the request's name, car, jobs, range and slot, and its lamp takes a distinct accepted colour. The request drawer opened from the row MUST show the phone as it does today.

_From 222-booking-from-quote._

### 222-FR-009 — The driver's Cererile mele view and the driver home MUST re-read within 5 seconds when the driver's live channel delivers `quote.accepted` (added to the kinds each already listens to); the garage feed already re-reads on it (347-FR-010) and MUST move the row from "waiting" rendering to the accepted rendering without a reload.

_From 222-booking-from-quote._

### 222-FR-011 — Nothing the garage reads (its list, its detail, its drawer, its notifications) MUST carry the car's history or the repairs the driver logged elsewhere, whether or not `history_shared` is true: the garage's booking carries the flag only (the existing `historyShared` on its booking DTO) and no history field is added; the read-only view is #288 and access opens at confirmation (#82).

_From 222-booking-from-quote._

### 222-FR-012 — The booking MUST keep the quoted range through the quote it points to (`from_bani`, `to_bani`, unchanged by the accept); no price is written on the booking.

_From 222-booking-from-quote._

### 222-FR-013 — Every new text MUST exist in Romanian and English (hyphenated Romanian words with U+2011); the two rows MUST pass the sweep at 320 px, 390 px, tablet and desktop, light and dark, both languages, with no sideways scroll, no text under 12 px and the phone link at least 44 px tall; no new web component is needed (the existing row components gain the lines), and any new one is a folder (`<name>.ts`, `<name>.html`, `<name>.css`).

_From 222-booking-from-quote._

### 222-FR-014 — Observability (AGENTS.md): the new endpoint and the `quote-accepted` consumer queue MUST be listed in `infra/observability/inventory.json`; the accept (a product action) MUST emit one counter of acceptances with the outcome (`accepted`, `replayed`, `booking_pending`, `slot_passed`, `invalid_transition`, `refused`, the last standing for the 404 and for the missing or bad `Idempotency-Key` 400 the controller raises; a body rejected by the global validation pipe never reaches the action and is counted by the HTTP metrics by status) in the quotes metrics module, one log line per outcome naming the quote id, and the existing queue metrics cover the consumer; the PR's Observability section lists them.

_From 222-booking-from-quote._

### 222-FR-015 — The OpenAPI document and the generated client MUST carry the new operation, the body DTO, the new 409 codes and the list DTOs' new fields (`npx nx run data-access:generate`, never edited by hand).

_From 222-booking-from-quote._

### 222-FR-016 — Tests MUST exist before the code (Principle II). In Jest on real PostgreSQL: scenario 1 in one transaction with the other quotes `waiting` and `confirm_by` by both arms; the audit entries and the outbox event in the same transaction, the via-assistant mark for a grant; `history_shared` true, false and absent; the replay (200, same body, nothing written) and the same-key race; exactly one `quote.accepted` outbox row per accept; 409 `booking_pending` for a second quote of a booked request; `invalid_transition` for `expired`, `withdrawn`, `lost`, `declined_by_driver`, `accepted`, a `waiting` quote past `expires_at`, a suspended garage and a request not `quoted`; `slot_passed`; an unconfirmed e-mail accepts; two concurrent acceptances (two quotes, and the same quote twice) ending with exactly one booking; 404 for another driver and a garage account, 401 for a visitor; 400 for a bad body and a missing key; the garage list carrying the accepted row with `confirmBy` and the phone for the owner and the receptionist, no phone for the mechanic and none on waiting rows; the plate absent before confirmation; the driver list carrying the booking's status and `confirmBy`; no history field in any garage read; the consumer building one QUOTE_ACCEPTED per owner and receptionist, none for a mechanic, and none when the booking has moved on. In Jest, web: the driver row's waiting line in hours, minutes and moments, in both languages, and absent for other statuses; the garage row's accepted wording, time left and phone link present or absent; the re-read on `quote.accepted` in the driver's view and home. In Playwright, one end-to-end test: a driver with two quotes accepts one through the API from the browser session, sees Programată with the waiting line in Cererile mele, and the garage owner sees the accepted row with the phone in Oferte trimise.

_From 222-booking-from-quote._

### 1169-FR-004 — For a session opened as a garage the warm MUST read the garage's `waiting`, `quoted` and `closed` request lists (`GET /api/v1/garage/requests?status=…`, first page) as the garage home reads them, each stored under kind `garage-home`, the garage id and the `status`, tagged `warm:garage:{garageId}` and `warm:account:{accountId}`. An account with no garage warms nothing.

_From 1169-prefetch-intent._

### 1169-FR-005 — The four list reads FR-003 and FR-004 name MUST, when the request is authenticated and carries no cursor and (garage) exactly the warmed `status` value, first take a warm entry for the actor's own account (driver) or own garage (garage) and answer it; otherwise they answer from the database as today. The answer body, status and `Cache-Control: private, no-cache` are the same either way. Any matching read takes the entry, not only the home's (the add-car and quote dialogs also read `GET /api/v1/cars`); no header or route hint marks the home. A warm entry is never answered to another account, to another role or to an unauthenticated request; no new route is added and the public-routes list is unchanged.

_From 1169-prefetch-intent._

### 049-FR-009 — Accepting a waiting quote of a suspended garage MUST keep answering 409 with the quote read as `withdrawn` (the existing rule in the acceptance use case), whether or not the worker has withdrawn the quote yet, and MUST create no booking; the driver's quote reads answer status `withdrawn` for a waiting quote of a suspended garage, from the garage's status, before the withdrawal is written; the label "Retrasă · service suspendat" / "Withdrawn · garage suspended" is the driver quote card's, which does not exist in `apps/web` yet, so this story adds no web text or i18n key for it.

_From 049-garage-suspension._

### 313-FR-001 — The API MUST offer `GET /api/v1/quote-requests/:id/quotes` to the driver who owns the request, and to an AI assistant reading with that driver's consent under the existing actor rule of the driver's request reads; every other caller (another driver, a garage-side actor, an unknown id) MUST get 404 `not_found` in the platform's problem-details shape (220-FR-015), with no other sign that the request exists; a malformed (non-uuid) id answers 400 `validation_failed`, as `GET /api/v1/requests/:id` does. The route needs a session (`ActorGuard`), carries no `@Public()`, and the operation and its DTOs join `apps/api/openapi.json` and the generated client (`npx nx run data-access:generate`, never edited by hand).

_From 313-compare-quotes._

### 313-FR-002 — The read MUST answer, in one body: the request (`id`, `status`, `jobs` with their names in both languages and the description's first line, the car snapshot, and its newest booking's `status` and `confirmBy` when one exists); `quotes`: one per QUOTE of the request in status `waiting`, `accepted`, `lost`, `expired` or `declined_by_driver`, each with `id`, `garage` (`id`, `name`, `slug`, `rating` one decimal or null, `reviewCount`, `area`: the garage's city name, null when unknown, and `mobile` true for a mobile mechanic), `fromBani`, `toBani`, `durationMinutes`, `slot`, `note`, `status`, `sentAt`, `changedAt`, `expiresAt` and `jobs` (each request job with `included` and its names); `withdrawn`: one per QUOTE in status `withdrawn`, with the garage's name and `reason` ∈ `garage` (the garage withdrew it), `suspended` (the garage is suspended); `declined`: one per REQUEST_RECIPIENT whose decline is past its undo window, with the garage's name and `declineReason` (the existing rule the driver's detail applies); `waiting`: the names of the recipient garages that have not answered yet. Nothing private travels: no phone, address, e-mail or plate.

_From 313-compare-quotes._

### 313-FR-003 — The read MUST return `quotes` fastest answer first: `sentAt` ascending, equal times by id ascending; this is the panel's default order, "Cele mai rapide" / "Fastest".

_From 313-compare-quotes._

### 313-FR-004 — The panel MUST offer four sorts in one control above the rows (Cockpit segmented control: "Cele mai rapide", "Preț", "Cel mai devreme", "Notă" / "Fastest", "Price", "Earliest", "Rating"), applied in the browser without a new read: Preț orders by `fromBani` ascending then `toBani` ascending; Cel mai devreme by `slot` ascending; Notă by `rating` descending with null ratings after every rated one, then `reviewCount` descending; every sort falls back to `sentAt` ascending then id. Greyed rows (`expired`, `declined_by_driver`, `lost`) sort with the rest under the same rule. The chosen sort MUST be kept for the browser session (per tab, `sessionStorage`, read inside try/catch) and restored on a later panel in the same tab; a new tab starts on Cele mai rapide.

_From 313-compare-quotes._

### 313-FR-005 — The header MUST read "<jobs> · <brand> <model> · <N> oferte" (English "<N> quotes"), the jobs in the reader's language joined by ", " (the description's first line when the request has no job), and N the count of rows shown that are not `declined_by_driver` (so `waiting`, `accepted`, `lost` and `expired` count; `withdrawn` never has a row). Romanian plural follows the language library: "1 ofertă", "3 oferte", "21 de oferte".

_From 313-compare-quotes._

### 313-FR-006 — Each quote row MUST show, in this order, the same five things: (1) the garage's name; (2) the area and first free slot, "<area> · liber <when>" / "<area> · free <when>", where the area is the garage's city, "Mecanic mobil" / "Mobile mechanic" for a mobile mechanic, and the slot alone when the city is unknown; `when` is "azi, HH:mm" / "today, HH:mm", "mâine, HH:mm" / "tomorrow, HH:mm", or the weekday and date "luni, 12 oct., HH:mm" / "Mon 12 Oct, HH:mm", judged and shown in Europe/Bucharest; (3) the rating with one decimal and the language's decimal mark ("4,7" / "4.7"), or "fără recenzii" / "no reviews yet" when null; (4) the range "<from>–<to> lei" from integer bani with the Romanian thousands separator, the shared range helper's form ("890–1.400 lei", one amount when both ends are equal); (5) the action place. Under the range: the duration "aprox. <d>" / "about <d>" (`45 min`, `1 h`, `1 h 30`, the shared duration helper's form), then the garage's note as plain text when there is one, then "Nu face: <jobs>" / "Does not do: <jobs>" naming every request job the quote left out (`included` false), in the reader's language joined by ", ". A row with `changedAt` set adds "Modificată <relative time>" / "Changed <relative time>" with the existing relative-time helper.

_From 313-compare-quotes._

### 313-FR-007 — The action place and the row's look MUST follow the quote's status: `waiting` (and `expiresAt` in the future) holds Acceptă; `waiting` past `expiresAt`, or `expired`, greys the row with "Expirată" / "Expired" and no action; `declined_by_driver` greys it with "Refuzată de tine" / "Declined by you" and no action; `accepted` reads "Acceptată" / "Accepted" with no action; `lost` greys it with "Închisă" / "Closed" and no action. While the request's newest booking is `awaiting_confirmation`, every `waiting` row reads "În așteptare" / "On hold" in place of Acceptă; when that booking lapses the rows get Acceptă back live, on the re-read `booking.lapsed` triggers (FR-010).

_From 313-compare-quotes._

### 313-FR-008 — Acceptă MUST call the existing accept (`POST /api/v1/quotes/:id/accept`, `historyShared: false`, a fresh `Idempotency-Key` per click kept for a retry of the same click) and re-read the panel on success; while in flight the button shows the form helper's busy state and the row's other buttons are disabled; a refusal shows the server's problem text under the row with no state change. The consent tick, the booking card and everything else of accepting are #61 / #262 and out of this story.

_From 313-compare-quotes._

### 313-FR-009 — Under the rows the panel MUST show one line per withdrawn quote and one per declined garage: "<Garage> și-a retras oferta" / "<Garage> withdrew its quote" for reason `garage`; "<Garage> nu mai primește cereri" / "<Garage> no longer takes requests" for `suspended`; "Refuzat: <Garage> · <reason>" / "Declined: <Garage> · <reason>" where <reason> is the driver-side clause the platform already keeps for each of the four decline reason codes (`DECLINE_REASON_TEXTS[code].clause` in `libs/contracts/src/request-status.ts`, e.g. "nu lucrează pe această marcă, model sau motor"), so no new key is added, only once the undo window has passed; an undone decline removes its line on the next read. Withdrawn and declined garages are never rows and never counted.

_From 313-compare-quotes._

### 313-FR-010 — The panel MUST re-read its request within 5 seconds, through the existing live helper (one coalesced read per burst, one read in flight), when the driver's channel delivers `quote.sent`, `quote.changed`, `quote.withdrawn`, `quote.expired`, `quote.declined_by_driver`, `request.declined`, `request.decline_undone`, `garage.suspended`, `quote.accepted`, `booking.confirmed` or `booking.lapsed`. A suspension reaches the driver's channel as `quote.withdrawn` with `reason` `suspended`: `garage.suspended` is recorded for the garage and the public channel only, so the suspension MUST also record, in the same transaction that suspends the garage, one `quote.withdrawn` event per waiting quote of that garage for its driver (`garage.suspended` stays in the panel's list, harmless); the panel stays on the request it shows (the overview re-selects only on its next load); the re-read is merged by structural sharing so an unchanged row keeps its element, a new quote lands in its sorted place and the header count follows (US3).

_From 313-compare-quotes._

### 313-FR-011 — `QUOTE` MUST gain a nullable `first_seen_at` (timestamptz), set to now by every successful read (the driver's or the assistant's) for each quote returned in `quotes` whose value is null (withdrawn entries are not written), conditionally on null so two concurrent reads keep the earlier time, never changed afterwards; a refused read writes nothing; no audit entry and no event is written for it; the migration adds the column with no backfill.

_From 313-compare-quotes._

### 313-FR-012 — The overview's `quotes` panel MUST show the comparison for the driver's most recent open request with quotes, where "with quotes" means at least one quote that has a row (`waiting`, `accepted`, `lost`, `expired` or `declined_by_driver`) and "open" means status `quoted`, or `booked` while its newest booking is `awaiting_confirmation`, and "most recent" is the request's creation time; the panel's heading link keeps pointing at Cererile mele; with no such request the panel keeps today's states (loading, failed, #262's empty state). The driver's requests list read MUST carry what this needs without a detail read per request (the status and booking fields it already has, plus the quotes count it already has); that count includes withdrawn quotes, so the list picks the request by `quotesCount > 0` and, when the comparison read then has no row (every quote withdrawn), the panel shows today's #262 state, as the zero-row edge case says (no new count field, Principle I).

_From 313-compare-quotes._

### 313-FR-013 — Cererile mele MUST show the same panel above Toate cererile, for the most recent open request with quotes by default; a row of Toate cererile whose request has quotes MUST carry a link that opens that request in the panel (`/app/driver/requests?request=<id>`), the address being the source of truth so a reload or browser Back keeps or restores the shown request; an id that is not the driver's or has no quotes falls back to the default.

_From 313-compare-quotes._

### 313-FR-014 — States: while the read is in flight the panel shows three skeleton rows (`aria-busy`); on a failed read "Nu am putut încărca ofertele." / "We could not load the quotes." with a Reîncearcă / Retry button that reads again; offline, the last rows stay with the dashboard's existing offline line and Acceptă disabled; a background re-read that fails leaves the rows as they are (the live helper's rule).

_From 313-compare-quotes._

### 313-FR-015 — Every new text MUST exist in Romanian and English (hyphenated Romanian words with U+2011); the panel MUST pass the sweep at 320 px, 390 px, tablet and desktop, light and dark, both languages, with no sideways scroll, no text under 12 px, every button at least 44 px tall, the greyed rows' text at a contrast of at least 4.5:1, the sort control reachable by keyboard with its chosen option announced, and a row, a line or the header count that a live re-read adds or changes announced politely (a polite live region around the header and the lines, `aria-live="polite"`), without moving focus; the panel and its row are web components as folders (`<name>.ts`, `<name>.html`, `<name>.css`), the row's five things in one grid that stacks on a phone.

_From 313-compare-quotes._

### 313-FR-016 — Observability (AGENTS.md): the new endpoint MUST be listed in `infra/observability/inventory.json` with the API's existing request metrics and logs as its telemetry (a read adds no counter of its own and no alert beyond the API's error-rate alert; the entry says so); no new queue, service or outside call is added.

_From 313-compare-quotes._

### 313-FR-017 — Tests MUST exist before the code (Principle II). In Jest on real PostgreSQL and Redis: the read's 200 for the driver and for the assistant, the suspension's one `quote.withdrawn` per waiting quote in the suspending transaction, 404 for another driver, a garage actor and an unknown id; the default order with equal `sentAt`; the quotes' statuses split into rows, withdrawn (both reasons) and declined only past the undo window, undone excluded; left-out jobs; the garage's rating, review count, area and mobile flag; `first_seen_at` set once and under two concurrent reads, nothing written by a refused read; no phone, e-mail or plate in the body. Web unit tests: the four sorts with their ties and the unrated garage last; the header for one, three and twenty-one quotes and a request without a job; the slot's today, tomorrow and weekday forms in Europe/Bucharest; the duration forms; the range formatting; each status rendering and the on-hold rule; the sort kept in the session; the live kinds triggering a re-read. Playwright: with two seeded quotes the panel lists them fastest first; re-sorting by price changes the order; a third quote sent by a garage in a second context appears without a reload and the count reads 3.

_From 313-compare-quotes._

## Retired

- `220-FR-001` — superseded by `221-FR-008` (2026-10-09)
- `220-FR-010` — superseded by `221-FR-009` (2026-10-09)
- `220-FR-016` — superseded by `221-FR-018` (2026-10-09)
- `220-FR-012` — superseded by `343-FR-002` (2026-10-09)
- `220-FR-013` — superseded by `343-FR-003` (2026-10-09)
- `343-FR-002` — superseded by `344-FR-008` (2026-10-09)
- `343-FR-003` — superseded by `344-FR-007` (2026-10-09)
- `343-FR-008` — superseded by `344-FR-009` (2026-10-09)
- `221-FR-014` — superseded by `030-FR-009` (2026-10-10)
- `221-FR-015` — superseded by `030-FR-002` (2026-10-10)
- `220-FR-004` — superseded by `345-FR-006` (2026-10-10)
- `343-FR-002` — superseded by `345-FR-012` (2026-10-10)
- `343-FR-004` — superseded by `345-FR-012` (2026-10-10)
- `344-FR-009` — superseded by `345-FR-013` (2026-10-10)
- `343-FR-009` — superseded by `345-FR-016` (2026-10-10)
- `221-FR-004` — superseded by `357-FR-006` (2026-10-10)
- `343-FR-005` — superseded by `347-FR-008` (2026-10-11)
- `344-FR-008` — superseded by `222-FR-005` (2026-10-15)
- `221-FR-007` — superseded by `049-FR-008` (2026-10-17)

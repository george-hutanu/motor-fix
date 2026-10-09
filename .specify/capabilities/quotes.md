---
capability: quotes
updated: 2026-10-09
features:
  - 220-requests-quotes-bookings
  - 221-quote-request
  - 343-live-quote-requests
  - 344-send-quote
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

### 220-FR-004 — A REQUEST_RECIPIENT MUST store: request, garage, status ∈ `waiting`, `quoted`, `declined`, `expired`, `closed`, `source` ∈ `search`, `map`, `home`, `shared_link`, `profile_direct`, `saved`, `unknown`, `answered_at`, `decline_reason` (one of DECLINE_REASONS, only when `declined`), `declined_at` and `declined_by` (account; both only when `declined`, the undo window of DECLINE_UNDO_MINUTES counts from `declined_at`), `reminded_day2_at`, `reminded_day5_at`, `created_at`; one row per (request, garage) (FR-009). `closed` is for a garage that had not answered when the request closed or when the garage was suspended, and MUST be distinguishable from `expired` so the response rate can leave it out.

_From 220-requests-quotes-bookings._

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

### 344-FR-008 — `GET /api/v1/garage/requests` MUST accept a third `status` value, `quoted`: the garage's recipients `quoted` whose quote is `waiting`, newest quote first (`sent_at` descending, equal times by id), with the existing shape, paging and `total` (343-FR-002); each row MUST carry its quote summary (`quote`: the shipped quote summary, id, `fromBani`, `toBani`, `durationMinutes`, `slot`, `sentAt`, `expiresAt`, status); a `waiting` row carries null `quote`, and a `closed` row keeps the quote it had, as shipped (343). A value outside the three answers 400 `validation_failed` naming `status`.

_From 344-send-quote._

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

### 221-FR-004 — The jobs offered MUST be the distinct job types of the garage's visible price list (every GARAGE_PRICE row marked visible, whatever brand it names, in the list's order), read with the garage's public profile; the driver switches them on and off in the dialog. A request MUST hold at least one job or a description; the description MUST be at most 1,000 characters and at least 10 when no job is switched on; a job type repeated in the call is refused. The dialog disables Trimite and shows the reason under the field until these hold; the API answers 400 `validation_failed` naming the field (`jobTypeIds`, `description`).

_From 221-quote-request._

### 221-FR-005 — `POST /api/v1/quote-requests` MUST take the car id, the garage ids (1 to REQUEST_MAX_GARAGES, no repeats), the job type ids (0 or more, no repeats), the optional description and, per garage, its `source`; it MUST require the `Idempotency-Key` header, 1 to 64 characters, and answer 400 `validation_failed` (field `idempotency-key`) without it. The DTOs live in the contracts library and the OpenAPI document and the generated client are regenerated (421-FR-015, 421-FR-016). The route needs a session and joins no public route (the public-routes test list is unchanged).

_From 221-quote-request._

### 221-FR-006 — The dialog's garage picker MUST start with the profile's garage ticked and MUST list up to five other garages, read through `GET /api/v1/quote-requests/garages` for the chosen car, the switched-on jobs and a place (the driver's shared location or typed address): approved garages that pass FR-007 for that car and those jobs within 25 km of the place, plus mobile mechanics whose service radius covers it, ordered as the garage search orders them (garage-search 043), the profile's garage left out; without a place the picker offers only the profile's garage and says so in one line, with the place picker to add one. The driver MUST be able to tick at most REQUEST_MAX_GARAGES (5) in all; a sixth tick is refused with "Poți alege cel mult 5 service‑uri" / "You can pick at most 5 garages". MotorFix never adds a garage the driver did not tick. The read needs a session and the `driver.requests` capability; it carries only each garage's id, name, slug, distance (none for a mobile mechanic) and whether it comes to the driver. A missing or malformed `carId`, `near` or job id answers 400 `validation_failed`; a car that is not the driver's answers 404; without `near` the read answers an empty list.

_From 221-quote-request._

### 221-FR-007 — The server MUST check routing for every garage of the call, in one query of the use case, never only in the browser: the garage's status is `approved`; GARAGE_BRAND for the car's brand has stance `works_on`; the car's fuel is ticked on that row; and, when the request has jobs, at least one requested job type is ticked in GARAGE_BRAND_JOB for that brand (a request with no job skips this check). A garage id that does not exist is treated as a garage that is not taking requests (`not_taking_requests`), so the answer never tells an existing garage from a missing one. Garages are checked in the order of `garageIds`; the first garage that fails MUST be answered with 400, code `garage_cannot_receive`, carrying `garageId`, `garageName` and `reason` ∈ `brand`, `fuel`, `jobs`, `not_taking_requests` (status not `approved`); nothing is written. The dialog translates the reason in the driver's language naming the garage ("Nu lucrează pe Dacia", "Nu lucrează pe motorină la Dacia", "Nu face lucrările cerute la Dacia", "Service‑ul nu mai primește cereri"), unticks that garage, and for `not_taking_requests` offers "Înapoi la căutare" / "Back to search". On the profile, when the address carries a brand the garage does not work on (ST-307's red lamp), Cere ofertă MUST be disabled with that lamp's text; in the dialog, a chosen car whose brand or fuel the profile's garage does not take shows the same line under the Select and disables Trimite.

_From 221-quote-request._

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

### 221-FR-013 — The API MUST answer 201 with the request as the driver reads it (the request DTO of 220-FR-012, with its recipients as garage id, name, slug and status); the dialog MUST then replace its form with the confirmation "Trimis către <garage>." / "Sent to <garage>." for one garage, "Trimis către <n> service‑uri." / "Sent to <n> garages." with the names listed for several, and a link "Vezi Cererile mele" / "See My requests" to the driver's requests view; closing the dialog returns to the profile with the button back. The "răspunde de obicei în aceeași zi" line is added by the response-rate story once a garage has a public rate (Assumptions).

_From 221-quote-request._

### 221-FR-014 — The driver dashboard's Cererile mele view MUST list the driver's requests from `GET /api/v1/requests` newest first: for each, the car ("Dacia Logan 2017"), the jobs' names in the person's language (or the description's first line when there are none), the status label from the contracts' label map (220-FR-003: `sent` → "Trimisă" / "Sent") and the relative time of its creation in the person's language and Europe/Bucharest ("acum câteva secunde" under one minute); with no request an empty state "Nicio cerere încă" / "No requests yet" with a "Cerere nouă" button. The view MUST re-read through the live helper (256-FR-002, 257-FR-008) on `request.created` so a request sent in another tab appears without a reload. Details, filters and the later statuses' content are other stories'.

_From 221-quote-request._

### 221-FR-015 — The driver dashboard's first view MUST show a primary button "Cerere nouă" / "New request" that opens Home (`/<lang>`), where the brand picker and the results lead to a garage profile; Home itself is unchanged.

_From 221-quote-request._

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

### 343-FR-002 — `GET /api/v1/garage/requests` MUST accept an optional `status` query, `waiting` or `closed`: `waiting` answers the waiting rows of FR-001, `closed` the garage's closed rows (a recipient `expired` or `closed`, or a recipient still `waiting` on a request no longer `sent` or `quoted`) that closed within the last 24 hours, the close time being the recipient's last status change when it moved, else the request's (each from the per-move audit entries; with no entry, the recipient's creation time); without `status` the read is unchanged. Both answers keep the existing shape `{ items, nextCursor, total }`, 20 a page, newest first by the request's creation time with equal times by id, cursor paging and the existing 400 `invalid_cursor` (220-FR-014); `total` is the count in the caller's scope for that filter. A value outside the two answers 400 `validation_failed` naming `status`. The DTOs stay in the contracts library; the OpenAPI document and the generated client are regenerated.

_From 343-live-quote-requests._

### 343-FR-003 — Each garage-side request summary MUST mark, per job, whether the garage does that job on the request's car brand (`offered`: GARAGE_BRAND_JOB has the job type ticked for that brand), so the screen can show "nu faceți" / "not offered" on the others. A request with no jobs has nothing to mark.

_From 343-live-quote-requests._

### 343-FR-004 — Each closed row MUST carry its reason, derived on the server and never stored anew: `cancelled` (request `closed` with `closed_reason` `cancelled`), `accepted_elsewhere` (request `booked`, or `closed` with `booking_lapsed`, `booking_cancelled` or `no_show`, with no accepted quote of this garage), `account_closed` (`closed_reason` `account_closed`), `expired` (recipient `expired`), `garage_suspended` (recipient `closed` while the garage is `suspended`); the reasons are one typed set in the contracts library with their Romanian and English labels ("Cerere anulată de client" / "Request cancelled by the customer", "Clientul a acceptat altă ofertă" / "The customer accepted another quote", "Cerere închisă" / "Request closed", "Cerere expirată" / "Request expired", "Service suspendat" / "Garage suspended"), a test failing when a reason lacks a label. Reasons are tried in the order `expired`, `garage_suspended`, `cancelled`, `account_closed`, `accepted_elsewhere`; a close matching none shows `account_closed`'s label "Cerere închisă" / "Request closed".

_From 343-live-quote-requests._

### 343-FR-005 — The reads of FR-002 MUST be open to the owner and the receptionist of the garage and to a mechanic of it with `can_answer_quotes`; every other caller, a mechanic without the permission and another garage's staff MUST get 404 (the existing policy, 220-FR-012); the routes need a session and join no public route. Rows carry the driver as first name and surname initial, the car snapshot (brand, model, year), the jobs in the reader's language, the request's creation time and expiry, and no phone, e-mail, plate or description beyond what 220-FR-013 already gives.

_From 343-live-quote-requests._

### 343-FR-006 — Panou MUST gain a section "Cereri de ofertă" / "Quote requests" above its empty state, replacing that empty state once the section exists: its heading, the counter "N fără răspuns" / "N unanswered", the four newest waiting rows and, when there are more than four, a link "Vezi toate" / "See all" to the Cereri de ofertă view. The section is present for the owner, the receptionist and a mechanic with `can_answer_quotes` (the session's `garageAccess` permissions, 097-FR-005), absent for a mechanic without it, and absent while the garage is `draft` (097-FR-008's line stays).

_From 343-live-quote-requests._

### 343-FR-007 — The Cereri de ofertă view MUST replace its empty-state placeholder with the waiting rows, newest first, 20 at a time, the next page loading when the list's end comes into view until `nextCursor` is null, and the closed rows of the last 24 hours greyed under the waiting rows loaded so far, each with its FR-004 label; the closed rows come from one `closed` read (its first page, not paged further) made with the first waiting read and re-read on the same events. Its title and subtitle stay as 097-FR-003 gives them. The view's menu entry and bottom tab MUST show the FR-001 count in the counter slot 097-FR-001 reserved, with no number at zero.

_From 343-live-quote-requests._

### 344-FR-009 — Each waiting row on Panou and in the Cereri de ofertă view MUST show a primary button "Trimite oferta" / "Send a quote" in its actions column for the owner, the receptionist and a mechanic with `can_answer_quotes` (the session's `garageAccess` permissions, 343-FR-015), absent for every other reader; it opens the send dialog in the shared overlay (`dialog` shape from 768 px, the bottom sheet under it; 157, 158, 491) for that request.

_From 344-send-quote._

### 343-FR-009 — The panel, the view and the counters MUST be kept current through the existing live helper (256-FR-002, 257-FR-008), re-reading on `request.created`, `quote.sent`, `request.declined`, `request.decline_undone`, `request.cancelled`, `request.expired` and `quote.accepted` received on the garage's stream, and on the stream's resync; a change MUST show within 5 seconds of the event's commit without a reload, a route change, a closed overlay or moved focus (256-FR-005), the first visible row kept in place (256-FR-008), the changed row highlighted (256-FR-009) and the counter change announced politely (256-FR-010). Rows arriving above a scrolled list are held and counted by the existing pill (256-FR-007). Every kind named here MUST exist in the contracts' event catalogue (257-FR-006); a kind no story records yet costs nothing until it is recorded.

_From 343-live-quote-requests._

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

## Retired

- `220-FR-001` — superseded by `221-FR-008` (2026-10-09)
- `220-FR-010` — superseded by `221-FR-009` (2026-10-09)
- `220-FR-016` — superseded by `221-FR-018` (2026-10-09)

- `220-FR-012` — superseded by `343-FR-002` (2026-10-09)
- `220-FR-013` — superseded by `343-FR-003` (2026-10-09)

- `343-FR-002` — superseded by `344-FR-008` (2026-10-09)
- `343-FR-003` — superseded by `344-FR-007` (2026-10-09)
- `343-FR-008` — superseded by `344-FR-009` (2026-10-09)

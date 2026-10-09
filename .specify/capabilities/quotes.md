---
capability: quotes
updated: 2026-10-08
features:
  - 220-requests-quotes-bookings
---

# Capability: Quotes

The request flow's shared data: a driver's quote request to several garages, the garages' quotes, the booking an accepted quote becomes, their statuses and allowed moves, the constants, and the read endpoints of both sides.

## Requirements

### 220-FR-001 — The system MUST store a QUOTE_REQUEST with: id, driver (account), car, car snapshot copied at creation (brand name, model, year, fuel, engine; editing the car later changes nothing on the request), description (optional text), status (FR-002), `created_at`, `expires_at` (= `created_at` + REQUEST_VALIDITY_DAYS: the same Bucharest wall-clock time that many calendar days later, stored UTC), `closed_reason` and `closed_at` (both only when `closed`), and the time of each status change in a status history that the audit history provides (FR-011); one REQUEST_JOB per requested job (request, job type, position), a request holding at least one job or a description; one REQUEST_RECIPIENT per garage (FR-004). Money is integer bani; every time column is a timestamp with time zone in UTC.

_From 220-requests-quotes-bookings._

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

### 220-FR-010 — One config module of the `quotes` module MUST hold, and every rule MUST read from it: REQUEST_MAX_GARAGES = 5, REQUEST_VALIDITY_DAYS = 7, QUOTE_VALIDITY_DAYS = 7, REQUEST_REMINDER_DAYS = [2, 5], BOOKING_CONFIRM_LAPSE_HOURS = 24, FREE_CANCEL_CUTOFF_HOURS = 2, BOOKING_MAX_MOVES = 2, MOVE_CUTOFF_HOURS = 2, DECLINE_UNDO_MINUTES = 5, PAGE_SIZE = 20, CANCEL_REASONS (driver: `plans_changed`, `found_another_garage`, `problem_solved`, `other`; garage: `no_mechanic_free`, `parts_not_available`, `closed_that_day`, `driver_asked`, `other`), DECLINE_REASONS (`fully_booked`, `job_not_done`, `make_model_engine_not_done`, `need_to_see_car`), No other file of the module repeats one of these values. The time zone for day counting, Europe/Bucharest, is the domain's own (its Bucharest-time helper, shared by every module) and is not repeated here.

_From 220-requests-quotes-bookings._

### 220-FR-011 — Every status change through the transition service MUST, in the caller's transaction, write one audit entry through the existing audit writer (390-FR-001: action `update`, subject type the entity's singular lowercase key (`quote_request`, `request_recipient`, `quote`, `booking`, `job`), subject id, field `status`, old and new value, the actor and role the caller gives, `garage_id`, `car_id` and `job_id` when known) and one outbox event through the existing event port (the kind the caller names from the contracts' event kinds, the subject id, and the audience: the driver's account and the garage, or the garages, concerned). When either write fails, the status change MUST roll back with it. This story emits no event of its own and notifies nobody; it gives later stories the transition service that writes both.

_From 220-requests-quotes-bookings._

### 220-FR-012 — The API MUST serve, for the capability `driver.requests` (the account's `driver` role): `GET /api/v1/requests` (the actor's own requests, newest first, paged, FR-014) and `GET /api/v1/requests/:id` (one own request with its jobs, its recipients' garage name and status, its quotes with their status, and its booking); for the capability `garage.requests` (the owner, a receptionist, a mechanic with `can_answer_quotes`): `GET /api/v1/garage/requests` (the requests with a recipient row for the actor's garage, newest first, paged) and `GET /api/v1/garage/requests/:id` (one such request with the garage's own recipient row, the garage's own quote, and the booking when it is the garage's); for the capability `garage.own_jobs` (owner, receptionist, mechanic): `GET /api/v1/garage/jobs` (the garage's jobs, newest first, paged; for a mechanic only jobs whose mechanic they are) and `GET /api/v1/garage/jobs/:id` (one such job with its status and times, the driver as in FR-013, the car snapshot of its request with the plate, its steps and its stage entries). Every other caller, a row outside the actor's scope, and a mechanic without `can_answer_quotes` on the requests routes get 404; the routes need a session (the app-wide guard) and join none of the public routes. Each answer type is a DTO in the contracts library; the OpenAPI document and the generated client are regenerated (421-FR-015, 421-FR-016).

_From 220-requests-quotes-bookings._

### 220-FR-013 — In the garage-side answers the driver MUST appear as first name and surname initial ("Andrei M."; a single-word name as is), the car as its snapshot (brand, model, year, fuel, engine), with the jobs and the description; the driver's phone MUST be present only once a quote of this garage is `accepted` and only for the owner and the receptionist (never a mechanic); the car's plate MUST be present only once the booking is `confirmed`, for the owner, the receptionist and the mechanic whose job it is (a mechanic with `can_answer_quotes` reading a request whose booking is another mechanic's, or has none, sees no plate). The driver-side answers carry no other driver's or garage staff's personal data: a garage appears as its id, name and slug. No log line and no event payload carries the phone, the plate or the description (421-FR-010, 253-FR-005).

_From 220-requests-quotes-bookings._

### 220-FR-014 — Every list endpoint of FR-012 MUST return `{ items, nextCursor, total }` (`total` the count of rows in the caller's scope) with at most PAGE_SIZE (20) items, newest first with equal times ordered by id, `nextCursor` the id of the last item or null on the last page, and MUST answer 400 `invalid_cursor` to a cursor that is not an existing row inside the caller's scope (a cursor that is not a uuid fails validation first: 400 `validation_failed`, FR-015) (391-FR-009, 391-FR-010).

_From 220-requests-quotes-bookings._

### 220-FR-015 — Errors MUST follow the platform's problem details (421-FR-008): 404 for a row that is not the caller's or a caller without the capability, 409 `invalid_transition` with the current state for a refused move or a refused uniqueness, 400 `validation_failed` with the field names for invalid input (the brief's 422 is replaced by the repository's convention, see Assumptions), 400 `invalid_cursor` for a bad cursor.

_From 220-requests-quotes-bookings._

### 220-FR-016 — The six new endpoints MUST be listed in `infra/observability/inventory.json` (its endpoint count follows `apps/api/openapi.json`; `scripts/observability-inventory.ts` passes); the story adds no service, queue or outside call, so no new dashboard panel or alert is owed, and the PR's Observability section says so.

_From 220-requests-quotes-bookings._

### 220-FR-017 — Tests MUST cover, in Jest on real PostgreSQL where rows are written: every allowed and every refused transition of QUOTE_REQUEST, REQUEST_RECIPIENT, QUOTE, BOOKING and JOB, including quote `waiting` → `declined_by_driver` and the suspension moves (recipient `waiting` → `closed`, quote `waiting` → `withdrawn`); each uniqueness of FR-009 under two concurrent transactions; the quote's field checks of FR-005; the audit entry and the outbox event written in the same transaction and both absent after a rollback; the cancellation key change; 404 for another driver, another garage, a mechanic without `can_answer_quotes`, and a mechanic reading another mechanic's job; no phone or plate before acceptance and confirmation, and the phone never for a mechanic; the page size, order and `invalid_cursor` of FR-014; the label map in Romanian and English covering every status; the constants read from one module. No end-to-end test: the story has no screen.

_From 220-requests-quotes-bookings._

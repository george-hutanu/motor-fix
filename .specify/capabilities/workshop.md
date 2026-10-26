---
capability: workshop
updated: 2026-10-25
features:
  - 220-requests-quotes-bookings
  - 424-job-steps
  - 389-confirm-booking-lift-mechanic
  - 274-request-stages
  - 423-mechanic-garage-dashboard
---

# Capability: Workshop

The work in the garage for a confirmed booking: the job, its stages and the time each began, its steps, and the final price recorded at handover.

## Requirements

### 389-FR-002 — The confirm MUST lock the booking row (`SELECT … FOR UPDATE`), then, in that one transaction, check in this order: the booking is `awaiting_confirmation` (else 409 `invalid_transition` with the entity `booking` and its state), `confirm_by` is after now (else 409 `invalid_transition` with the state `lapsed`, the row left to the lapse timer), the switches and the fields agree (FR-004, FR-005), the mechanic is one of the garage's (FR-004), the lift is within 1 … the garage's lift count (FR-006), the slot lies inside the opening hours (FR-008), and the mechanic and the lift are free (FR-007); then set `status` `confirmed`, `confirmed_at`, `confirmed_by` (the actor), `mechanic_id`, `lift`; create one JOB `to_do` for the booking (garage, the request's car, the driver, the mechanic of FR-005) with its first JOB_STAGE_ENTRY (no from-status, to `to_do`, the actor); move every other `waiting` quote of the request to `lost` and every `waiting` recipient to `closed` through the transition service; record the audit entries: the booking's `stage` (`awaiting_confirmation` → `confirmed`), `mechanic_id` and `lift` (old null), the job's creation; write the outbox events `booking.confirmed` `{ bookingId, requestId, quoteId, startsAt, durationMinutes, mechanicId, lift }` to the audiences `account:{driverId}`, `garage:{garageId}` and, when the platform routes one, `mechanic:{mechanicId}`, and one `quote.closed` `{ quoteIds, requestId }` to the driver's account and each losing garage; and clear the booking's three timers (FR-010) after the commit. The request stays `booked`. Nothing is written when any check fails.

_From 389-confirm-booking-lift-mechanic._

### 424-FR-001 — A JOB_STEP MUST also store `done_by` (the account that ticked it, optional; cleared with `done_at` on an untick), and the job's read MUST return each step's `doneAt` and `doneBy` and the job's steps done and total counts.

_From 424-job-steps._

### 424-FR-002 — The owner of the job's garage, and the job's mechanic (the mechanic row of `BOOKING.mechanic_id` / `JOB.mechanic_id` belonging to the caller's account), MUST be able to add a step, rename a step, reorder the steps, remove a step, tick a step and untick a step on that job. A receptionist of the garage, and another mechanic of the garage, MUST be answered 403 on every one of these writes; anyone outside the garage 404. Reading a job follows the same rule: another mechanic of the garage 403 (Architecture decision A34), outside the garage 404.

_From 424-job-steps._

### 424-FR-003 — A step's text MUST be 2 to 80 characters after trimming, stored as written in both `label` and `customer_label`; a text outside that range, or made of spaces, MUST be refused as a validation failure.

_From 424-job-steps._

### 424-FR-004 — A job MUST hold at most 20 steps; the 21st add MUST be refused with code `too_many_steps` (409) and the message "Cel mult 20 de pași".

_From 424-job-steps._

### 424-FR-005 — Positions MUST be whole numbers 1 to n with no gaps: an add takes n+1, a removal closes the gap, and a reorder MUST name every step of the job exactly once and rewrite every position in one transaction, else be refused as a validation failure.

_From 424-job-steps._

### 424-FR-006 — Adding, renaming, reordering and removing MUST be allowed while the job is `to_do`, `in_work` or `paused`; ticking and unticking MUST be allowed while it is `in_work` or `paused` and refused with 409 (`job_not_started`, "Pornește lucrarea mai întâi") while it is `to_do`. Every step write on a `done` or `cancelled` job MUST answer 409 (`job_closed`). Ticking never moves the job's stage, and the job can be marked done with steps unticked.

_From 424-job-steps._

### 424-FR-007 — A tick MUST set `done_at` = now and `done_by` = the caller; an untick MUST clear both. Ticking a ticked step or unticking an unticked one MUST change nothing and answer success, so a resent action is harmless.

_From 424-job-steps._

### 424-FR-008 — Every step write MUST run in one transaction that locks the job's row (as the stage moves do), judges the state and the rules against the locked row, writes the change, its audit entries and its event, so no change is saved without them and two simultaneous changes are applied one after the other.

_From 424-job-steps._

### 424-FR-009 — The audit history MUST record every add, rename, reorder, removal, tick and untick with the actor, their role, the job, the step and the old and new value (text for a rename, the position list for a reorder, done time for a tick), filed under the job and the garage, and marked so it is not among the driver's key changes.

_From 424-job-steps._

### 424-FR-010 — The events MUST be `job.step_done` (jobId, stepId) on a tick, `job.step_undone` (jobId, stepId) on an untick and `job.steps_changed` (jobId) on an add, rename, reorder or removal, each with the `job` audience (the driver's account, the garage, the job's mechanic), written in the same transaction as the change. No notification is sent for a step.

_From 424-job-steps._

### 424-FR-011 — The API MUST offer, under the existing `garage/jobs` routes and the `garage.own_jobs` capability: the job list filtered to jobs whose booking starts on or after a given day (default today, in the garage's Bucharest wall clock), plus every `in_work` or `paused` job whatever its day, ordered by booking start, each item carrying its booking start, the job names, the mechanic's name, the plate and the steps done and total; and the step writes: add (POST `steps`, with a required `Idempotency-Key` header: a resend with the same key returns the step it created, never a second one, whatever text the resend carries), rename (PATCH `steps/:stepId`), reorder (PUT `steps/order`), remove (DELETE `steps/:stepId`), tick and untick (PUT `steps/:stepId/done` with `{ done }`). DTOs come from the contracts library, validated at the edge; the generated client is regenerated.

_From 424-job-steps._

### 424-FR-012 — The garage dashboard MUST offer a "Lucrări" view at `/app/garage/jobs` to every role holding `garage.own_jobs`, listing the garage's jobs from today on by booking start, each row with time, car, plate, job names, mechanic, stage and "n din m gata"; skeleton rows while loading; "Nicio lucrare azi" when today is empty, the next jobs below. A mechanic's list holds only their own jobs.

_From 424-job-steps._

### 424-FR-013 — Opening a job MUST show "Pașii lucrării" in the shared overlay panel: a right-side drawer from 768 px and the bottom sheet under it: each step a row with a tick, its text and a menu with "Redenumește", "Mută mai sus", "Mută mai jos" and "Șterge"; "Adaugă un pas" at the end; the counter "n din m gata". The controls are shown to the owner and the job's mechanic only; a receptionist, and anyone on a `done` or `cancelled` job, sees the steps read-only. On a `to_do` job the tick sends nothing: tapping it shows "Pornește lucrarea mai întâi" (the server still refuses it, FR-006). Reordering is done from the step's menu, "Mută mai sus" and "Mută mai jos", which work by touch and keyboard; there is no drag handle.

_From 424-job-steps._

### 424-FR-014 — Saving MUST be optimistic: the panel shows the change at once and returns the step to its last saved state with a short message in the person's language when the call is refused. Ticks and unticks MUST go through the app's workshop action queue (`job.step`), so a tick made without signal is sent when the connection returns. An add, rename, reorder or removal is not queued: when it fails, for want of signal or because it was refused, it returns to the last saved state with the short message. A queued tick that arrives after a newer change by someone else wins (last write wins); conflicts are the job lock story's.

_From 424-job-steps._

### 424-FR-015 — The list and the open panel MUST re-read on `job.step_done`, `job.step_undone`, `job.steps_changed`, the job's stage events and `job.mechanic_changed` through the garage's live stream, a burst as one re-read, so a second person's change shows within seconds without a reload.

_From 424-job-steps._

### 424-FR-016 — Every label MUST exist in Romanian and English; the list and the panel MUST show without sideways scrolling at 320 px and 390 px, on a tablet and a desktop, light and dark. Every control is at least 44 px tall, every refusal message is announced to assistive technology, and every control is reachable and operable by keyboard.

_From 424-job-steps._

### 424-FR-017 — The new routes MUST be listed in `infra/observability/inventory.json` with their metrics and alert (or why none), and in the PR's Observability section.

_From 424-job-steps._

### 424-FR-018 — Tests MUST cover, in Jest on real PostgreSQL and Redis: add, rename, reorder, remove, tick and untick by the owner and by the job's mechanic; 403 for a receptionist's writes and for another mechanic of the garage; 404 for another garage; a resent add with the same `Idempotency-Key` makes one step; positions without gaps after a removal and a reorder; the text limits and the cap of 20; ticks refused while `to_do` and everything refused once `done` or `cancelled`; `done_by` stored and cleared; audit rows and events in the same transaction; two simultaneous writes both applied; the list's day filter, order and counts. Web unit tests cover the view's controls per role and state, the optimistic save and the queue. End to end (Playwright): the owner adds three steps to a job in work; the job's mechanic, signed in on a phone, ticks one; in a second browser the owner's open panel shows "1 din 3 gata" without a reload.

_From 424-job-steps._

### 274-FR-001 — The API MUST offer `GET /api/v1/quote-requests/active`, for the signed-in driver only (capability `driver.requests`; any other role answered 404, a visitor asked to sign in), returning the driver's active request or `null`, and the number of the driver's open requests. A request is open when its status is `sent`, `quoted`, `booked` or `in_work`, or `done` with its job not yet handed over; a `booked` or `in_work` request with no live booking (awaiting the garage, confirmed or completed), as after a no-show, is not open. Another driver's requests are never read.

_From 274-request-stages._

### 274-FR-002 — The active request MUST be the open request closest to the workshop by its stage (FR-003): in work, then booked, then waiting for quotes (`sent` or `quoted`), then done (car ready, last: nothing yet records the handover that ends it); a tie goes to the request changed most recently (the latest of its creation, its quotes' sending, its booking's creation or confirmation and its job's start, pause or finish), then to the newest id.

_From 274-request-stages._

### 274-FR-003 — The read MUST return the request's stage, derived from its newest booking that is awaiting the garage, confirmed or completed, and that booking's job, before the request's own status: `done` (the job `done`), `in_work` (the job `in_work` or `paused`), `booked` (such a booking, its job not started or none), else `quoted` (request status `quoted`) or `sent`. The request's status only decides whether it is open (FR-001); when it and the job disagree, the job wins.

_From 274-request-stages._

### 274-FR-004 — The read MUST return the request's id, its car snapshot (brand, model, year), its job types (Romanian and English names, in order) and its description, so the panel titles it "<jobs> · <brand> <model>", falling back to the description's first line when it has no job type.

_From 274-request-stages._

### 274-FR-005 — The read MUST return the quoted range in bani: before a quote is accepted, the lowest `from_bani` and the highest `to_bani` across the request's open (`waiting`) quotes; once booked, the accepted quote's range; none while there is no such quote (a `quoted` request whose quotes all ended shows Ofertă with no range).

_From 274-request-stages._

### 274-FR-006 — Once booked, the read MUST return the booking's garage (name, slug), its status (`awaiting_confirmation`, `confirmed` or, once the job is done, `completed`), its start and its confirm-by time; before booking, no garage and no booking.

_From 274-request-stages._

### 274-FR-007 — The read MUST return the mechanic's name, the job's mechanic when the job has one, else the confirmed booking's, even when the mechanic hid themselves; none while the booking awaits the garage, when the garage's `team_mechanics` switch is off (on when unset) or when no mechanic is set.

_From 274-request-stages._

### 274-FR-008 — Once the job has started, the read MUST return the job's status, its start and its estimated finish: `eta_at` when set, else the job's `started_at` plus the booking's duration; either rounded up to the next 5-minute mark (an exact mark stays, any seconds past it round up). Before the job starts, no start and no finish; once the job is done, no estimate.

_From 274-request-stages._

### 274-FR-009 — The read MUST return the job's steps in position order, each with the garage's customer wording (else its label) and its state: `done` when ticked, `now` for the first unticked step while the job is `in_work`, else `todo`; and the final price in bani once recorded.

_From 274-request-stages._

### 274-FR-010 — The panel Cererea activă MUST show five stages on a line, Trimisă, Ofertă, Programată, În lucru, Gata: those before the current stage filled, the current one glowing and marked as the current step for assistive technology (`aria-current="step"`), the later ones grey; on Gata, Gata is filled, glowing and marked current.

_From 274-request-stages._

### 274-FR-011 — The panel MUST show the title (FR-004), and once booked the garage's name, followed by "mecanic <name>" when a mechanic is named (FR-007).

_From 274-request-stages._

### 274-FR-012 — The panel MUST show "Ofertă" with the range formatted in lei whenever there is one, and, when the job is done and a final price is recorded, that price next to the range.

_From 274-request-stages._

### 274-FR-013 — While the booking awaits the garage the panel MUST show "Așteaptă confirmarea service-ului · încă <time left>"; once confirmed and before the job starts, "Programată" with the booking's day and time; times in Europe/Bucharest with "azi", "mâine" or the weekday and date; the time left is recomputed every minute while the panel is open.

_From 274-request-stages._

### 274-FR-014 — Once the job has started the panel MUST show "Început" with the start and, until it is done, "Gata, estimat" with "<day>, în jur de <time>"; while paused, the line "În pauză"; when done, "Mașina e gata. Poți veni după ea." and no estimate. Before a quote is accepted, no start and no finish are shown.

_From 274-request-stages._

### 274-FR-015 — The panel MUST show "Pașii lucrării · <done> din <total> gata" and each step with "gata", "acum" or nothing, and hide the section when the job has no step or there is no job.

_From 274-request-stages._

### 274-FR-016 — When the driver has more than one open request, the overview's panel MUST show the link "Încă <n> cereri deschise" (n = open requests − 1) to Cererile mele.

_From 274-request-stages._

### 274-FR-017 — The panel MUST carry Cerere nouă, a link to Home in the driver's language, in every state but loading and error.

_From 274-request-stages._

### 274-FR-018 — The panel MUST be the first, wide panel of the overview when the driver has an open request (the overview keeps its invitations to add a car and find a garage when none is open), and MUST sit at the top of Cererile mele when the driver has any request, showing "Nicio cerere deschisă" with Cerere nouă when none is open.

_From 274-request-stages._

### 274-FR-019 — While the read is pending the panel MUST show a skeleton of itself marked busy for assistive technology (`aria-busy`); when it fails, "Nu am putut încărca cererea." with Reîncearcă, which reads it again.

_From 274-request-stages._

### 274-FR-020 — The panel MUST read again on the request events the overview already follows (`quote.accepted`, `booking.confirmed`, `booking.lapsed`) plus `quote.sent`, and, in Cererile mele, on the events its list follows; it adds no live channel of its own (live updates are ST-275).

_From 274-request-stages._

### 274-FR-021 — Every text MUST exist in Romanian and English, and the panel MUST fit 320 px wide with no sideways scroll, in light and dark.

_From 274-request-stages._

### 423-FR-002 — While the first read is in flight the section MUST show three skeleton rows marked busy; with no row and no next booking it MUST say "Nicio lucrare azi" / "No jobs today"; when the read fails it MUST show the shared problem line with a retry button; tapping a row MUST open the job as Lucrări opens it; the section MUST re-read on the job event kinds Lucrări listens to (`job.mechanic_changed` included), on `booking.confirmed`, `booking.moved` and `booking.cancelled`, and when the stream reconnects.

_From 423-mechanic-garage-dashboard._

## Retired

- `220-FR-007` — superseded by `389-FR-002` (2026-10-21)

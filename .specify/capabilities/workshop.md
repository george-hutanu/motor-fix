---
capability: workshop
updated: 2026-10-31
features:
  - 220-requests-quotes-bookings
  - 424-job-steps
  - 389-confirm-booking-lift-mechanic
  - 274-request-stages
  - 150-add-booking
  - 423-mechanic-garage-dashboard
  - 276-job-start-done
  - 275-live-stage-updates
  - 427-time-blocks
  - 406-final-price-handover
  - 1393-final-price-predare
  - 1395-block-time-dashboard
  - 1404-predare-quote-range
  - 1403-block-time-dialog
  - 154-free-slots
---

# Capability: Workshop

The work in the garage for a confirmed booking: the job, its stages and the time each began, its steps, and the final price recorded at handover.

## Requirements

### 276-FR-004 — Every JOB_STAGE_ENTRY MUST store `mechanic_id`, the job's mechanic at that moment (null when none), and `auto` (true for an automatic pause, else false): the entries this story writes and the first `to_do` entry the confirm writes (389-FR-002).

_From 276-job-start-done._

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

### 1393-FR-011 — (424-FR-015 modified) The list and the open panel MUST re-read on `job.step_done`, `job.step_undone`, `job.steps_changed`, the job's stage events, `job.mechanic_changed`, `job.handed_over` and `job.final_price_corrected` through the garage's live stream, a burst as one re-read, so a second person's change (a handover or a correction included) shows within seconds without a reload; the two kinds join the one exported job kinds list the drawer and Lucrări read (`JOB_KINDS`).

_From 1393-final-price-predare._

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

### 275-FR-001 — The panel Cererea activă on the overview and in Cererile mele MUST re-read the active request on every live message of these kinds, besides the request kinds it follows today (274-FR-020): `quote.sent`, `quote.changed`, `quote.withdrawn`, `quote.expired`, `quote.accepted`, `booking.confirmed`, `booking.lapsed`, `booking.cancelled`, `booking.no_show_recorded`, `job.started`, `job.paused`, `job.resumed`, `job.step_done`, `job.step_undone`, `job.steps_changed`, `job.eta_changed`, `job.done`, `job.handed_over`, `job.final_price_corrected`, and `job.mechanic_changed`, `job.reopened`, `job.received`, `request.expired`, `request.decline_undone`, `request.direct_answered`, `quote.closed`, `quote.declined_by_driver` and `booking.moved` (Assumptions, Clarifications). The kinds are one exported list beside the request kinds, a superset of them; the list is closed and pinned by a unit test. The messages carry only kind, id and time; the panel re-reads through the API, so access rules apply once, on the server. Modifies 274-FR-020: the panel follows every kind that moves what it shows.

_From 275-live-stage-updates._

### 274-FR-021 — Every text MUST exist in Romanian and English, and the panel MUST fit 320 px wide with no sideways scroll, in light and dark.

_From 274-request-stages._

### 427-FR-006 — (150-FR-002 and 150-FR-006 modified) `assertPlaceable` MUST read block segments beside booking segments and, when the first clash is a block row, throw the block messages of FR-005 with `reason` `time_block` (a booking row keeps the ST-150 messages), so the confirm, a move and the free slots refuse blocked time through the one check and nothing is added to the confirm; the taken-row shape gains the holder (`booking` with its car, or `time_block`).

_From 427-time-blocks._

### 150-FR-005 — A BOOKING_SEGMENT exclusion violation raised at the write (a confirm of another booking committed between the read and the write) MUST be answered 409 `slot_taken` with the message "Locul tocmai a fost ocupat" / "The slot was just taken", never 500 and never the shipped mapping to `lift_busy` / `mechanic_busy`; two confirms racing for one place MUST end with exactly one `confirmed`. The deadlock retry stays; when the retry reads the other's segments it answers the named 409 of FR-006.

_From 150-add-booking._

### 427-FR-005 — A block's segments MUST be its range cut at each Bucharest midnight it crosses (one row per day touched, clock-change days included), each carrying the block's `mechanic_id` (null with `team_mechanics` off) and `lift`; the create, and a change of mechanic, lift, start or end, MUST compute them, read the overlapping BOOKING_SEGMENT rows of the mechanic and of the garage's lift (excluding the block's own rows on a change) and refuse the first clash in time order through `judgeOverlaps` of 150-FR-002, the mechanic's before the lift's, with the booking messages of 150-FR-006 for a booking row ("{name} are o programare {span}", "Elevatorul {n} e ocupat {span} ({car})") and these for a block row: 409 `mechanic_busy` "{name} e blocat {span}" / "{name} is blocked {span}" and 409 `lift_busy` "Elevatorul {n} e blocat {span}" / "Lift {n} is blocked {span}", `reason` `time_block`, the span on the Bucharest wall clock, for a block row the block's whole range (not the day segment that clashed), each end with its weekday prefixed when on another day than the start asked for (150-FR-006), and the problem details naming `mechanicId` or `lift` as the field; a booking still `awaiting_confirmation` has no segments and stops no block. The mechanic's card MUST be read `FOR SHARE` in that transaction (a concurrent card removal updates the row and waits, so no future block is saved on a card removed in between, FR-012); The write MUST then be the block row, its segments, the audit entry and the event in one transaction; an exclusion violation at the write is 409 `slot_taken` (150-FR-005).

_From 427-time-blocks._

### 423-FR-002 — While the first read is in flight the section MUST show three skeleton rows marked busy; with no row and no next booking it MUST say "Nicio lucrare azi" / "No jobs today"; when the read fails it MUST show the shared problem line with a retry button; tapping a row MUST open the job as Lucrări opens it; the section MUST re-read on the job event kinds Lucrări listens to (`job.mechanic_changed` included), on `booking.confirmed`, `booking.moved` and `booking.cancelled`, and when the stream reconnects.

_From 423-mechanic-garage-dashboard._

### 276-FR-001 — The API MUST offer, under the existing `garage/jobs` routes and the `garage.own_jobs` capability, `POST /api/v1/garage/jobs/:id/start`, `.../pause`, `.../resume` and `.../finish` with no body, each answering the job as `GET garage/jobs/:id` does. The moves MUST be `to_do` → `in_work` (start), `in_work` → `paused` (pause), `paused` → `in_work` (resume), `in_work` or `paused` → `done` (finish); any other pair MUST answer 409 `invalid_transition` with the current stage, except finish on a `to_do` job, which answers 409 `job_not_started` with "Lucrarea nu a început", and start on a job with no `received_at`, which answers 409 `not_received` with "Fă recepția mai întâi". A `cancelled` job answers 409 `invalid_transition` to every stage call.

_From 276-job-start-done._

### 276-FR-002 — A stage call MUST be allowed to the owner of the job's garage and to the job's mechanic (the mechanic row of `JOB.mechanic_id` belonging to the caller's account), and MUST answer 403 `forbidden` to a receptionist of the garage and to another mechanic of the garage, and 404 to anyone outside the garage, judged against the locked job row before anything is written.

_From 276-job-start-done._

### 276-FR-003 — Every stage move MUST run in one transaction that locks the job row, writes the status and its times (`started_at` on the first start and kept on a resume, `paused_at` on a pause, `finished_at` on finish), the stage entry, the audit entry (`job.status`, a key change) and the event, as the existing job mover does; the start MUST also move the request `booked` → `in_work` and the finish `in_work` → `done` through the request mover in the same transaction, with the request's own audit entry and no event of its own (the request mover's event goes to a no-op port, as the accept's request move does): the job's event is the one the tracker and Lucrări re-read on. When any part fails nothing is written.

_From 276-job-start-done._

### 276-FR-005 — A start or a resume MUST, when the garage's `team_mechanics` switch is on (on when the garage has no row) and the job has a mechanic, pause in the same transaction every other `in_work` job of the same garage with the same `mechanic_id`, whoever pressed: each with a stage entry `auto` = true, an audit entry recorded as a platform move (actor role `system`, no account) and `job.paused` `{ from, to, auto: true }`; the triggering `job.started` or `job.resumed` MUST carry `pausedJobIds`, the ids it paused (empty when none). With the switch off nothing is paused, whatever the mechanic ids.

_From 276-job-start-done._

### 276-FR-006 — The job MUST store `worked_seconds` (whole seconds, 0 at creation): every move out of `in_work` (a pause by hand, an automatic pause, a finish) adds now − the time of the job's latest stage entry to `in_work`, floored to whole seconds; a finish from `paused` adds nothing. The job read MUST return it as `workedSeconds`.

_From 276-job-start-done._

### 276-FR-007 — The events MUST be `job.started` `{ from, to, pausedJobIds }`, `job.paused` `{ from, to, auto }`, `job.resumed` `{ from, to, pausedJobIds }` and `job.done` `{ from, to }`, each with the `job` audience (the driver's account, the garage, the job's mechanic), written in the stage's transaction. No notification is sent by this story: the driver's JOB_READY message is #164's, read from `job.done`.

_From 276-job-start-done._

### 276-FR-009 — The job read (`GET garage/jobs/:id` and the list's items) MUST return `receivedAt`, `odometerKm` and the car's current odometer (`car.odometerKm`), so the drawer can show the reception state and warn on a lower reading without a second read.

_From 276-job-start-done._

### 276-FR-015 — The data model MUST gain `JOB.received_at` (timestamp, null), `JOB.odometer_km` (whole number, null), `JOB.worked_seconds` (whole number, default 0), `JOB_STAGE_ENTRY.mechanic_id` (reference to MECHANIC, null, set null on removal) and `JOB_STAGE_ENTRY.auto` (boolean, default false), with a migration; DTOs come from the contracts library, validated at the edge, and the generated client is regenerated.

_From 276-job-start-done._

### 276-FR-016 — The five new routes MUST be listed in `infra/observability/inventory.json` with their metrics and alert (or why none), and in the PR's Observability section; the stage calls count under one metric with the action and outcome as labels.

_From 276-job-start-done._

### 276-FR-017 — Tests MUST cover, in Jest on real PostgreSQL and Redis, with a `// @traces` line per spec file: start, pause, resume and finish by the owner and by the job's mechanic; finish from `paused`; 409 `job_not_started` on a finish from `to_do`; 409 on every other refused pair and on a `cancelled` job; 403 for a receptionist's and another mechanic's stage call, 404 for another garage's; the request moving to `in_work` and `done` with the job; `started_at` kept on a resume; `worked_seconds` after a pause and a finish; the automatic pause of the same mechanic's job only, triggered by the owner too, carrying `pausedJobIds`, and none with `team_mechanics` off or with no mechanic; `mechanic_id` and `auto` on every stage entry, the confirm's first one included; reception by the owner, a receptionist and the job's mechanic with the reading row, the car's odometer, the audit entries and `job.received`; a correction; the reading's bounds; reception refused on a `done` job; 403 and 404 for reception; the stage entries, audit rows and events in one transaction and nothing written on a failure. Web unit tests cover the buttons per role and stage, the reception-first start with save and a failed start after a saved reception, the warning, the sending state and the retry after a failure. End to end (Playwright): the owner records a reception and starts a job, then marks it done; in a second browser the driver's tracker shows În lucru, then Gata, without a reload.

_From 276-job-start-done._

### 275-FR-002 — The re-read MUST follow the in-place rules the helper already keeps: messages within 300 ms cause one re-read, one read runs at a time, the result is merged by structural sharing, a failed re-read keeps the last value and shows no error, and no update reloads the page, changes the route, closes an overlay, moves focus or loses text typed elsewhere on the page (256-FR-001 to 256-FR-005).

_From 275-live-stage-updates._

### 275-FR-003 — After the re-read the panel MUST show what 274-FR-010 to 274-FR-015 define for the new state, with nothing to press: the stage line, Început, În pauză, Gata estimat, the booking's date and time in place of the countdown, Ofertă with its range, the final price, and Pașii lucrării with its count and each step's state.

_From 275-live-stage-updates._

### 275-FR-005 — The panel MUST show a small line "Reconectare…" / "Reconnecting…", a polite status for assistive technology, while the connection's `offline` signal is true, that is once the live connection has not been `open` for more than 10 seconds while it is wanted (the same signal as the frame's offline bar, 255-FR-006, so the two never disagree, also while polling), and MUST hide it as soon as the connection is `open` again; the reopen's re-read (255-FR-004) then brings the request up to date. The line is not designed (Assumptions): plain text under the stage line, no icon, no button. It belongs to the panel's loaded view (the stage line it sits under); while the panel shows its loading, empty or error state the frame's offline bar alone speaks.

_From 275-live-stage-updates._

### 275-FR-006 — Both tabs of a driver's dashboard MUST show the change (1190-FR-007: the shared stream fans the event to every tab of the account and role; the panel in each tab re-reads).

_From 275-live-stage-updates._

### 275-FR-007 — The waiting-for-the-garage countdown MUST keep ticking in the browser every minute (as today) and MUST be re-read on any booking message of FR-001.

_From 275-live-stage-updates._

### 275-FR-008 — The story MUST write nothing: no row, no audit entry, no event; the only read is the active request API (274-FR-001). It adds no server channel, route or event kind.

_From 275-live-stage-updates._

### 275-FR-009 — Tests MUST cover: in Jest (already held by `libs/domain/src/events/audience.spec.ts` and `live.hub.audience.spec.ts`, cited, not duplicated), the audience of a job, booking and quote subject (the driver's account, the garage and the job's mechanic are in it; another driver's account, another garage and a mechanic of another garage are not; a job with no mechanic yields exactly the driver's account and the garage), and that a driver's stream is given no channel but its own account's and `system`; in web unit tests, the full list of kinds that re-read the panel (FR-001), the 300 ms coalescing, the countdown's re-read on a booking kind, and the reconnecting line's show and hide on the connection's `offline` signal; in Playwright, two browser contexts where the garage starts the job, ticks a step and marks it done and the driver's tracker follows each change without a navigation, on the overview and in Cererile mele, then once more after the driver's network is cut and restored; and a second driver tab following a tick. Each spec file carries a `// @traces` line naming this feature's ids.

_From 275-live-stage-updates._

### 275-FR-010 — Every new text MUST exist in Romanian and English, and the panel with the reconnecting line MUST fit 320 px wide with no sideways scroll, in light and dark.

_From 275-live-stage-updates._

### 406-FR-001 — The API MUST offer, under the existing `garage/jobs` routes and the `garage.own_jobs` capability, `POST /api/v1/garage/jobs/:id/handover` with `{ finalPriceBani }`, answering 200 with the job as `GET garage/jobs/:id` does. It MUST be allowed to the owner of the job's garage (role `garage`) and to a receptionist of that garage, answer 403 `forbidden` to every mechanic of the garage (the job's own included; `MECHANIC.can_record_final_price` is not read until EP-9's ST-399) and 404 to anyone outside the garage, judged against the locked job row before anything is written. The checks run in this order on both routes: the caller (404 outside the garage, then 403 for a mechanic), then the job's stage, then the handover state and the window, then the booking (FR-004), then the same-price no-op (FR-005).

_From 406-final-price-handover._

### 406-FR-002 — A handover MUST be accepted only while the job is `done` and not yet handed over: any other stage (`to_do`, `in_work`, `paused`, `cancelled`) answers 409 `job_not_done` with "Marchează întâi lucrarea ca gata" / "Mark the job as done first"; a job with `handed_over_at` set answers 409 `already_handed_over` with the recorded `finalPriceBani` in the body. Nothing is written on a refusal.

_From 406-final-price-handover._

### 406-FR-003 — `finalPriceBani` MUST be a whole number of bani from 1 to 100,000,000 (1.000.000 lei, the limit `PAID_BANI_MAX` the reviews already share), validated at the edge by the DTO in the contracts library; anything else, a missing field or an unknown key answers 400 `validation_failed` with the field named. VAT is included, as in the quote.

_From 406-final-price-handover._

### 406-FR-004 — A handover MUST run in one transaction that locks the job row, writes `final_price_bani`, `final_price_recorded_by` (the caller's account) and `handed_over_at` = now, moves the booking `confirmed` → `completed` through the existing booking mover (its `completed_at`, audit entry and event `booking.completed`, a new kind of the events list, as 220-FR-008 writes them; a booking already `completed` is left as it is; a booking in any other state answers the mover's own 409 `invalid_transition` and nothing is written), writes the audit entries `job.final_price_bani` (null → the price, a key change) and `job.handed_over_at` with the actor and their role, filed under the job and the garage, and records the event `job.handed_over` `{ finalPriceBani, by }` with the `job` audience (the driver's account, the garage, the job's mechanic). The request's status stays `done`; it leaves the driver's open requests by `handed_over_at` (274-FR-001). No notification is sent for the first recording.

_From 406-final-price-handover._

### 406-FR-005 — The API MUST offer `PATCH /api/v1/garage/jobs/:id/final-price` with `{ finalPriceBani }` (FR-003's rule), allowed and refused as FR-001, answering the job. It MUST be accepted only on a handed-over job (else 409 `not_handed_over`) and before `handed_over_at` + `FINAL_PRICE_CORRECTION_HOURS` (48, a constant of the contracts library) has passed (at or after it, 409 `correction_window_closed` with "Prețul final nu mai poate fi corectat" / "The final price can no longer be corrected"). A correction equal to the recorded price MUST change nothing and answer success, judged after every refusal (a same-price call after the window or before the handover is refused as above). Corrections are unlimited within the window; each one overwrites `final_price_corrected_at` and writes its own audit entry, event and message.

_From 406-final-price-handover._

### 406-FR-006 — A correction MUST run in one transaction that locks the job row, writes `final_price_bani` and `final_price_corrected_at` = now, writes the audit entry `job.final_price_bani` (old → new, a key change, the actor and their role), and records `job.final_price_corrected` `{ oldBani, newBani, by }` with the `job` audience.

_From 406-final-price-handover._

### 406-FR-007 — After a correction has committed, the driver (the job's `driver_id`) MUST be sent FINAL_PRICE_CORRECTED through the notifications service, keyed by the event so a retry sends it once, with the garage's name and the new price formatted by the shared `formatLei` (`libs/i18n/src/formats.ts`: whole lei without decimals, otherwise 2 decimals, so 125050 bani reads "1.250,50 lei" / "1,250.50 lei"): "Garaj Nordic a corectat prețul final: 1.150 lei." / "Garaj Nordic corrected the final price: 1,150 lei", in e-mail, push and WhatsApp by the driver's choice, group `bookings`, mutable, never held by quiet hours; its bell link opens the driver's requests (already in the catalogue). A failed send is logged and does not undo the correction.

_From 406-final-price-handover._

### 406-FR-009 — The data model MUST gain `JOB.final_price_recorded_by` (reference to ACCOUNT, null, set null on removal) and `JOB.final_price_corrected_at` (timestamp, null), with a migration and no backfill; the two request DTOs, the OpenAPI document and the generated client are updated, and the data export of a driver's jobs carries `finalPriceCorrectedAt` when it carries the job; `final_price_recorded_by` stays out of every read and export (the audit history names who).

_From 406-final-price-handover._

### 406-FR-010 — The two routes MUST be listed in `infra/observability/inventory.json` with their metrics and alert (or why none), and in the PR's Observability section; the calls count under the existing job stage counter with the action (`handover`, `correct`) and the outcome as labels, and each refusal logs one warning line with the code and the job.

_From 406-final-price-handover._

### 406-FR-011 — Tests MUST cover, in Jest on real PostgreSQL and Redis, with a `// @traces` line per spec file: a handover by the owner and by a receptionist; 403 for the job's mechanic (with `can_record_final_price` true and false) and for another mechanic, 404 for another garage; 409 from every stage but `done` and on a second handover; 400 for 0, a negative value, a fraction and above the limit; the job, the booking, the audit entries and the event written in one transaction and nothing written on a refusal; a correction within 48 hours with its audit entry, its event and the driver's queued message; a correction refused at 48 hours and before the handover; the same-price no-op and its refusal after the window; a `done` job whose booking is neither `confirmed` nor `completed` refused with 409 `invalid_transition`; the message's amount for 115000 and 125050 bani; the list and details fields of FR-008; the DTO's limits in a contracts unit test; two simultaneous handovers both judged.

_From 406-final-price-handover._

### 427-FR-001 — A new table TIME_BLOCK (`time_block`) MUST hold `id`, `garage_id` (cascade), `mechanic_id` (nullable; set null when the card row is deleted, the soft-removed card keeps its past blocks), `lift` (nullable integer), `starts_at` and `ends_at` (timestamptz, half-open, `ends_at` > `starts_at` checked), `note` (nullable text, at most 200 characters checked), `created_by` and `updated_by` (account ids), `created_at`, `updated_at`, with a check that at least one of `mechanic_id` and `lift` is set and an index on (`garage_id`, `starts_at`); one Prisma migration in the `workshop` schema adds it.

_From 427-time-blocks._

### 427-FR-003 — The API MUST offer, under the `workshop` module, `GET /api/v1/garages/:garageId/time-blocks?from&to` (Bucharest dates, `to` defaulting to `from`, 1 to 31 days, else 400 `validation_failed`; the blocks whose segments touch the range), `POST /api/v1/garages/:garageId/time-blocks` (201), `PATCH /api/v1/garages/:garageId/time-blocks/:blockId` (200) and `DELETE /api/v1/garages/:garageId/time-blocks/:blockId` (204), with the body `{ mechanicId?: uuid | null, lift?: integer | null, startsAt, endsAt, note?: string | null }` (PATCH: any subset; unknown fields 400 `validation_failed` naming the field); open to the owner and a receptionist of that garage, checked on the server before anything else: a mechanic of the garage gets 403 `forbidden` whatever her permissions, any other actor and an unknown garage 404 `not_found`, a visitor 401 `sign_in_required`; a `blockId` of another garage or unknown 404 `not_found`. The DTOs come from the contracts library.

_From 427-time-blocks._

### 427-FR-004 — A create or change MUST be refused, in this order and before any write: 422 `nothing_to_block` when the result would hold neither a mechanic nor a lift, or when both `team_mechanics` and `lift_schedule` are off (OD-33); 404 `feature_off` for a `mechanicId` while `team_mechanics` is off or a `lift` while `lift_schedule` is off; 422 `validation_failed` naming the field for a `mechanicId` that is not a current card of this garage (`removed_at` null; the owner's row allowed), a `lift` outside 1..`lift_count`, a `startsAt` or `endsAt` off the 15-minute Bucharest grid, an `endsAt` not after `startsAt`, a range under 15 minutes or over 14 days, an `endsAt` not after now, a `note` over 200 characters (trimmed; empty saved as null; plain text, no markup stripped or interpreted).

_From 427-time-blocks._

### 427-FR-007 — A change (PATCH) MUST apply the given fields over the stored block, run FR-004 and FR-005 on the result, rewrite the segments only when mechanic, lift, start or end changed, and set `updated_by` and `updated_at`; a change or a removal of a block whose `ends_at` is not after now MUST be refused 409 `block_past` "Un interval blocat trecut nu se mai poate modifica" / "A past blocked interval can no longer be changed"; a change with no changed field answers 200 and writes nothing.

_From 427-time-blocks._

### 427-FR-008 — A removal (DELETE) MUST delete the block and its segments in one transaction with its audit entry and event; the time is free at once.

_From 427-time-blocks._

### 427-FR-017 — Tests MUST exist before the code (Principle II), each file with a whole-line `// @traces` comment naming this feature's FR ids. In Jest on real PostgreSQL and Redis: US1-1 to US1-8 (the row, the segments per day and on the clock-change days, the block and the booking refusals with their messages and `reason`, the race with exactly one block and a 409 `slot_taken`, the awaiting booking), US2-1 to US2-6 (the change, the clash on a change, the note-only change, the removal, `block_past`, the lost update), US3-1 to US3-6 (every role on every route, the schedule read per role with `blocks` and the note, the public routes list, the driver's history), US4-1 and US4-3 to US4-5 (the removal with its entries and events, each switch state, `nothing_to_block`), every FR-004 refusal at its bound, and the confirm onto blocked time through `assertPlaceable` (FR-006). In unit Jest: the day cut (`segmentsOf`), `judgeOverlaps` with block rows, the message wording in both languages. The OpenAPI document matches the running API (the existing openapi test) and the structure check passes.

_From 427-time-blocks._

### 1393-FR-001 — The job's drawer (424-FR-013) MUST show a button "Predare" / "Handover" when the job is `done`, `handedOverAt` is null and the session's role (`session.current()?.role`, as the drawer reads it today) is `garage` (the owner) or `receptionist`; on any other stage, once handed over, or for a `mechanic`, the button MUST NOT exist in the drawer's markup. The button sits under the stage line and above the steps, a Cockpit secondary button at least 44 px tall.

_From 1393-final-price-predare._

### 1393-FR-002 — Predare MUST open the shared overlay task in its `dialog` shape (centred from 768 px, the sheet below it, 158-FR-010) titled "Predare" / "Handover", with one text field labelled "Preț final (lei)" / "Final price (lei)" (`inputmode="decimal"`, the label tied to the field), a primary "Salvează" / "Save" and a secondary "Renunță" / "Cancel" that closes with `cancelled`. The dialog opens on top of the drawer and hands its result back to it; Escape, X, outside and Back close it as every task (491-FR-002).

_From 1393-final-price-predare._

### 1393-FR-003 — The amount MUST be read by `parseLeiText` (Romanian format: thousands with a dot, decimals with a comma, up to 2 decimals, an optional "lei"), so "1.250,50" sends 125050 bani and "890" sends 89000; when the parser answers `format`, `decimals`, `min` (0 or negative) or `max` (above 1.000.000 lei), Salvează MUST send nothing, mark the field invalid (`aria-invalid`, the message tied by `aria-describedby`) and show the message for that answer, worded as the review form's four paid-amount messages, held in the garage bundle as `garage.jobs.finalPrice.field.*` (bundles load per area, so a garage session cannot read the driver's; the shell's Romanian is in the initial bundle, which has no room for them) beside the driver's own `driver.review.field.*`; the message clears as the text changes. An empty field reads as `format`.

_From 1393-final-price-predare._

### 1393-FR-005 — Salvează from Predare MUST call the handover (406-FR-001) with the parsed bani, through the shared form-saving helper: while the call runs the field and both buttons are disabled and the dialog stays open; on success the dialog closes with the job it answered, the drawer shows the job as the answer gives it (FR-006's price line, the button for the window) without waiting for the live re-read, and Lucrări's row keeps its stage "Gata". No toast is shown on success, for a handover or a correction: the drawer's line is the feedback; the first recording sends the driver no message (406, Assumptions). Dismissing the dialog while the call runs follows the shared form-saving helper as it is; the call completes and FR-011's re-read lands it.

_From 1393-final-price-predare._

### 1393-FR-006 — Once `handedOverAt` is set, the drawer MUST show the line "Preț final <price>" / "Final price <price>" (`formatLei`, so 125050 reads "1.250,50 lei" / "1,250.50 lei") to every role, in place of Predare, and, while now is before `handedOverAt` + `FINAL_PRICE_CORRECTION_HOURS` hours (the contracts constant, 48, never a literal in the web) and the role is `garage` or `receptionist`, a secondary button "Corectează" / "Correct" beside it; at or after that instant, and for a mechanic, the line alone. Corectează MUST open FR-002's dialog titled "Corectează prețul final" / "Correct the final price", the field pre-filled with the recorded price in Romanian text (`formatLei(bani, 'ro')` without " lei"; the field takes the Romanian format in both languages, as the review form does), and its Salvează MUST call the correction (406-FR-005) with the parsed bani, FR-003 to FR-005 applying as written (a same-price save is sent and closes on the API's success). The window is judged from the job read and the browser clock when the drawer's job or the session changes; a re-read of the drawer (FR-011) re-judges it.

_From 1393-final-price-predare._

### 1393-FR-007 — A refused or failed save MUST keep the dialog open, keep the typed text and the buttons, and show the shared `.problem.mf-message[role=alert]` under the field in the person's language: 409 `job_not_done` and `correction_window_closed` with the garage's existing texts (moved from `garage.jobs.problem` to the dialog's own `garage.jobs.finalPrice.problem`, which the shared form helper reads first); 409 `already_handed_over` "Prețul final a fost deja înregistrat" / "The final price is already recorded"; 409 `not_handed_over` "Lucrarea nu a fost încă predată" / "The job has not been handed over yet"; 403 `forbidden` "Doar proprietarul și recepția înregistrează prețul final" / "Only the owner and the front desk record the final price" (the steps' `forbidden` text names the mechanic, wrong here); 400 `validation_failed` and every other failure with the shared form problem texts (`shell.form.problem.*`). After a 409 of the four, the drawer behind MUST re-read the job so its button and line match what the API holds (US1-6, US1-7, US2-6).

_From 1393-final-price-predare._

### 1393-FR-008 — A mechanic (role `mechanic`) MUST see no Predare, no Corectează and no price field, whatever the job's state; the mechanic sees FR-006's price line once a price is recorded, as the job read gives it. No role check is made in the browser beyond hiding the controls: the API refuses a mechanic's call (406-FR-001) and FR-007 shows it.

_From 1393-final-price-predare._

### 1393-FR-009 — The driver's active request panel MUST keep its existing line (274-FR-012: "Ofertă <range>" and, on stage Gata with a recorded price, "Preț final <price>") unchanged, and MUST drop the handed-over request within 5 seconds of the handover through its existing re-read on `job.handed_over` (275-FR-001): the handover ends the request's open state (274-FR-001), so the next open request shows, or the invitations when none is open (030-FR-002), with "Încă n cereri deschise" (274-FR-016) recounted. The story's "panel shows the final price once handed over" is therefore met by the row of FR-010, not by the panel (Assumptions).

_From 1393-final-price-predare._

### 1393-FR-013 — Every new text MUST exist in Romanian and English in the i18n library (hyphenated Romanian words with U+2011): "Predare" / "Handover", "Corectează prețul final" / "Correct the final price", "Preț final (lei)" / "Final price (lei)", "Salvează" / "Save", "Renunță" / "Cancel", "Corectează" / "Correct", "Preț final" / "Final price" as the drawer's line, "Încheiată pe" / "Closed on", the three new refusals of FR-007; the existing `job_not_done` and `correction_window_closed` texts are reused and the review form's amount messages are worded the same in the garage bundle (FR-003), a test keeping the two copies equal. The empty-keys and as-written i18n checks pass.

_From 1393-final-price-predare._

### 1393-FR-014 — The drawer with its button and line, the dialog in every state (empty, invalid, saving, refused) and the Cererile mele row MUST show without sideways scrolling at 320 px and 390 px, on a tablet and a desktop, light and dark, Romanian and English, in the QA sweep; every control is at least 44 px tall and reachable and operable by keyboard (Tab order: field, Renunță, Salvează, the app's button order for every task dialog; Enter in the field saves); the problem message is announced (`role="alert"`), the field's label and messages are tied to it, and the axe checks pass.

_From 1393-final-price-predare._

### 1393-FR-015 — One Playwright end to end (`apps/web-e2e`) MUST drive the P1 path: a `done` job of the seeded garage (the `pastJob` helper or an equivalent written through the API and the database, ), the seeded receptionist opens Lucrări, the job's drawer, Predare, types "1.250,50", saves and sees "Preț final 1.250,50 lei" with Corectează; the job's driver signs in and sees in Cererile mele the row "Încheiată pe <today>" with "1.250,50 lei" as the amount paid, waiting on visible text, never `networkidle`. The flow is proven with `precheck.mjs --check` before dispatch and skips without `DATABASE_URL` as the helper does.

_From 1393-final-price-predare._

### 1393-FR-017 — Tests MUST exist before the code (Principle II), with a `// @traces` line per spec file: colocated Jest specs for the drawer's rules (button by role, stage and `handedOverAt`; Corectează by the window at 47 h 59 min and at 48 h; the line for every role), the dialog (parsing "1.250,50" to 125050 and each parser answer to its message, nothing sent on an invalid text, the handover and the correction routes, the pre-fill, the problem text per code and the kept value, the re-read after a 409; "Peste ofertă" above `toBani` and not at it is title 2's), the row builder ("Încheiată pe 3 oct." and the amount from `handedOverAt` and `finalPriceBani`, today's row when null, English), the two kinds in `JOB_KINDS` and the driver list's kinds, the i18n texts in both files; plus FR-015's flow. FR-016's integration test is title 2's.

_From 1393-final-price-predare._

### 1395-FR-001 — The API MUST offer `GET /api/v1/garages/:garageId/time-blocks/options` (operationId `timeBlockOptions`, in `TimeBlocksController` under the `workshop` module, `libs/domain/src/workshop/time-blocks/`, declared before the `:blockId` routes so the path segment `options` is never read as a block id), answering 200 with `TimeBlockOptionsDto { liftCount: number, mechanics: BookingMechanicDto[] }`, the DTO in the contracts library (`libs/contracts/src/time-blocks.dto.ts`) and `BookingMechanicDto` reused from `quotes.dto.ts` (id and name only).

_From 1395-block-time-dashboard._

### 1395-FR-002 — The read MUST hold the access of the four routes (427-FR-003), checked on the server before anything else: the owner and a receptionist of that garage 200; a mechanic of the garage 403 `forbidden` whatever her permissions; any other actor and an unknown garage 404 (Nest's bare `Not Found` body, no `code`, as the four routes answer); a visitor 401 `sign_in_required`; the route is not `@Public()`.

_From 1395-block-time-dashboard._

### 1395-FR-003 — `liftCount` MUST be the garage's `lift_count` while `lift_schedule` is on and 0 while it is off; `mechanics` MUST be the garage's current mechanic cards (`removed_at` null, the owner's own card included) as `{ id, name }`, ordered by name then id in the database's default collation (the confirm query's `orderBy`), while `team_mechanics` is on, and `[]` while it is off — the same switch reads and card query as the confirm options (`ConfirmService.options`, `switches`, `offered`), shared as one exported function both services call (Principle V: one rule in one place), so the two answers cannot disagree on the same garage.

_From 1395-block-time-dashboard._

### 1395-FR-004 — With both switches off the read MUST answer 200 `{ liftCount: 0, mechanics: [] }`: no 4xx, no `nothing_to_block`, no refusal log line for that 200 (OD-33: the web shows no action then; the refusal belongs to the write, 427-FR-004).

_From 1395-block-time-dashboard._

### 1395-FR-005 — The read MUST write nothing: no audit entry, no event, no row; two reads with no change in between answer the same body.

_From 1395-block-time-dashboard._

### 1395-FR-008 — Tests MUST exist before the code (Principle II), each file with a whole-line `// @traces` comment naming this feature's FR ids: in Jest on real PostgreSQL, US1-1 to US1-7 (the body per switch state, the order, the removed card, the owner's own card, the empty team) and US2-1 to US2-6 (every role, the unknown garage, the visitor and the public routes list, the idempotent read, the non-uuid id); the DTO's OpenAPI shape in the contracts unit specs where the sibling DTOs have one. No web file changes in this story (the `apps/web` diff is empty; the regenerated `libs/data-access` is not counted).

_From 1395-block-time-dashboard._

### 1404-FR-001 — The garage's job read (`GET /api/v1/garage/jobs/:id`, `JobDto`) MUST also return `quoteFromBani` and `quoteToBani`, whole bani, both required (non-nullable) integers: the lower and upper bound of the booking's quote, the accepted one (220-FR-009), for every role the read already serves (owner, receptionist, the job's mechanic), with the read's role and garage rules unchanged.

_From 1404-predare-quote-range._

### 1404-FR-002 — The two fields MUST come from the booking's quote in the one query the read already makes (the booking include that builds the summary), never a second read or a second route; the values are the quote's `from_bani` and `to_bani` (`Int` columns, passed through as they are). "One query" is one Prisma call (`job.findFirst` with a nested `booking.quote` select, which Prisma may serve with its own SELECT), not one SQL statement; the read gets the quote through its own include, never through the shared summary include.

_From 1404-predare-quote-range._

### 1404-FR-003 — The list's items (`GET /api/v1/garage/jobs`, `JobSummaryDto`) MUST be unchanged: neither field, and the list's include (the shared summary include) byte-identical; only the single read's include gains the quote. The test proves the items' shape (scenario 4).

_From 1404-predare-quote-range._

### 1404-FR-004 — No column and no migration: the range is read from the existing `quote_job` row through `BOOKING.quote_id`.

_From 1404-predare-quote-range._

### 1404-FR-005 — `JobDto` in the contracts library MUST declare the two fields (required, integer), the OpenAPI document (`apps/api/openapi.json`) MUST be regenerated from it and the generated client (`libs/data-access`) regenerated from the document, never edited by hand (Principle V).

_From 1404-predare-quote-range._

### 1404-FR-006 — Tests MUST exist before the code (Principle II), with a `// @traces` line per spec file: one Jest test on real PostgreSQL in the workshop module's garage-jobs folder (`*.integration.spec.ts`) proving the two fields on a job with a quote (scenarios 1 and 3), their absence from the list's items (scenario 4) and the unchanged refusals (scenario 2). No contracts unit test: `JobDto` is a response type with no validation to test (`libs/contracts/src/jobs.dto.spec.ts` covers only the validated input DTOs). Scenario 5 is proven by CI's `scripts/contract-check.sh` (regenerate and diff `apps/api/openapi.json` and `libs/data-access`), SC-004.

_From 1404-predare-quote-range._

### 1403-FR-001 — The garage dashboard (`garage-home`, the strip) MUST offer "Blochează timp" / "Block time" to a person whose role at the shown garage is `owner` or `receptionist`, while at least one of `team_mechanics` and `lift_schedule` is on (a missing key is on); a mechanic, and any garage with both switches off, sees no button (OD-33). The button is a `hlmBtn` beside "Personalizează panoul" and carries `data-block-time`.

_From 1403-block-time-dialog._

### 1403-FR-002 — Pressing it MUST open, through `Overlays.open` with the shape `dialog` (a bottom sheet on a phone by the overlays' own rule), a task titled "Blochează timp" / "Block time" whose code is loaded on demand (a dynamic `import()` in the opener, as `open-add-car.ts` and `open-contact.ts` do), never in the dashboard's or the app's initial bundle.

_From 1403-block-time-dialog._

### 1403-FR-003 — On opening, the dialog MUST read `GET garages/:garageId/time-blocks/options` once and draw: Mecanic (a select of the cards, "none" first) while `team_mechanics` is on, Elevator (a select of Elevator 1..`liftCount`, "none" first) while `lift_schedule` is on and `liftCount` is above 0, De la and Până la (a date and a time each, the time on 15-minute marks, defaulting to the next quarter hour and one hour later), Notă (a textarea, at most 200 characters, the count left shown); a team on with no card shows the team line of US2-4; a failed read shows the shared error text with Retry and keeps the fields disabled.

_From 1403-block-time-dialog._

### 1403-FR-004 — Before sending, the dialog MUST refuse, in the person's language under the field concerned: no mechanic and no lift (worded per the selectors drawn, under the first one); an end not after the start; a time off the quarter hour; a range over 14 days (one under 15 minutes cannot be typed on the quarter-hour grid: an end after the start is at least 15 minutes after it); an end not after now; a note over 200 characters (the textarea's `maxlength`, and a value filled past it refused under Notă); the texts in both languages from the i18n `garage` messages under one key family (`garage.timeBlocks.*`).

_From 1403-block-time-dialog._

### 1403-FR-005 — Saving a new block MUST call `createTimeBlock` once with `mechanicId` (only when picked), `lift` (only when picked), `startsAt` and `endsAt` as instants with the offset Europe/Bucharest has on that date (`Intl`, never the browser's zone), and `note` trimmed (left out when empty); the button is busy while in flight and a second press sends nothing; on 201 the task closes with the result `blocked` and the toast "Interval blocat" / "Time blocked".

_From 1403-block-time-dialog._

### 1403-FR-006 — A refusal MUST keep the dialog open with every choice: a refusal whose body's `errors[0].field` is `mechanicId` or `lift` shows its text under that field and focuses it: the server's `message` for 409 `mechanic_busy` and `lift_busy` (bilingual), the dialog's own `garage.timeBlocks.problem.*` text for a 422 `validation_failed` (the server's is English-only); a `validation_failed` on `endsAt` shows under Până la; 404 `feature_off` shows the dialog's own text above the fields; 409 `slot_taken` shows its message above the fields and re-reads the options; `nothing_to_block`, `feature_off` and a `validation_failed` on `mechanicId` or `lift` re-read the options too; any other refusal shows the server's `message` above the fields, or the shared text for its code (`shell.form.problem.<code>`), else the shared error text.

_From 1403-block-time-dialog._

### 1403-FR-007 — Offline or a failed save (no answer, a 5xx) MUST show an error toast in the person's language (the shared offline or error text) and leave the dialog open with the choices; nothing is queued or retried by itself.

_From 1403-block-time-dialog._

### 1403-FR-008 — The dialog MUST open for a given block too (the opener passes the block: id, mechanic, lift, start, end, note): the title "Modifică intervalul blocat" / "Change the blocked time", the fields prefilled, "Salvează" / "Save" calling `updateTimeBlock` with only the changed fields, a mechanic or lift un-picked sent as `null` (nothing changed: close, no call), and "Elimină" / "Remove" asking the shared confirm question then calling `deleteTimeBlock`; on success the task closes with `changed` or `removed` and the matching toast; a 409 `block_past` or a 404 shows its message and closes with `refused` on Renunță. No screen of this story calls this mode (D2).

_From 1403-block-time-dialog._

### 1403-FR-011 — Tests MUST exist before the code (Principle II), each file with a whole-line `// @traces` comment naming this feature's FR ids: Jest for `garage-home` (the button per role and switch state, US1-1, US2-3) and for the dialog (the fields per switch state and per options answer, US1-2, US2-1, US2-2, US2-4, US2-5; the client-side refusals, US1-4; the body sent, US1-3; each server refusal and where its message shows, US1-5 to US1-7; offline and a failed save, US1-8; the edit and remove mode, US3-1 to US3-4); Playwright, `@seeded`, as the seeded receptionist of the garage with lifts and mechanic cards (`receptie-militari@example.test`, `service-auto-militari`; `atelier-test` has no lift): press the button, block the first listed mechanic and the last lift the seed offers 30 days ahead (the quote and booking specs take tomorrow at that garage) 10:00–11:30, see the toast, read the block back through the API and delete it through the API as clean-up. The driver half of the brief's flow (the garage's profile no longer offers 10:00; the slot returns after the removal) waits for #21 (D4), and the removal through the dialog for the first story that draws a block (D2).

_From 1403-block-time-dialog._

### 154-FR-001 — The API MUST offer, under the `workshop` module, `GET /api/v1/garages/:garageId/free-slots` taking `duration` (minutes), `jobTypeIds` (optional, repeatable), `needsLift` (optional), `earliest` (optional ISO instant), `horizonDays` (optional), `count` (optional), `mechanicId` (optional) and `excludeBookingId` (optional) through a query DTO in the contracts library validated at the edge (400 `validation_failed`), and answer `{ slots: [{ startsAt, endsAt }], reason? }` with the first `count` free starts in ascending time order, each as an ISO string with the Europe/Bucharest offset, `endsAt` being the end of the job (the end of its last chained stretch for a multi-day job); `reason` is `none_in_horizon` when and only when `slots` is empty. The read writes nothing: no row, no audit entry, no event of its own.

_From 154-free-slots._

### 154-FR-002 — Access MUST be checked on the server before anything else: the garage's owner and receptionist and a mechanic of the garage with `can_answer_quotes` or `can_move_bookings` get the answer; a mechanic of the garage with neither gets 403; a driver gets the answer only when she owns a booking at that garage that may still be moved (`awaiting_confirmation` or `confirmed`, starting after now) or holds a quote from that garage that can still be accepted (status `waiting` and not expired); everyone else, a driver with neither included, gets 404.

_From 154-free-slots._

### 154-FR-003 — Parameters MUST default and be bounded as follows, each breach answered 400 `validation_failed` before any schedule read: `duration` 15 to 2,400 minutes (5 working days of 8 h); `count` 1 to 10, default 3; `horizonDays` 1 to 30, default 30; `earliest` default now + 60 minutes, an instant before now clamped to now (never a 400; only an unparsable instant is), rounded up to the next 30-minute step on the Bucharest wall clock when it is not on one; `mechanicId` a card of that garage not removed, only while `team_mechanics` is on; `excludeBookingId` a booking of that garage (and the caller's own, for a driver). The driver's move story passes now + 2 h and 14 days; the engine imposes no other values.

_From 154-free-slots._

### 154-FR-004 — A start MUST be free when, for the whole duration: with `team_mechanics` on, at least one counted mechanic is at work (FR-005) and holds no segment overlapping it; with a lift needed and lifts in use (`lift_schedule` on and `lift_count` ≥ 1), at least one lift numbered 1 to `lift_count` holds no segment overlapping it; and after each booking of the garage in `awaiting_confirmation` whose `[starts_at, starts_at + duration_minutes)` overlaps it takes one mechanic unit (and one lift unit when any of its request's jobs has `needs_lift`), at least one mechanic and, when needed, one lift are still left. Segments are the BOOKING_SEGMENT rows of confirmed bookings and of time blocks alike (427-FR-005): a blocked mechanic or lift is never free in its blocked range.

_From 154-free-slots._

### 154-FR-005 — A mechanic MUST count at a start only when she is at work for the whole stretch the job occupies that day: inside her effective hours for that weekday (her own `working_hours`, else the garage's weekdays, 058-FR-001), not on a day off, not on a garage closed day and not on a legal holiday (PUBLIC_HOLIDAY); on Saturday only with `works_saturdays` on, within her Saturday hours. A removed card never counts. A garage with no opening hours stored and a mechanic with none of her own yields no counted mechanic: no start is offered round the clock (`none_in_horizon`), unlike the confirm's placement, which accepts any time there.

_From 154-free-slots._

### 154-FR-006 — A job no longer than the mechanic's working stretch on the start day MUST fit inside that single stretch (scenario 4). Only a job longer than that stretch starts on one day and continues in the same mechanic's next working stretches on the same lift, as the confirm's placement already chains it (150, 389); the start is free only when every stretch of the chain is free of segments and awaiting capacity and the chain ends within the horizon.

_From 154-free-slots._

### 154-FR-007 — Given `mechanicId`, only starts at which that mechanic is free MUST be returned (the lift condition unchanged). Given `excludeBookingId`, the segments and the awaiting capacity of that booking MUST not block the result, so a move can offer the booking its own time back.

_From 154-free-slots._

### 154-FR-008 — A lift MUST be needed when `needsLift` is true, or, with `needsLift` absent, when any job in `jobTypeIds` has `needs_lift`; `needsLift=false` wins over the jobs. With `lift_schedule` off or `lift_count` 0 lifts MUST be ignored entirely: no lift condition and no 400.

_From 154-free-slots._

### 154-FR-009 — With `team_mechanics` off there MUST be no mechanic condition and no awaiting-mechanic capacity: a start is free when the whole job lies within the garage's opening hours of that day (chained over the next opening days when longer, as FR-006), not on a closed day or a legal holiday, and, when a lift is needed and lifts are in use, a lift is free for the whole job; the owner's overlapping bookings are allowed. An awaiting booking whose jobs need a lift still takes one lift unit (FR-004); only the mechanic unit goes. A garage with no opening hours stored offers no start.

_From 154-free-slots._

### 154-FR-010 — Candidate starts MUST fall on 30-minute steps of the Bucharest wall clock from `earliest` (FR-003) to the end of the horizon's last day (day 1 is `earliest`'s Bucharest calendar day, day N ends at 24:00 Bucharest time), scanned in order and stopped at `count` results; on a clock-change day the grid follows the wall clock and a duration stays a length in minutes.

_From 154-free-slots._

### 154-FR-011 — Every returned start MUST be one the booking confirm's placement check (150-FR-002, 427-FR-006) accepts at that moment for some counted mechanic and lift: the engine reads the same calendar, hours, day-off, segment and block rules through the shared schedule code, never a copy of them. Which mechanic and lift made a start free is not returned and not promised; they are set at confirmation.

_From 154-free-slots._

### 154-FR-012 — The answer MUST be served from a per-garage cache in Valkey keyed by the garage and every normalized parameter (after FR-003's defaults and the rounding of `earliest`, so one key per distinct question), kept at most 60 seconds, and dropped for the whole garage when any schedule event of that garage is relayed: `booking.confirmed`, `booking.moved`, `booking.cancelled`, `booking.lapsed`, `booking.no_show_recorded`, `quote.accepted`, `mechanic.added`, `mechanic.updated`, `mechanic.removed`, `garage.updated`, `garage.features_changed`, `time_block.created`, `time_block.updated`, `time_block.deleted`. PostgreSQL stays the truth: a cold cache or a Valkey outage is a read from PostgreSQL, never an error and never a changed answer, and the schedule tables are never written by the engine.

_From 154-free-slots._

### 154-FR-018 — Tests MUST exist before the code (Principle II), each file with a whole-line `// @traces` comment naming this feature's FR ids. Unit (Jest, no database): a table of cases for mechanic and lift overlaps with lifts on and off; working hours, days off, Saturdays, closed days and holidays; awaiting capacity and `excludeBookingId`; time blocks on a mechanic, on a lift and on both; team off; multi-day chains; a clock-change day; the earliest-start rounding and an empty horizon. API (Jest on real PostgreSQL and Valkey): every caller of FR-002 (200, 403, 404), the driver's two entitlements, the 400s of FR-003, scenario 9 through the cache drop, a p95 check under 300 ms over 20 calls on a seeded garage with 10 mechanics, 5 lifts and 30 days of bookings, FR-013, FR-014 and `review.posted` (FR-015) on the outbox rows, the two review decision kinds on `audienceOf` (FR-015), and FR-016. End to end (Playwright): none of its own; covered through #135.

_From 154-free-slots._

## Retired

- `220-FR-007` — superseded by `389-FR-002` (2026-10-21)
- `389-FR-002` — superseded by `276-FR-004` (2026-10-26)
- `274-FR-020` — superseded by `275-FR-001` (2026-10-29)
- `150-FR-002` — superseded by `427-FR-006` (2026-10-29)
- `150-FR-008` — superseded by `427-FR-005` (2026-10-29)
- `427-FR-013` — struck by 427-time-blocks at clarify (2026-10-29): no code lowers `lift_count`; the first story that writes it owns the guard
- `424-FR-015` — superseded by `1393-FR-011` (2026-10-30)

---
capability: workshop
updated: 2026-10-09
features:
  - 220-requests-quotes-bookings
  - 424-job-steps
---

# Capability: Workshop

The work in the garage for a confirmed booking: the job, its stages and the time each began, its steps, and the final price recorded at handover.

## Requirements

### 220-FR-007 — A JOB MUST store: booking, garage, car, driver, mechanic (optional), status ∈ `to_do`, `in_work`, `paused`, `done`, `cancelled`, `started_at`, `paused_at`, `finished_at`, `handed_over_at`, `eta_at` (optional), `final_price_bani` (optional, recorded at handover by a later story), `created_at`; one JOB per booking. A JOB_STEP MUST store: job, position, `label` (the garage's text, 1 to 120 characters), `customer_label` (optional, the words the driver sees, 1 to 120 characters), `done_at` (optional). A JOB_STAGE_ENTRY MUST store: job, from status (absent for the first), to status, actor (account, optional for `system`), `actor_role`, `text` (optional, the garage's own words for the driver, at most 500 characters), `at`, so the tracker of a later story shows when each stage began. Nothing in this story creates a job; it is created `to_do` by the confirmation story.

_From 220-requests-quotes-bookings._

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

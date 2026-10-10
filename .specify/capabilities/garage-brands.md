---
capability: garage-brands
updated: 2026-10-10
features:
  - 039-brand-catalogue
  - 040-garage-brand-stance
  - 397-listing-ticks
  - 412-brand-job-ticks
---

# Capability: Garage brands

What a garage says about each brand: its stance (works on it or does not take it, unstated when nothing is said), the fuel ticks and the jobs on a brand it works on, its brand note and refusal phrase, and the one read function that gives its answer for a brand.

## Requirements

### 039-FR-013 — For each garage and brand the system MUST store at most one row, whose stance is one of `works_on` and `does_not_take`; a garage with no row for a brand has the answer `unstated`.

_From 039-brand-catalogue._

### 039-FR-014 — A `works_on` row MUST carry four fuel ticks (petrol, diesel, hybrid, electric), all true when the row is created; a `does_not_take` row MUST carry no fuel ticks, and ticking one on it MUST be refused; turning a `works_on` row into `does_not_take` clears its fuel ticks and deletes its job rows in the same write.

_From 039-brand-catalogue._

### 039-FR-015 — A garage MUST be able to hold one row per job type (a `job_type_id`, no foreign key until the job catalogue exists) it does for a brand, only for a brand with a `works_on` row; a job row for any other brand MUST be refused.

_From 039-brand-catalogue._

### 039-FR-016 — A garage MUST be able to hold an optional brand note of up to 140 characters and an optional refusal phrase of up to 60 characters; longer text MUST be refused.

_From 039-brand-catalogue._

### 039-FR-017 — One read function MUST give a garage's answer for a brand: `works_on`, `does_not_take` or `unstated`.

_From 039-brand-catalogue._

### 040-FR-008 — The system MUST let the garage's owner (whatever the garage's status) replace the garage's whole brand answer in one write: a set of (brand, stance ∈ taken, refused) plus the optional note and phrase. Brands in the set get that stance (a new row or a changed one; a brand turned taken gets its ticks as ST-39 defines, a brand turned refused loses them), brands absent from the set lose their row, and the note and the phrase are set or cleared; the garage's status and verification are untouched. The write answers with the garage's brand answer as stored after it (the same lists, note and phrase as FR-012).

_From 040-garage-brand-stance._

### 040-FR-009 — The write MUST be refused whole, changing nothing, when a brand id has no catalogue row (a retired brand passes), a stance is not one of the two, a garage id that is not a uuid, a brand appears twice, the note exceeds 140 characters or the phrase 60 (bad request); the garage's own receptionist or mechanic MUST get 403; an actor with no owner membership of that garage, a MotorFix admin included, MUST get 404; a call without a session MUST get the sign-in demand like every route.

_From 040-garage-brand-stance._

### 040-FR-010 — Every brand created, changed or removed by the write MUST be in the audit history with the actor, their role, the garage, the brand and the old and new stance; a changed note or phrase MUST be recorded likewise; a write that changes nothing MUST record nothing.

_From 040-garage-brand-stance._

### 040-FR-011 — A write that changed anything MUST save one `garage.updated` event with the field `brands` in the same transaction as the change, addressed to the garage's public page, to the search of every brand whose stance changed, and to the garage's staff, so those open screens refresh; a write that changed nothing emits no event.

_From 040-garage-brand-stance._

### 040-FR-012 — The public garage read MUST carry the garage's brand answer: the brands taken and the brands refused as two lists of (id, name, slug) in catalogue order (popularity rank, then name), plus the note and the phrase (null when not set); a brand retired from the catalogue stays in the lists; a garage with nothing marked has two empty lists.

_From 040-garage-brand-stance._

### 397-FR-010 — `PUT /api/v1/garages/:garageId/brands` MUST accept, on each brand, an optional `fuels` list of the ticked kinds (each at most once): for a `works_on` brand it sets the four columns (a missing key means unchanged for a brand already taken, all four for one that becomes taken; `[]` unticks all four); on a `does_not_take` brand it is refused with 400 `validation_failed`. A brand that becomes taken stays one `create` history entry whose new value carries its fuels; for a brand already taken, each changed column is one history entry (subject `garage_brand`, field `petrol` / `diesel` / `hybrid` / `electric`, old and new value), and the one `garage.updated` event of the write names `brand_fuels` in `fields` when a fuel changed, beside `brands` when a stance or text changed; a write that changes nothing records nothing. The owner-only rule, the lock and the transaction stay as they are.

_From 397-listing-ticks._

### 412-FR-006 — The system MUST own one function, inside the caller's transaction, that writes a garage's job ticks from the step-2 section and the garage's jobs as the prices write returns them, `{ jobTypeId, name? }` per step-3 entry (`name` for a proposed job, matched to an unticked name by exact string): for every `works_on` brand, one `GARAGE_BRAND_JOB` row per job except the ones the section unticked for that brand, each recorded once in the audit history as `create`, subject `garage_brand_job`, with the writing account, its role and the brand. The listing's brands write (`writeGarageBrands`) MUST perform it, so the sending story's one transaction gets the rows by calling what exists. An unticked ref that matches no job of the garage MUST refuse the write whole with 400 and a stable validation code.

_From 412-brand-job-ticks._

### 412-FR-007 — `PUT /api/v1/garages/:garageId/brands` MUST accept, on each brand, an optional `jobs` list of job type ids (each at most once): for a `works_on` brand it sets exactly those rows (a missing key means unchanged for a brand already taken, every job of the garage's price list for one that becomes taken; `[]` deletes them all); on a `does_not_take` brand, or naming a job type that has no `GARAGE_PRICE` row for this garage, it is refused whole with 400 `validation_failed`. Each row created or deleted is one audit entry (`create` / `delete`, subject `garage_brand_job`, subject id the job type, the brand in the value) with the actor and role; the write's one `garage.updated` event names `brand_jobs` in `fields` when a tick changed, beside `brands` and `brand_fuels` as today; a write that changes nothing records nothing. The owner-only rule (403 for the garage's own staff, 404 for anyone else, the sign-in demand without a session), the garage row lock, the transaction, and the untouched status and verification stay as they are.

_From 412-brand-job-ticks._

### 412-FR-008 — The write's answer (the garage's brand answer) MUST carry, on each taken brand, `jobs`: its ticked job type ids in the price list's order; the public garage read is unchanged.

_From 412-brand-job-ticks._

### 412-FR-009 — A brand turned `does_not_take` or switched off MUST keep losing its rows in the same write, each loss audited, as the stance story shipped it; ticks are not kept hidden.

_From 412-brand-job-ticks._

### 412-FR-010 — Changing ticks MUST never change the garage's status or send it back to review, and MUST never withdraw a request already received; the routing rule (221-FR-007) and the quote's `included` marks read the rows as they stand when a request is sent or a quote written. A job added later to a live garage's price list starts ticked for its taken brands [R1]; the write that adds it (MF-57's editor) owns those rows, not this story.

_From 412-brand-job-ticks._

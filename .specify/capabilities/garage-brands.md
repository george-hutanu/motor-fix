---
capability: garage-brands
updated: 2026-10-07
features:
  - 039-brand-catalogue
  - 040-garage-brand-stance
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

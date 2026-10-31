---
capability: garage-brands
updated: 2026-10-30
features:
  - 039-brand-catalogue
  - 040-garage-brand-stance
  - 397-listing-ticks
  - 412-brand-job-ticks
  - 1352-catalogue-job-visibility
  - 414-approve-catalogue-job
  - 1247-brand-fuel-edit
---

# Capability: Garage brands

What a garage says about each brand: its stance (works on it or does not take it, unstated when nothing is said), the fuel ticks and the jobs on a brand it works on, its brand note and refusal phrase, and the one read function that gives its answer for a brand.

## Requirements

### 039-FR-013 — For each garage and brand the system MUST store at most one row, whose stance is one of `works_on` and `does_not_take`; a garage with no row for a brand has the answer `unstated`.

_From 039-brand-catalogue._

### 039-FR-014 — A `works_on` row MUST carry four fuel ticks (petrol, diesel, hybrid, electric), all true when the row is created; a `does_not_take` row MUST carry no fuel ticks, and ticking one on it MUST be refused; turning a `works_on` row into `does_not_take` clears its fuel ticks and deletes its job rows in the same write.

_From 039-brand-catalogue._

### 1352-FR-016 — `garage_brand_job.job_type_id` MUST have a foreign key to `job_type(id)` with `ON DELETE RESTRICT` (catalogue rows are never deleted; the ticks go with the price rows, FR-007): the migration first deletes the ticks whose job id has no catalogue row (a comment in the migration says so), then adds the constraint; the schema holds the relation on both sides and the comment "the job_type table does not exist yet" is gone (modifies 039-FR-015's "no foreign key until the job catalogue exists").

_From 1352-catalogue-job-visibility._

### 039-FR-016 — A garage MUST be able to hold an optional brand note of up to 140 characters and an optional refusal phrase of up to 60 characters; longer text MUST be refused.

_From 039-brand-catalogue._

### 039-FR-017 — One read function MUST give a garage's answer for a brand: `works_on`, `does_not_take` or `unstated`.

_From 039-brand-catalogue._

### 1247-FR-006 — Everything else of the write stays as the capability holds it: whole-answer replace, brands absent lose their row (040-FR-008), the refusals of 040-FR-009, the per-row audit entries (040-FR-010, 397-FR-010, 412-FR-007), the one `garage.updated` in the same transaction with `brands` / `brand_fuels` / `brand_jobs` in `fields` and the changed brand ids in its audience (040-FR-011), the note's 140 and the phrase's 60 (039-FR-016), owner only.

_From 1247-brand-fuel-edit._

### 040-FR-009 — The write MUST be refused whole, changing nothing, when a brand id has no catalogue row (a retired brand passes), a stance is not one of the two, a garage id that is not a uuid, a brand appears twice, the note exceeds 140 characters or the phrase 60 (bad request); the garage's own receptionist or mechanic MUST get 403; an actor with no owner membership of that garage, a MotorFix admin included, MUST get 404; a call without a session MUST get the sign-in demand like every route.

_From 040-garage-brand-stance._

### 040-FR-010 — Every brand created, changed or removed by the write MUST be in the audit history with the actor, their role, the garage, the brand and the old and new stance; a changed note or phrase MUST be recorded likewise; a write that changes nothing MUST record nothing.

_From 040-garage-brand-stance._

### 040-FR-011 — A write that changed anything MUST save one `garage.updated` event with the field `brands` in the same transaction as the change, addressed to the garage's public page, to the search of every brand whose stance changed, and to the garage's staff, so those open screens refresh; a write that changed nothing emits no event.

_From 040-garage-brand-stance._

### 040-FR-012 — The public garage read MUST carry the garage's brand answer: the brands taken and the brands refused as two lists of (id, name, slug) in catalogue order (popularity rank, then name), plus the note and the phrase (null when not set); a brand retired from the catalogue stays in the lists; a garage with nothing marked has two empty lists.

_From 040-garage-brand-stance._

### 1247-FR-002 — A `works_on` brand sent with `fuels: []` MUST be refused whole with 400 `validation_failed`, code `fuels_empty`, field `brands[i].fuels`: at least one fuel type stays ticked on a taken brand. A missing `fuels` key keeps its meaning (unchanged for a brand already taken, all four for one that becomes taken). Modifies 397-FR-010's "`[]` unticks all four".

_From 1247-brand-fuel-edit._

### 1247-FR-003 — (from #1128) A job reference that names no job MUST be refused with 400 also while the garage's price list is empty. On the owner `PUT`, a `jobs` id not on the price list is refused with `job_not_priced` whether the list is empty or not (today's rule, now covered by a test of the empty case). On the listing's brands write (412-FR-006, `write-garage-brands.ts`), which today skips every unticked ref while the garage has no priced job, an unticked ref that is a uuid naming no job type of the catalogue MUST be refused with `unknown_job` also while the list is empty; a ref that is a catalogue job type's uuid or a proposed job's name still waits for the second call, so ST-116's two-step send (brands before prices, then again with the jobs) keeps succeeding and its test stays green. A test covers the empty-list refusal and fails on today's code.

_From 1247-brand-fuel-edit._

### 412-FR-007 — `PUT /api/v1/garages/:garageId/brands` MUST accept, on each brand, an optional `jobs` list of job type ids (each at most once): for a `works_on` brand it sets exactly those rows (a missing key means unchanged for a brand already taken, every job of the garage's price list for one that becomes taken; `[]` deletes them all); on a `does_not_take` brand, or naming a job type that has no `GARAGE_PRICE` row for this garage, it is refused whole with 400 `validation_failed`. Each row created or deleted is one audit entry (`create` / `delete`, subject `garage_brand_job`, subject id the job type, the brand in the value) with the actor and role; the write's one `garage.updated` event names `brand_jobs` in `fields` when a tick changed, beside `brands` and `brand_fuels` as today; a write that changes nothing records nothing. The owner-only rule (403 for the garage's own staff, 404 for anyone else, the sign-in demand without a session), the garage row lock, the transaction, and the untouched status and verification stay as they are.

_From 412-brand-job-ticks._

### 412-FR-008 — The write's answer (the garage's brand answer) MUST carry, on each taken brand, `jobs`: its ticked job type ids in the price list's order; the public garage read is unchanged.

_From 412-brand-job-ticks._

### 412-FR-009 — A brand turned `does_not_take` or switched off MUST keep losing its rows in the same write, each loss audited, as the stance story shipped it; ticks are not kept hidden.

_From 412-brand-job-ticks._

### 1352-FR-003 — The add MUST write no brand tick: the job starts unticked for every brand the garage takes, and the owner ticks it through the brands write (OD-33, #1123; modifies 412-FR-010's "[R1]" clause).

_From 1352-catalogue-job-visibility._

### 414-FR-006 — The approval MUST write no brand tick: the job starts unticked for every brand the proposing garage takes, as an added job does (1352-FR-003, OD-33). Nothing else in this story changes which jobs are public, pickable, requestable or counted: an approved job is public on the proposer's profile through the existing rule (357-FR-001, computed on read, 357-FR-004), is offered by the picker's search (109-FR-006, approved jobs), and can be named in a request and counted in the figures as any approved job; the tests of FR-013 prove it.

_From 414-approve-catalogue-job._

### 1247-FR-001 — A new owner read `GET /api/v1/garages/{garageId}/brands` MUST answer the garage's brand answer as the owner's write answers it (412-FR-008: taken brands each with `fuels` and `jobs` in price-list order, refused brands, `note`, `phrase`), plus `priceList`: the garage's priced jobs `{ jobTypeId, nameRo, nameEn }` in the price list's order, every job a tick can name (412-FR-007), so the dialog opens on one read. It answers 200 for the owner, 403 `forbidden` for the garage's receptionist or mechanic, 404 `not_found` for every other actor and for a garage that is no garage, 410 `gone` for a suspended garage, and the sign-in demand without a session; it writes nothing and emits nothing. It is listed in `infra/observability/inventory.json` as an endpoint with its route metric, no panel or alert of its own.

_From 1247-brand-fuel-edit._

### 1247-FR-004 — (from #596) `brands` of the write's body MUST carry `@ArrayMaxSize(200)`: a payload of 201 brands answers 400; 200 pass validation.

_From 1247-brand-fuel-edit._

### 1247-FR-005 — (from #602) The garage row lock of the write (`lockGarage` and `setStance`) MUST be `FOR NO KEY UPDATE`: the stance writes stay serialised (the race spec passes), and a transaction that inserts a row referencing the garage is not blocked while the lock is held (test).

_From 1247-brand-fuel-edit._

### 1247-FR-007 — (from #567) A migration MUST add a trigger on `garage_brand_job` that refuses an inserted row whose `(garage_id, brand_id)` row in `garage_brand` is not `works_on` (the missing-row case is the existing composite foreign key's); the service's flip from taken to refused, which deletes the ticks in the same transaction, is unchanged and keeps passing. An integration test proves the refusal outside the service and the flip inside it.

_From 1247-brand-fuel-edit._

### 1247-FR-008 — (from #603) The race spec MUST wait for the second transaction's backend to be blocked, read from `pg_blocking_pids(<its pid>)`, instead of a database-wide count of `transactionid` lock waits.

_From 1247-brand-fuel-edit._

### 1247-FR-009 — (from #597) One `notFound` refusal MUST serve `garage-brands.service.ts` and `public-garages.ts` (and `garage-profile.service.ts`, which already imports the former's); the 404 bodies answered today stay as they are.

_From 1247-brand-fuel-edit._

### 1247-FR-017 — (from #604) A PR QA flow MUST open two tabs signed in as the same owner, make the first stance write for the same unstated brand in both at once, and assert one stored `garage_brand` row for it and no 500 on either response; a second flow drives the dialog end to end (mark taken, untick a fuel and a job, save, see the owner's view and the public profile updated). Each flow pushes its findings as found, waits on visible elements or `waitForText`, never `networkidle`, and is proven with `precheck.mjs --check` before dispatch.

_From 1247-brand-fuel-edit._

### 1247-FR-018 — Tests MUST exist before the code (Principle II) and name this feature's ids in `// @traces` lines: Jest on real PostgreSQL and Redis for FR-001 (the answer's shape and the role matrix), FR-002, FR-003 (the empty-list refusal, failing on today's code, and ST-116's composition), FR-004, FR-005 (the unblocked referencing insert), FR-007 (the trigger), FR-008, FR-009; component tests for FR-010 to FR-013 (the control per role, the three-state control, the fuel and job ticks, the last-fuel rule, the limit errors, 400 and network handling, the no-second-read close); the bundle budget of FR-014 asserted by the production build in CI; the flows of FR-017.

_From 1247-brand-fuel-edit._

## Retired

- `412-FR-010` — superseded by `1352-FR-003` (2026-10-20)
- `039-FR-015` — superseded by `1352-FR-016` (2026-10-20)
- `397-FR-010` — superseded by `1247-FR-002` (2026-10-30)
- `412-FR-006` — superseded by `1247-FR-003` (2026-10-30)
- `040-FR-008` — superseded by `1247-FR-006` (2026-10-30)

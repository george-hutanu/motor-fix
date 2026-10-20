---
capability: catalogue
updated: 2026-10-20
features:
  - 039-brand-catalogue
  - 112-opening-hours
  - 354-job-catalogue-prices
  - 109-garage-details-prices
  - 230-brand-search
  - 357-public-price-jobs
  - 386-brand-price-range
  - 172-price-list-states
  - 173-price-range-in-place
  - 405-car-model-licences
  - 228-how-it-works-list-garage
  - 176-price-change-activity-log
  - 1352-catalogue-job-visibility
---

# Capability: Catalogue

The brand catalogue MotorFix keeps for the whole product: every car brand sold in Romania, loaded from a versioned data file, with its name, slug, popularity and active flag, and the public brand search that every picker uses.

## Requirements

### 039-FR-001 — The system MUST keep one brand list for the whole product, maintained by MotorFix: garages cannot add, rename or remove a brand, and every part of the product that names a brand uses the same brand ids.

_From 039-brand-catalogue._

### 228-FR-012 — Every night, the searches of the 30 closed Europe/Bucharest days ending yesterday (the demand job's per-day per-brand counts) MUST be summed per active brand and written as a full popularity rank 1..N over every active brand: searched brands by their count, then the rest by their current rank (on the first night, the seed rank), then by name.

_From 228-how-it-works-list-garage._

### 039-FR-003 — The brand list MUST be loaded from a versioned data file kept in the repository by a loader that stores every brand of the file exactly once, and the repository MUST ship a development file holding at least the twelve brands of the mock (BMW, Mini, Mercedes-Benz, Audi, Volkswagen, Škoda, Dacia, Renault, Ford, Toyota, Hyundai, Tesla).

_From 039-brand-catalogue._

### 228-FR-015 — A catalogue reload MUST NOT undo the nightly ranking: it sets a popularity rank only on the brands it inserts.

_From 228-how-it-works-list-garage._

### 039-FR-005 — When a brand's name or slug is corrected in the file, the loader MUST keep the brand's id and every garage row that names it, and readers MUST see the new name.

_From 039-brand-catalogue._

### 039-FR-006 — When a brand is absent from the file, the loader MUST keep it with its garage rows and mark it inactive; inactive brands are not returned by brand search or pickers.

_From 039-brand-catalogue._

### 039-FR-007 — A file holding two brands with the same stable key, name or slug, or a brand whose name or slug is already held by another stored brand (a retired one included), MUST fail the whole load, naming the duplicate, and the stored list MUST be exactly what it was before.

_From 039-brand-catalogue._

### 039-FR-008 — Every brand the loader creates, changes, retires or brings back MUST be recorded in the audit history with the actor `system`.

_From 039-brand-catalogue._

### 039-FR-009 — A change to the brand list MUST drop the cached brand list (one cache entry holding the whole active list) so the next search reflects it.

_From 039-brand-catalogue._

### 039-FR-010 — Brand search MUST match the typed text against brand names ignoring accents and case ("sko", "Skoda" and "ŠKODA" all find "Škoda"), and return only active brands.

_From 039-brand-catalogue._

### 039-FR-011 — An empty search MUST return the active brands by popularity, most popular first, then by name.

_From 039-brand-catalogue._

### 039-FR-012 — Brand search MUST be open to visitors without a session, return `{ items, nextCursor, total }` with at most 20 brands a page and an opaque cursor for the next page, and be served from a cache kept for one hour.

_From 039-brand-catalogue._

### 112-FR-008 — The system MUST hold a public-holiday calendar in the catalogue: one row per legal holiday day with its date and its Romanian and English name, created and filled for 2026 and 2027 by a migration under Romania's Labour Code (1 and 2 January, 6 and 7 January, 24 January, Orthodox Good Friday, Orthodox Easter Sunday and Monday, 1 May, 1 June, Orthodox Pentecost Sunday and Monday, 15 August, 30 November, 1 December, 25 and 26 December), a day held once: 16 days in 2026, where 1 June is both Children's Day and Pentecost Monday and its row carries both names, and 17 in 2027. The insert skips a day already held, so a later year is added by another migration's data with no code change.

_From 112-opening-hours._

### 109-FR-021 — (Replaces 354-FR-001.) The system MUST keep one job catalogue for the whole product, maintained by MotorFix, with one row per job holding an id, a stable key, a Romanian name, an English name, a status among `approved`, `pending` and `rejected`, an optional car system and an optional RAR activity code (both empty for the first six, filled by the stories that own them), an optional proposing garage (`proposed_by_garage_id`, empty for the shipped jobs and set for a job a garage proposed through its listing), created and updated times.

_From 109-garage-details-prices._

### 354-FR-002 — The product MUST ship the six jobs of the mock as approved catalogue data, keyed stably, and load them in every environment, production included, when the product starts or its data load runs; the load MUST mirror the brand load: the file wins on names, each created or changed row is audited once by `system`, rows outside the file are left alone; it MUST be idempotent (a second run with an unchanged file creates, renames and re-ids nothing and writes no audit entry) and atomic (a failed load leaves the catalogue as it was), and two loads at once MUST still leave exactly one row per key.

_From 354-job-catalogue-prices._

### 109-FR-006 — "Adaugă o lucrare" / "Add a job" MUST search the catalogue as the owner types (from the second character): approved jobs whose Romanian or English name contains the text, accents and case ignored, at most 20, excluding jobs already in the list; choosing one adds a row with an empty range. The search MUST be a public read of the API (the owner has no account): `GET /api/v1/job-types?q=` answering `{ items: [{ id, nameRo, nameEn }] }`, approved jobs only, at most 20, in catalogue order (name), open to visitors without a session and listed with the public routes (`apps/api/src/public-routes.integration.spec.ts`). An empty `q` answers the approved jobs by name, at most 20. Only the answer to the text last typed is shown: a slower answer to an earlier text is dropped.

_From 109-garage-details-prices._

### 230-FR-015 — The development brand data file MUST hold Alfa Romeo and Citroën (unranked) besides its twelve brands, so the scenarios above run against the development catalogue; the eight tiles stay the eight most popular.

_From 230-brand-search._

### 357-FR-001 — The system MUST decide, for each job on a garage's price list, whether drivers see it: a job is public when its catalogue status is `approved`, its kind of work is covered by the garage's RAR authorisation (the job's RAR activity is empty or among the activities an admin recorded for the garage, or the garage has none recorded yet, FR-008), the garage has not hidden its default (no brand) price row, and both ends of that default range are set. A brand row's `visible` flag plays no part.

_From 357-public-price-jobs._

### 357-FR-002 — When a job is not public, the system MUST give exactly one reason code, the first that applies in this order: `rejected` (catalogue status rejected), `awaiting_approval` (catalogue status pending), `not_authorised`, `hidden_by_garage`, `no_top_price` (top of the default range missing, or no default range at all).

_From 357-public-price-jobs._

### 357-FR-003 — The job's default range MUST decide for every brand: a complete brand range never makes a job public, and an incomplete brand range never hides a job whose default range is complete; the same holds for the visible flag: only the default row's counts.

_From 357-public-price-jobs._

### 357-FR-004 — The state MUST be computed on every read from the stored rows, never stored, so a change of price, visibility, catalogue status or authorisation needs no second write and no new approval by MotorFix.

_From 357-public-price-jobs._

### 357-FR-005 — The rule MUST live in one place in the garages domain and be the only judge of a job's public state: both the public profile's job list and the owner's list call it, with no second copy of the conditions in either reader (Principle V).

_From 357-public-price-jobs._

### 386-FR-011 — The owner's read (`GET /api/v1/garages/{garageId}/prices`, 357-FR-007) MUST carry on each item `brandRanges`, the job's brand rows in catalogue order (popularity rank, then name), each `{ brandId, name, fromBani, toBani }` — the brand's id and catalogue name and both ends in bani (a row with no top is listed with `toBani` absent); `[]` when the job has none. Nothing else in the item changes.

_From 386-brand-price-range._

### 357-FR-008 — A garage with no recorded RAR activities (approved before the by-hand RAR check recorded any) MUST count every job as covered by its authorisation, until an admin records its activities; once any are recorded, a job is covered only when its RAR activity is empty or among them.

_From 357-public-price-jobs._

### 357-FR-009 — Only the garage's owner reads the list: a receptionist or a mechanic of the garage gets 403 `forbidden`, anyone whose account is not of that garage gets 404 `not_found` with nothing about the garage, and no session gets the standard sign-in demand; an AI assistant acting for the owner reads it like the owner; the check is the one the brands write already uses (`assertGarageOwner`); a `garageId` that is not a uuid gets 400 `validation_failed` before any check.

_From 357-public-price-jobs._

### 357-FR-010 — The endpoint MUST be described in the API's OpenAPI document with its DTOs in the contracts library, so the generated client carries it for the Prețuri view (Principle V).

_From 357-public-price-jobs._

### 357-FR-011 — Observability MUST ship with the endpoint: its route counts under the API's request duration metric and its errors in the API's error rate, both on the `motorfix-api` dashboard and covered by the `api` entry's `api-error-rate` and `api-latency` alert rules; the endpoint count in `infra/observability/inventory.json` is rewritten from `apps/api/openapi.json` (`scripts/observability-inventory.ts --write`) and the inventory check passes.

_From 357-public-price-jobs._

### 357-FR-012 — The reason codes MUST be the vocabulary the view will label (`no_top_price` "ascuns · fără preț maxim", `hidden_by_garage` "ascuns de tine", `not_authorised` "ascuns · nu e în autorizația RAR", `awaiting_approval` "ascuns · așteaptă aprobarea", `rejected` "respins"); the API returns the codes only, the labels belong to specs issue #139.

_From 357-public-price-jobs._

### 386-FR-011 — The owner's read (`GET /api/v1/garages/{garageId}/prices`, 357-FR-007) MUST carry on each item `brandRanges`, the job's brand rows in catalogue order (popularity rank, then name), each `{ brandId, name, fromBani, toBani }` — the brand's id and catalogue name and both ends in bani (a row with no top is listed with `toBani` absent); `[]` when the job has none. Nothing else in the item changes.

_From 386-brand-price-range._

### 172-FR-006 — The owner's read MUST carry the garage's hourly labour range, `labour: { fromBani, toBani }`, present only when both ends are set (the shape the public profile's `labour` already has), so the view shows under the list the note "Manoperă: {range} / oră. Minimul e mașina mică și simplă, maximul e cea mare sau dificilă." / "Labour: {range} / hour. The low end is the small, easy car; the high end is the big or awkward one.", `{range}` the whole-lei range ("180–240 lei"); the note is absent when `labour` is. Nothing else in the read changes; the DTO is in the contracts library, the OpenAPI file and the generated client are regenerated (Principle V). Extends the read of 386-FR-011, which stays.

_From 172-price-list-states._

### 173-FR-004 — The API MUST serve `PATCH /api/v1/garages/{garageId}/prices/{priceId}` for a job's default row: body `{ fromBani, toBani, durationMinutes, expectedUpdatedAt }` from a DTO in the contracts library, `fromBani` required, `toBani` and `durationMinutes` each required and either an integer or `null` (clear), an omitted one refused with 422 `required`, `expectedUpdatedAt` the row's `updatedAt` as the read gave it; the shared range check decides, a failure answering 422 with the field errors (the shape of the brand range write, 386), a bare 400 `validation_failed` only for a malformed body or id. It writes `from_bani`, `to_bani`, `duration_minutes`, `updated_at` (now) and `updated_by` (the actor) and answers the saved row (`priceId`, `jobTypeId`, `fromBani`, `toBani`, `durationMinutes`, `updatedAt`, `warnings`). A body with no change writes nothing and answers 200 with the stored row. The OpenAPI document and the generated client are regenerated.

_From 173-price-range-in-place._

### 173-FR-005 — The API MUST serve `PATCH /api/v1/garages/{garageId}/labour` with body `{ fromBani, toBani }`, both required integers (a missing one refused with `required` before the range check, as 109-FR-015), the shared range check deciding (422 on a field error); clearing the labour range is out of scope, writing `labour_from_bani` and `labour_to_bani` on the garage and answering `{ fromBani, toBani, warnings }`. The garage's verification status, approval and every other column stay as they are.

_From 173-price-range-in-place._

### 173-FR-006 — Both writes MUST be the owner's alone (`assertGarageOwner`): the garage's receptionist or mechanic answers 403, another garage's owner 404, as the price list's reads and the brand write do (357-FR-009). A `priceId` that is not one of this garage's default rows (another garage's row, a brand row, an unknown id) answers 404 with nothing about it.

_From 173-price-range-in-place._

### 1352-FR-008 — The owner's read (`GET /api/v1/garages/{garageId}/prices`) MUST carry on each item `visible` (the default row's flag; absent for a job with no default row), so the view knows the owner's own choice when another reason comes first in the state's order (modifies 173-FR-007's read, whose "nothing else changes" clause this extends; 357-FR-001's rule and the reason order are unchanged).

_From 1352-catalogue-job-visibility._

### 173-FR-010 — A price or labour change MUST never start or change a MotorFix review: the garage's verification status, its listing and its approval are untouched by these writes, and the profile shows the new range at once (acceptance criterion; unlike the changes of #127). A quote keeps the range it was sent with: `QUOTE.from_bani`/`to_bani` are never read from or written by these writes (220-FR-005 already stores them).

_From 173-price-range-in-place._

### 173-FR-012 — Brand lines MUST be edited through the existing brand range write (`PUT /api/v1/garages/{garageId}/prices/{jobTypeId}/brands/{brandId}`, 386), with the same editor, errors and saving states; this story adds no brand route and no removal of a brand range from the view (ST-386's own screens own removal).

_From 173-price-range-in-place._

### 405-FR-002 — The product MUST keep one catalogue of the licensed car models, in a data file beside the brand list (`libs/domain/src/catalogue/`), the file #1241 seeds `CAR_MODEL_3D` from as the brand loader seeds `BRAND` from `brands.ts`, holding exactly the 20 models of the list; each model MUST carry a stable key, its brand key (a key of MotorFix's brand list), its model name, its fuel (one of the four fuel values the cars contract already uses: `petrol`, `diesel`, `hybrid`, `electric`) and its rank within its brand.

_From 405-car-model-licences._

### 405-FR-003 — The product MUST answer, for a brand key alone, which car shows: the brand's rank-1 licensed model when the brand has one; otherwise a generic body shape — the brand's body style in the brand list (`bodyStyle`, #1241's `BRAND.body_style`), set from the mock for `volkswagen` hatchback, `dacia` suv, `toyota` crossover, `skoda` estate, `ford` fastback, else `saloon`. A brand key the brand list does not know MUST get the generic `saloon`, with no error. The answer MUST say which of the two it is: `{ kind: 'licensed', model }` with the model record, or `{ kind: 'generic', bodyStyle }`.

_From 405-car-model-licences._

### 405-FR-004 — A validator MUST refuse a malformed catalogue file, naming the first fault found, in this order: a duplicate model key; two models of one brand with the same rank; a brand whose ranks are not exactly 1..n; a fuel outside the four. The shipped file MUST pass it, and the validator MUST run over the shipped file in a unit test.

_From 405-car-model-licences._

### 405-FR-005 — MotorFix's brand list MUST gain Opel (`opel`, "Opel"), unranked; the brand loader's existing checks and the brand file's existing tests MUST keep passing.

_From 405-car-model-licences._

### 405-FR-006 — A unit test MUST hold every licensed model's brand key to a key of the brand list, so a renamed or removed brand that the catalogue names fails the suite.

_From 405-car-model-licences._

### 228-FR-013 — One ranking MUST serve "most searched" (the strip) and "most popular" (the picker tiles and the Results chips): no second list.

_From 228-how-it-works-list-garage._

### 228-FR-014 — When the nightly count fails, the previous ranking MUST stay and the failure MUST reach the structured error log and raise an alert (the system status log is release 3); a retry MUST produce the same ranking (writing it is idempotent).

_From 228-how-it-works-list-garage._

### 176-FR-009 — The entries MUST be readable through the existing audit history read (ST-391) by the garage's owner, its receptionist and its mechanics, and by every admin, under the `prices` area for the `garage_price` entries; another garage's staff MUST get 404; a driver MUST never receive them in the audit history, and each entry's `is_key_change` and `internal` are false so no driver short history can include it. No new read is added.

_From 176-price-change-activity-log._

### 1352-FR-001 — The Prețuri view MUST offer "Adaugă o lucrare" / "Add a job" to the garage's owner, under the list, while editing is on and when the list is empty; it opens the catalogue picker in the shared overlay (dialog from 768 px, the bottom sheet below): a search field, the matching jobs (the catalogue search of 109-FR-006, 20 at most, by Romanian name, sent the ids of the jobs already on the list as `exclude`, which it leaves out before the 20 limit; the browser filters nothing), and under them "Nu găsești lucrarea? Propune-o" / "Can't find the job? Propose it". Picking a job shows the range editor of ST-173 for the new job (duration optional, from required, to optional, whole lei, the shared range check with its texts and the wide-range warning); Save adds the job and closes; a failed save keeps the editor open with the error (ST-173's states). While the picker's search runs it shows a loading line, and a search with no match shows "Nicio lucrare găsită" / "No job found" above "Propune-o", which stays offered. A `duplicate` answer shows "Lucrarea e deja în lista ta." / "The job is already on your list." and reloads the list. The button is disabled with "Cel mult 50 de lucrări" / "At most 50 jobs" at the cap (FR-002). Accessibility and the 320 px layout follow design.md: each action carries an `aria-label` naming the job, the overlay keeps the shared focus handling, and the row actions wrap with no sideways scroll.

_From 1352-catalogue-job-visibility._

### 1352-FR-002 — The API MUST serve `POST /api/v1/garages/{garageId}/prices` with body `{ jobTypeId, fromBani, toBani, durationMinutes }` from a DTO in the contracts library: `jobTypeId` a uuid of an approved catalogue job (else 422 `unknown_job` for no catalogue row and `not_approved` for a pending or rejected one, the listing's codes through its lookup), `fromBani` required, `toBani` and `durationMinutes` each an integer or null, the shared range check deciding (422 with the field errors as the ST-173 write). It creates the job's default row visible, at the end of the list (position one past the garage's greatest), with `updated_by` the actor, and answers 201 with the saved row (`priceId`, `jobTypeId`, `fromBani`, `toBani`, `durationMinutes`, `updatedAt`, `warnings`, the shape of 173-FR-004's answer). A job already on the list (a default row for it, or any row of it) answers 422 `duplicate` on `jobTypeId` and writes nothing. A fifty-first job (more than 50 default rows on the list, pending and rejected proposals counted) answers 422 `too_many` (109-FR-009's cap).

_From 1352-catalogue-job-visibility._

### 1352-FR-004 — Every job row of Prețuri with a default row MUST offer, while editing is on, "Ascunde" / "Hide" when the job is not hidden by the owner and "Arată" / "Show" when it is, beside "Modifică"; the press saves at once, in place, with the row locked while it saves; the row's state and lamp follow the read's reason (357-FR-012's labels), "ascuns de tine" with an amber lamp for a job the owner hid. A failed save unlocks the row, leaves its state as it was and shows the error on the row ("Nu s-a salvat. Încearcă din nou." / "Not saved. Try again.").

_From 1352-catalogue-job-visibility._

### 1352-FR-005 — The API MUST accept, on `PATCH /api/v1/garages/{garageId}/prices/{priceId}`, a body `{ visible }` (`visible` a boolean, required) as a second body shape beside the range body of 173-FR-004: it sets the default row's `visible` flag and nothing else, needs no `expectedUpdatedAt` (last write wins; the same value again writes nothing and answers 200), and answers the saved row as 173-FR-004 does. The body shape is decided by the presence of `visible`: with it, any other field is refused 400 `validation_failed`. A flip that changes the flag bumps the row's `updatedAt`, so a range edit read before it answers 409 `stale` (173-FR-004's rule) and re-reads.

_From 1352-catalogue-job-visibility._

### 1352-FR-006 — Every job row with a default row MUST offer, while editing is on, "Șterge" / "Remove"; it opens the confirmation "Ștergi lucrarea din listă?" / "Remove the job from the list?" with the line "Cererile deschise și ofertele trimise rămân. Șoferii noi nu vor mai vedea lucrarea." / "Open requests and sent quotes are kept. New drivers will no longer see the job." and the buttons "Șterge" / "Remove" and "Renunță" / "Cancel"; confirming removes the job at once. A failed removal keeps the confirmation open with the error; a 404 (already removed by another session) closes it and reloads the list.

_From 1352-catalogue-job-visibility._

### 1352-FR-007 — The API MUST serve `DELETE /api/v1/garages/{garageId}/prices/{priceId}` for a job's default row: in one transaction it deletes every price row of that job for the garage (the default row and the brand rows) and every brand tick of the job, and answers 204; the request lines, quotes and anything else that names the catalogue job stay untouched (they point at the catalogue row, never at the price row). A `priceId` that is not one of this garage's default rows answers 404 with nothing about it; a removal racing another answers 404.

_From 1352-catalogue-job-visibility._

### 1352-FR-009 — The picker's "Propune-o" MUST open the propose form in the same overlay: "Numele lucrării" / "Job name" (3 to 80 characters, trimmed; the field refuses other lengths before sending), the duration and the range as FR-001, and "Trimite" / "Send"; sending adds the job to the list as "ascuns · așteaptă aprobarea" with an amber lamp and the note "O verificăm și îți spunem când e pe profil." / "We check it and tell you when it is on your profile."; a refusal shows its text on the name field: "Ai propus deja această lucrare." / "You have already proposed this job." for a pending duplicate, "Lucrarea e deja în catalog: alege-o din listă." / "The job is already in the catalogue: pick it from the list." for an approved job's name.

_From 1352-catalogue-job-visibility._

### 1352-FR-010 — The API MUST serve `POST /api/v1/garages/{garageId}/catalogue-jobs` with body `{ name, fromBani, toBani, durationMinutes }` from a DTO in the contracts library (`name` 3 to 80 characters after trimming, else 400 `validation_failed`; the range as FR-002): in one transaction it creates the catalogue row through the one proposal function the listing's prices write already has (status `pending`, `name_ro` and `name_en` the trimmed name, a unique slug key, `proposed_by_garage_id` the garage, its `job_type` audit entry, the `catalogue_job.proposed` event to the `admin` channel), then the job's default row as FR-002 (visible, last, no tick), and answers 201 with `{ jobTypeId, priceId, fromBani, toBani, durationMinutes, updatedAt, warnings }`. It MUST refuse, writing nothing: a name equal (accents and case ignored, trimmed) to the name of a pending job this garage proposed, 422 `duplicate` on `name` (also after the owner removed that job from the list: it returns once an admin approves it); a name equal only to a rejected proposal is accepted as a new pending row; a name equal to an approved job's Romanian or English name, 422 `exists` on `name` with the job's id in the error; a fifty-first job, 422 `too_many`.

_From 1352-catalogue-job-visibility._

### 1352-FR-011 — The four writes MUST be the owner's alone (`assertGarageOwner`): the garage's receptionist or mechanic answers 403, another garage's owner or an admin 404 with nothing about the garage, no session the standard sign-in demand, a malformed id 400 before any check (357-FR-009, 173-FR-006).

_From 1352-catalogue-job-visibility._

### 1352-FR-012 — None of the writes MUST start or change a MotorFix review: the garage's verification status, listing and approval are untouched, and a change shows on the profile at once; a quote keeps the range it was sent with (173-FR-010).

_From 1352-catalogue-job-visibility._

### 1352-FR-014 — Each add, hide, show and removal that changed anything MUST save one `price_list.updated` event in the same transaction (`garageId`, `jobTypeIds` the job, `brandIds` the brands of the removed brand rows and of the removed ticks, else empty), addressed as today to the garage's staff and its public page, so open Prețuri views and profiles re-read without a reload (the live hub already routes it); the garage's profile cache entries are dropped as the existing writes do. A proposal saves both `catalogue_job.proposed` (`jobTypeId`, `garageId`, the `admin` channel) and `price_list.updated`.

_From 1352-catalogue-job-visibility._

### 1352-FR-017 — The three new routes MUST be described in the API's OpenAPI document with their DTOs in the contracts library and the generated client regenerated (Principle V), and listed in `infra/observability/inventory.json` under the API's request duration and error rate (`scripts/observability-inventory.ts --write`), as 357-FR-011; the notice adds one worker queue, `catalogue-job-pending`, in the shape of the existing admin fan-outs, listed in the inventory with its metrics, panel and alert.

_From 1352-catalogue-job-visibility._

### 1352-FR-018 — The tests MUST cover, before the code (Principle II): in Jest (API, real PostgreSQL and Valkey) — add with both ends and with a start only, the row's place at the end, `duplicate` on a listed job, `unknown_job` on an unknown id and `not_approved` on a pending one, the range check's 422 and the wide-range warning, no tick written; hide, show, the same value again writing nothing, a body mixing `visible` and a range field refused; removal deleting the default row, the brand rows and the ticks while an open request and its quote stay, 404 for a brand row or another garage's row; a proposal creating the pending catalogue row and the hidden price row, a repeat proposal refused, an approved job's name refused, a rejected name proposed again, two garages proposing one name; 403 for the receptionist and the mechanic and 404 for another owner on every write; the audit entries and the events of each write in the same transaction (none when the transaction fails); every admin notified once per proposal and a muted admin not; `visible` on the read; the migration's orphan removal and the constraint; in Playwright (the serial price-list project) — as the owner, remove air-con regas, add it back from the picker with 45 min and 280 – 360 lei and see it on the profile; hide the timing chain kit and see it gone from the profile, show it again; propose a name unique to the run and see it waiting, then remove it.

_From 1352-catalogue-job-visibility._

## Retired

- `354-FR-001` — superseded by `109-FR-021` (2026-10-08)

- `357-FR-007` — superseded by `386-FR-011` (2026-10-17)

- `039-FR-002` — superseded by `228-FR-012` (2026-10-20)
- `039-FR-004` — superseded by `228-FR-015` (2026-10-20)

- `173-FR-007` — superseded by `1352-FR-008` (2026-10-20)

---
capability: catalogue
updated: 2026-10-30
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
  - 1357-rar-covered-jobs
  - 007-brand-headline
  - 414-approve-catalogue-job
  - 245-seed-catalogues
  - 105-brand-list-admin
  - 309-open-now-directions
  - 1368-admin-brand-list
  - 150-add-booking
  - 1241-3d-catalogue-seed
  - 1315-optimistic-toggles
  - 1411-1315-qa-fixes
---

# Capability: Catalogue

The brand catalogue MotorFix keeps for the whole product: every car brand sold in Romania, loaded from a versioned data file, with its name, slug, popularity and active flag, and the public brand search that every picker uses.

## Requirements

### 039-FR-001 — The system MUST keep one brand list for the whole product, maintained by MotorFix: garages cannot add, rename or remove a brand, and every part of the product that names a brand uses the same brand ids.

_From 039-brand-catalogue._

### 228-FR-012 — Every night, the searches of the 30 closed Europe/Bucharest days ending yesterday (the demand job's per-day per-brand counts) MUST be summed per active brand and written as a full popularity rank 1..N over every active brand: searched brands by their count, then the rest by their current rank (on the first night, the seed rank), then by name.

_From 228-how-it-works-list-garage._

### 007-FR-004 — Every brand in the catalogue's list MUST carry a Romanian "your" form, held on the brand row and loaded with the catalogue: the mock's eight ("BMW‑ul tău", "VW‑ul tău", "Mercedesul tău", "Fordul tău", "Dacia ta", "Toyota ta", "Škoda ta", "Tesla ta") and the rest by the rule in Assumptions; the end-to-end seed sets it for every brand row.

_From 007-brand-headline._

### 105-FR-012 — The loader MUST skip every stored brand whose `updated_by` is set: it neither applies the file's record for that key (name, slug, state, "your" form, rank) nor retires it for being absent from the file; it MUST still create every file brand whose key is missing, a file record whose key, name or slug is held by an admin-owned brand is skipped and logged (one warning line naming the key), never a load failure; a collision between two loader-owned brands still fails the load (039-FR-007 unchanged).

_From 105-brand-list-admin._

### 039-FR-007 — A file holding two brands with the same stable key, name or slug, or a brand whose name or slug is already held by another stored brand (a retired one included), MUST fail the whole load, naming the duplicate, and the stored list MUST be exactly what it was before.

_From 039-brand-catalogue._

### 039-FR-008 — Every brand the loader creates, changes, retires or brings back MUST be recorded in the audit history with the actor `system`.

_From 039-brand-catalogue._

### 105-FR-014 — A brand search that read PostgreSQL before a brand change committed MUST NOT be able to write that older list into the cache after the change dropped it: either the cache key carries a version the change bumps, or the cache write is refused when the entry was dropped since the read (for example `SET ... NX` after the drop, or a version check); an integration test with that interleaving (read PostgreSQL, change and drop, then the stale write) shows the new list on the next search. The rule holds for the loader's drop and for the admin writes' drop alike. (#569)

_From 105-brand-list-admin._

### 039-FR-010 — Brand search MUST match the typed text against brand names ignoring accents and case ("sko", "Skoda" and "ŠKODA" all find "Škoda"), and return only active brands.

_From 039-brand-catalogue._

### 039-FR-011 — An empty search MUST return the active brands by popularity, most popular first, then by name.

_From 039-brand-catalogue._

### 039-FR-012 — Brand search MUST be open to visitors without a session, return `{ items, nextCursor, total }` with at most 20 brands a page and an opaque cursor for the next page, and be served from a cache kept for one hour.

_From 039-brand-catalogue._

### 309-FR-008 — A new migration MUST add to the holiday calendar the legal holidays of 2028, 2029 and 2030 under the Labour Code (art. 139): 1 and 2 January, 6 and 7 January, 24 January, Orthodox Good Friday (Easter − 2), Orthodox Easter Sunday and Monday (Easter + 1), 1 May, 1 June, Orthodox Whit Sunday and Monday (Easter + 49 and + 50), 15 August, 30 November, 1 December, 25 and 26 December, with Orthodox Easter on 2028-04-16, 2029-04-08 and 2030-04-28; one row per day with its Romanian and English names, the names of two holidays on one day joined with " / " as the 2026 row of 1 June does, and the insert skipping a day already held (modifies 112-FR-008: the calendar now runs to 2030, 2026 and 2027 unchanged).

_From 309-open-now-directions._

### 414-FR-001 — The catalogue job row MUST gain three decision columns, added by a migration and empty for every existing row: `decided_by` (the deciding admin's account; set to null when that account is deleted, the row kept), `decided_at` (a time) and `rejection_reason` (text, at most 500 characters, set only on a rejection). The six shipped jobs stay `approved` with all three empty.

_From 414-approve-catalogue-job._

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

### 172-FR-006 — The owner's read MUST carry the garage's hourly labour range, `labour: { fromBani, toBani }`, present only when both ends are set (the shape the public profile's `labour` already has), so the view shows under the list the note "Manoperă: {range} / oră. Minimul e mașina mică și simplă, maximul e cea mare sau dificilă." / "Labour: {range} / hour. The low end is the small, easy car; the high end is the big or awkward one.", `{range}` the whole-lei range ("180–240 lei"); the note is absent when `labour` is. Nothing else in the read changes; the DTO is in the contracts library, the OpenAPI file and the generated client are regenerated (Principle V). Extends the read of 386-FR-011, which stays.

_From 172-price-list-states._

### 173-FR-004 — The API MUST serve `PATCH /api/v1/garages/{garageId}/prices/{priceId}` for a job's default row: body `{ fromBani, toBani, durationMinutes, expectedUpdatedAt }` from a DTO in the contracts library, `fromBani` required, `toBani` and `durationMinutes` each required and either an integer or `null` (clear), an omitted one refused with 422 `required`, `expectedUpdatedAt` the row's `updatedAt` as the read gave it; the shared range check decides, a failure answering 422 with the field errors (the shape of the brand range write, 386), a bare 400 `validation_failed` only for a malformed body or id. It writes `from_bani`, `to_bani`, `duration_minutes`, `updated_at` (now) and `updated_by` (the actor) and answers the saved row (`priceId`, `jobTypeId`, `fromBani`, `toBani`, `durationMinutes`, `updatedAt`, `warnings`). A body with no change writes nothing and answers 200 with the stored row. The OpenAPI document and the generated client are regenerated.

_From 173-price-range-in-place._

### 173-FR-005 — The API MUST serve `PATCH /api/v1/garages/{garageId}/labour` with body `{ fromBani, toBani }`, both required integers (a missing one refused with `required` before the range check, as 109-FR-015), the shared range check deciding (422 on a field error); clearing the labour range is out of scope, writing `labour_from_bani` and `labour_to_bani` on the garage and answering `{ fromBani, toBani, warnings }`. The garage's verification status, approval and every other column stay as they are.

_From 173-price-range-in-place._

### 173-FR-006 — Both writes MUST be the owner's alone (`assertGarageOwner`): the garage's receptionist or mechanic answers 403, another garage's owner 404, as the price list's reads and the brand write do (357-FR-009). A `priceId` that is not one of this garage's default rows (another garage's row, a brand row, an unknown id) answers 404 with nothing about it.

_From 173-price-range-in-place._

### 414-FR-010 — The owner's price-list item (`GET /api/v1/garages/{garageId}/prices`) MUST carry `rejectionReason` beside `reason`, present only when `reason` is `rejected` (1352-FR-008's item gains the field). Prețuri MUST show the rejected row's state as "respins · {reason}" / "rejected · {reason}", the reason in full, wrapping on a 320 px phone with no sideways scroll; the stale comment on the view's `catalogue_job.decided` subscription is removed, the subscription itself stays as it is.

_From 414-approve-catalogue-job._

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

### 245-FR-002 — Every brand in the file MUST carry a starting popularity: the mock's twelve keep ranks 1-12 in the mock's order; every other brand carries a rank from 13 upward in descending order of its registered cars in the source edition, ties broken by name, no rank shared. The rank is a starting value only: the loader applies it on insert, and on reload to a stored brand whose rank is null; it never overwrites a number, which the nightly ranking owns (228-FR-012). A null rank filled on reload is one audit entry for that brand, `popularity` from null to the file's rank, like any other loader change.

_From 245-seed-catalogues._

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

### 1315-FR-006 — In `PricesView.toggle`, the row MUST show its new state before the call is sent: on hide, `public: false` with reason `hidden_by_garage` ("ascuns de tine", amber lamp); on show, `public: true` ("pe profil", green lamp); the row's buttons stay disabled while the save is in flight (`busy`, as today) and the list re-reads on the answer as today, so the server's reason wins (modifies 1352-FR-004's "leaves its state as it was" during the save).

_From 1315-optimistic-toggles._

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

### 1357-FR-001 — Each shipped catalogue job MUST carry the kind of work it falls under, as seed data the loader reconciles by key on boot like the job's names (every record carries its kind explicitly, `none` as null; a stored job whose kind differs from the list's, null included, gets the list's; a job missing from the list keeps what it has). The mapping, drafted from the five seeded RAR codes (OD-33, row #242) and signed off by the owner under the 2026-10-11 rule: `oil-service` → `mechanics`, `timing-chain` → `mechanics`, `front-brakes` → `brakes`, `suspension-alignment` → `suspension`, `ac-regas` → `air_con`, `diagnosis` → none. Every mapped code MUST be one the RAR catalogue holds, checked by a test (no foreign key and no boot-time check), so no job is ever hidden by a code no admin can tick.

_From 1357-rar-covered-jobs._

### 1357-FR-002 — The owner's Prețuri row of a job whose reason is `not_authorised` MUST read "ascuns · nu e în autorizația RAR" / "hidden · not in your RAR authorisation" with an amber lamp and amber text, as every non-public row reads today (prices-view.css:129-134, garage i18n `prices.state.not_authorised`); the story changes no text, colour or layout of the view and adds the test that pins it.

_From 1357-rar-covered-jobs._

### 1357-FR-005 — The public profile and the owner's price-list read MUST keep judging each job by the garage's stored list alone (`garage.rar_activities`): a job with no kind, or a garage with an empty list, is covered; a job whose kind is not in a non-empty list is hidden with reason `not_authorised`, third in the reason order after `rejected` and `awaiting_approval` (357-FR-001, 357-FR-002). While a change of kinds of work waits for an admin (#127), nothing else is consulted, since nothing else is stored.

_From 1357-rar-covered-jobs._

### 1357-FR-006 — The story MUST add no endpoint, service, queue, outside call, product action, screen or text, and no metric, log, trace, panel or alert beyond those shipped; the observability section of the PR says so. The one source change is the mapping of FR-001 and the loader's reconciliation of it.

_From 1357-rar-covered-jobs._

### 1357-FR-007 — Tests MUST exist before the code (Principle II), tagged with this feature's ids. In Jest: the loader writes each job's kind on create and reconciles a stored job's differing kind on update (null to a code, a code to another, a code to null for a job the list maps to none), records the change in the audit as it does for a name, and leaves an unchanged job untouched (job-type-loader integration spec); every mapped code is in `rar_activity` after the migrations and the load; the owner's read gives `not_authorised` to a listed, both-ends-set `ac-regas` of a garage whose list lacks `air_con`, and the public profile omits it, while a garage with an empty list and a job with no kind are both covered (price-list API integration spec); recording the activities with `air_con` makes it public on the next read and saves `price_list.updated` in the same transaction, and an `ok` re-check without it hides it and saves the event (verification-checks and recheck integration specs); Prețuri renders the `not_authorised` label with an amber lamp, and re-reads when a `price_list.*` event arrives, the row turning to "pe profil" once the job is covered (prices-view spec), as does the open public profile (garage-profile spec, tagged 1353-FR-003 where it already exists); the verification file renders the activities row ok, and as a warning naming the uncovered job from its evidence (verification-file spec). In Playwright, one flow on an approved garage of the flow's own whose recorded activities lack `brakes` (the admin's recording is pinned by the verification-checks spec and the verification-file flow, and recording on the seeded Atelier Dinamo would move it under every flow beside this one): signed in as its owner, Prețuri shows "Plăcuțe și discuri de frână față" as "ascuns · nu e în autorizația RAR" and the public profile does not list it.

_From 1357-rar-covered-jobs._

### 414-FR-002 — The API MUST serve `GET /api/v1/admin/catalogue-jobs` to admins alone, with the other admin routes' refusals (160-FR, 298-FR-002: every other signed-in role 404 `not_found`, no session 401 `sign_in_required`, a suspended admin 403 `account_suspended`), answering `{ items, rarActivities }`: `rarActivities` every row of the RAR activity list `{ code, nameRo, nameEn }` by Romanian name (the approve dialog's choices); `items` every `pending` catalogue job, oldest proposal first (`created_at`, then id), each `{ id, name, garage, fromBani, toBani, durationMinutes, proposedAt }`: `name` the Romanian text as proposed, `garage` `{ id, name, slug }` of the proposing garage or absent when it no longer exists, `fromBani`, `toBani` and `durationMinutes` from the proposing garage's default price row of the job (each absent when unset or when the row is gone), `proposedAt` the row's creation time. No paging: the queue is read whole (ST-174 caps each garage at 50 jobs; no number in the repo says the queue grows past one page).

_From 414-approve-catalogue-job._

### 414-FR-003 — The API MUST serve `POST /api/v1/admin/catalogue-jobs/{id}/approve` with a body `{ nameRo, nameEn, carSystem, rarActivity }` from a DTO in the contracts library: `nameRo` and `nameEn` 3 to 80 visible characters after trimming, format characters not counted, and no control character (else 400 `validation_failed`), `carSystem` one of the `CAR_SYSTEMS` keys the contracts library defines (`engine`, `transmission`, `brakes`, `suspension_steering`, `electrical`, `air_con`, `body`, `tyres_wheels`, `general`; else 400), `rarActivity` optional, a code the RAR activity list holds (else 422 `unknown_activity`), absent meaning no specific activity is needed (`null` is refused with 400 `validation_failed`). Approvals take one name lock before the name check, so two approvals of the same folded name at once leave one approved and answer the other 422 `exists`. A `nameRo` or `nameEn` equal, accents and case ignored, to either name of an approved job (the proposal's own `approvedNames` rule) answers 422 `exists` on that field with that job's id and Romanian name. The job's `key` never changes. In one transaction it MUST set the job `approved` with the names, the system, the activity, `decided_by` the admin and `decided_at` now; write the audit entry (FR-007); record `catalogue_job.decided` (FR-008); and, when the proposing garage still holds the job's default row, record `price_list.updated` for that garage naming the job (ST-174's shape), so the owner's Prețuri and the public profile re-read. It answers the decided job `{ id, status, nameRo, nameEn, carSystem, rarActivity, decidedAt }`.

_From 414-approve-catalogue-job._

### 414-FR-004 — The API MUST serve `POST /api/v1/admin/catalogue-jobs/{id}/reject` with a body `{ reason }` (10 to 500 visible characters after trimming, format characters not counted, no control character but line breaks and tabs; else 400 `validation_failed`). In one transaction it MUST set the job `rejected` with `rejection_reason`, `decided_by` and `decided_at`; write the audit entry (FR-007); and record `catalogue_job.decided` (FR-008). No `price_list.updated` is written (nothing became public). It answers the decided job as FR-003 does, with `rejectionReason`.

_From 414-approve-catalogue-job._

### 414-FR-005 — A decision on a job that is not `pending` MUST be refused with 409 `already_decided` and the message "Already approved by {first name}" / "Already rejected by {first name}" (the platform-rule requests' shape), or "Already decided" when the deciding account is gone, the dialog's "Deja decis de {name}." being built from that first name (FR-012), without a second write, event, audit entry or notification; the refusal MUST hold when two decisions arrive at once (the status check and the write are one atomic step, as the verification file's decision is). An unknown id answers 404 `not_found`, a malformed one 400.

_From 414-approve-catalogue-job._

### 414-FR-007 — Each decision MUST record one audit entry through the shared writer, in the same transaction, on the job (`subjectType` `job_type`, `subjectId` the job, the proposal's entry's sibling): `action` `update`, the admin as actor (`actorRole` `admin`), `oldValue` `{ status: 'pending' }` and `newValue` `{ status: 'approved', name_ro, name_en, car_system, rar_activity }` or `{ status: 'rejected', rejection_reason }`; the audit history lists it as any `job_type` entry, no new rendering is owed.

_From 414-approve-catalogue-job._

### 414-FR-008 — Each decision MUST record `catalogue_job.decided` in the same transaction, payload `{ jobTypeId, garageId, decision }` (`decision` `approved` or `rejected`; `garageId` absent when the proposing garage is gone), subject the job, with an audience that reaches every admin's live connection (the queue, as `catalogue_job.proposed` does) and the proposing garage's channel (the owner's Prețuri, which the hub already routes to `garage.prices` staff). No new event kind is added.

_From 414-approve-catalogue-job._

### 414-FR-013 — The three routes MUST be described in the API's OpenAPI document with their DTOs in the contracts library and the generated client regenerated (Principle V); they are not public routes. Observability ships with the change: one entry in `infra/observability/inventory.json` for the three routes with the API's request count, duration and error metrics by route and status, the existing API dashboard panel and error-rate alert, and a structured log line per decision (job id, decision, admin id; never the reason's text); no new service, queue or outside call, so nothing else is owed.

_From 414-approve-catalogue-job._

### 414-FR-014 — Outside production, the seed MUST add once (a second run changes nothing) one pending proposal by the seeded Atelier Dinamo, "Recondiționare injectoare" with 180 – 420 lei and 90 min, so the queue has a row in development and in the PR QA run; the end-to-end flows never decide it (each proposes its own name).

_From 414-approve-catalogue-job._

### 414-FR-015 — Tests MUST exist before the code (Principle II), tagged with this feature's ids. In Jest, on a real database: the three routes answer 404 to an owner, a receptionist, a mechanic and a driver, 401 with no session, 403 to a suspended admin; the queue lists only pending jobs, oldest first, with the garage, the default row's range and duration, a gone garage as absent and a gone row's figures absent; the queue read carries the RAR activity list; approve refuses a name under 3 or over 80 characters, a missing or unknown system, an unknown RAR activity and either name equal to an approved job's (`exists`), and writes status, names, system, activity, `decided_by`, `decided_at`, the audit entry, `catalogue_job.decided` and `price_list.updated` in one transaction (none when it fails), and no brand tick; reject refuses a reason under 10 or over 500 characters and writes status, reason, `decided_by`, `decided_at`, the audit entry and the event; a second decision answers 409 `already_decided` and writes nothing, two at once leave one decision; after approval the job is offered by the picker's search to another garage, is public on the proposer's profile with its range and `rejectionReason` is absent, after rejection the owner's item carries `reason` `rejected` and the reason; a suspended proposer's job can be decided; CATALOGUE_JOB_DECIDED is queued once for the owner with the right variant and wording, not for the receptionist, not when the garage is gone, and renders in both languages from the template's example (the templates' shared spec); the price-list item DTO and the admin DTOs validate as above. In Jest for the web: the view renders the rows, the empty state, the skeleton and the error line, re-reads on the two events, and each dialog enables its button by the rules above and shows the `exists` and `already_decided` messages. In Playwright (the serial price-list project): signed in as a garage owner, propose a name unique to the run; as an admin, open "Lucrări propuse", find it and approve it with both names and a system; back as the owner, the row turns "pe profil" without a reload; as a second garage's owner, the picker offers the job; the admin rejects a second unique proposal with a reason and the owner's row reads "respins · {reason}".

_From 414-approve-catalogue-job._

### 245-FR-001 — The brand file MUST list every car brand sold in Romania: every car brand with new registrations in Romania in the last five full years (2021-2025, APIA/DRPCIV figures), every car brand with an official importer in Romania, and every brand no longer sold new that is still common on Romania's roads (at least Chevrolet, Daewoo, Lada, Saab, Rover, Infiniti, ARO, Chrysler and Dodge); and at least Škoda, Mercedes-Benz, Citroën, Alfa Romeo, Land Rover and Lada by name. Each brand appears once, with its official spelling, a key equal to its slug (the slug derived from the name as the file does today), no model, and the 15 brands shipped today keep their keys and names. The file's existing checks (no duplicate key, name or slug; a rank is a whole number from 1) MUST pass over the full file, and the file MUST record its sources and their editions beside the brand list in the feature folder. A brand not sold new and without an official importer is in the file when it has at least 1,000 registered passenger cars in the source edition, the register's spellings of one brand merged. A candidate the build team cannot confirm as sold new through an official importer and that is below the floor is left out of the file and listed in `brand-sources.md` as an open candidate for the owner (FR-009).

_From 245-seed-catalogues._

### 245-FR-003 — Every brand in the file MUST carry a Romanian "your" form: the mock's eight as they are (007-FR-004); every other by the rule — a name ending in "a" takes "<Name> ta"; an acronym, or a name ending in another vowel or in a silent letter, takes "<Name>‑ul tău" with the non-breaking hyphen U+2011 (007-FR-005), never U+002D; any other name takes "<Name>ul tău". No form is empty.

_From 245-seed-catalogues._

### 245-FR-005 — Loading the full brand file and the job file into an empty database MUST create every row of both files, active, with the file's name, slug, rank and "your" form; loading both again MUST change no row and write no audit entry; and loading the full brand file over a database that already holds today's 15 brands MUST insert the new brands, give a stored brand whose rank is null its file rank, and leave every stored number rank as it was. These MUST be proved by tests on a real database over the real files, not over fixtures.

_From 245-seed-catalogues._

### 245-FR-006 — Brand search over the loaded file MUST return Škoda as the first result for "skoda", Citroën for "citroen" and Lada for "Lada" (SC-004), and an empty query MUST return the mock's twelve first, in the mock's order; proved by tests over the real file on a real database.

_From 245-seed-catalogues._

### 245-FR-007 — The end-to-end suite MUST NOT answer a brand search with its own rows: the step-2 test adds Lada from the loaded catalogue, and the brand-search test's abort of the brand route (the "list did not load" state) stays. Every end-to-end expectation that depends on catalogue content MUST still hold against the full file; where a new brand would match a query an existing test types, the test's query changes, never the brand.

_From 245-seed-catalogues._

### 105-FR-001 — The system MUST serve `GET /api/v1/admin/brands` to admins alone (capability `admin.catalogue`), with the other admin routes' refusals: every other signed-in role 404 `not_found`, no session 401 `sign_in_required`, a suspended admin 403 `account_suspended`; the same refusals apply to every route under `admin/brands`.

_From 105-brand-list-admin._

### 105-FR-002 — The list MUST return every brand, active and retired, each with: id, name, slug, state (`active` | `retired`), `garages` (the count of garage stances "works on" for it), `cars` (the count of drivers' cars of that brand; both counts are every stored row, whatever the state of the garage, car or account), `updatedAt` (the value the admin sends back as "seen" on an edit) and `updatedBy` (the account id of the admin who last changed it, null when only the loader did), ordered by name (locale-insensitive, folded).

_From 105-brand-list-admin._

### 105-FR-003 — The list MUST accept an optional `q` and keep only the brands whose folded name contains the folded `q` (the same fold as public search, 039-FR-010); an empty `q` returns everything; a `q` longer than 40 characters is 400 `validation_failed` (the name's upper bound). The list is not paged: the whole catalogue is a few hundred rows and the admin filters by search.

_From 105-brand-list-admin._

### 105-FR-004 — `POST /api/v1/admin/brands` with `{ name }` MUST create an active brand: name trimmed, 2 to 40 visible characters, no control characters; slug `slugOf(name)`; key equal to the slug (the stable key the loader matches on; the file never holds this key); popularity null; `ro_possessive` null; `updated_by` the calling admin. It answers 201 with the brand row as FR-002 describes it.

_From 105-brand-list-admin._

### 105-FR-005 — A create or rename whose slug is held by another brand, active or retired, MUST answer 409 `brand_exists` with the message `Marca există deja: <holder's name>`; a name whose slug is empty, too short or too long MUST answer 400 `validation_failed`. The check is on the slug, so accents and case never make a second brand; the unique constraints on `slug` and `name` back it under concurrency.

_From 105-brand-list-admin._

### 105-FR-006 — `PATCH /api/v1/admin/brands/{id}` with `{ name?, active?, seenUpdatedAt }` MUST rename and/or retire or bring back the brand in one transaction, keeping its id; the slug follows the new name; cars, garage stances, prices, requests, reviews and the audit history keep pointing to it. A body with neither `name` nor `active` is 400 `validation_failed`. The checks run in this order: 400 `validation_failed` for a request the route's pipes refuse before any lookup (an `{id}` that is not a uuid, a name outside 2–40 visible characters, a `seenUpdatedAt` that is not an ISO time, an unknown field), 404 `not_found` for an unknown id, 400 `validation_failed` for a body with neither field or a name whose slug falls outside 2–40, 409 `stale_value` when `seenUpdatedAt` differs from the row's `updated_at` (the answer carries the current row), 409 `brand_exists`, then the no-op: a change that alters no field writes nothing (no row update, no audit entry) and answers 200 with the row as it is.

_From 105-brand-list-admin._

### 105-FR-007 — There MUST be no route that deletes a brand; retiring is the only way out of the pickers.

_From 105-brand-list-admin._

### 105-FR-008 — A retired brand MUST be left out of public brand search and every picker (039-FR-006 applies to admin retirement as to the loader's), and MUST stay on the cars, stances, prices and history that name it, under its name.

_From 105-brand-list-admin._

### 105-FR-009 — Every write MUST set `updated_by` to the calling admin and drop the cached active list in the same use case (039-FR-009), after the transaction commits, so open pickers get the new list on their next search.

_From 105-brand-list-admin._

### 105-FR-010 — Every create, rename, retirement and bring-back MUST write its audit entries through the shared writer inside the same transaction (390-FR-001, 164-FR-001): subject type `brand`, subject id the brand, actor the admin (role `admin`), a `create` entry with the new values for an add and one `update` entry per changed field (`name`, `slug`, `active`) with old and new values for the rest, so the history shows admin, time, brand, old and new values. Popularity is never written here.

_From 105-brand-list-admin._

### 105-FR-011 — The `brand` table MUST gain a nullable `updated_by` column (the id of the admin who last changed it; null for a loader-only brand; a plain uuid with no foreign key, never nulled when that account is deleted, so admin ownership survives the account), added by a migration and empty for every existing row.

_From 105-brand-list-admin._

### 105-FR-013 — The loader's transaction timeout MUST be read from `BRAND_LOAD_TIMEOUT_MS` through the contracts library's env readers (as `LISTING_SUBMIT_TX_TIMEOUT_MS` is), default 60000 ms, a positive whole number or the API refuses to start with a message naming the variable; a unit test covers the default and an override. (#570)

_From 105-brand-list-admin._

### 105-FR-015 — `brands.ts`, `brands.controller.ts` and `brands.service.ts` MUST move to `libs/domain/src/catalogue/brands/` with their tests, named after the folder, and the new admin controller and service MUST live there too; their three entries leave `scripts/structure-baseline.json` and the structure check passes in CI. (#659)

_From 105-brand-list-admin._

### 105-FR-017 — The DTOs (`AdminBrandDto`, `AdminBrandListDto`, `CreateBrandDto`, `UpdateBrandDto`) MUST come from the contracts library, be validated at the edge, be described in the OpenAPI document and be in the generated Angular client (`npx nx run data-access:generate`).

_From 105-brand-list-admin._

### 105-FR-018 — The new routes MUST be listed in the observability inventory (`infra/observability/inventory.json`) with their panel and alert, as every new endpoint.

_From 105-brand-list-admin._

### 105-FR-019 — `admin/brands` MUST NOT be `@Public()` and MUST join the admin routes' guard tests (the audit guard test of 164-FR-004 and the admin routes 404 test) by being present in the OpenAPI document.

_From 105-brand-list-admin._

### 105-FR-020 — The seed used by the end-to-end suite and the QA run MUST hold at least one retired brand and one brand with cars and "works on" stances, so the list's states and counts are visible without writing.

_From 105-brand-list-admin._

### 105-FR-021 — Tests MUST cover, before the code (Principle II): in Jest (API, real PostgreSQL and Valkey) — the list's rows, counts and search; 404/401/403 per role; add with slug and cache drop; duplicate on accent and case variants and on a retired holder; rename keeps the id and references; retire hides from public search and keeps references; bring back; no-op writes nothing; 409 `stale_value`; one audit entry per changed field with old and new values (a rename writes two: `name` and `slug`); the loader skips an admin-changed brand and still adds a missing one; the stale cache write interleaving (FR-014); in unit tests — `BRAND_LOAD_TIMEOUT_MS` default and override, DTO validation bounds.

_From 105-brand-list-admin._

### 1368-FR-002 — The section MUST have a search box labelled "Caută o marcă" / "Search a brand" that filters the loaded rows as the admin types, keeping the rows whose folded name contains the folded text (the product's shared fold: accents, case and format characters ignored, as the public brand search and the API's `q`), without a new read; an empty box shows every row, and a text matching nothing, or a read that returns no brand at all, shows one line "Nicio marcă nu se potrivește" / "No brand matches".

_From 1368-admin-brand-list._

### 1368-FR-003 — The section MUST have a button "Adaugă o marcă" / "Add a brand" that opens the dashboards' shared dialog, titled the same, with one field "Nume" / "Name" bounded to 2–40 visible characters (trimmed; checked by the contracts' `visibleTextProblem` rule the API uses; the range shown), "Salvează" / "Save" and "Renunță" / "Cancel". A name outside the range is refused in the field with nothing sent. Saving sends the create operation; on success the dialog closes, the search box is cleared and the new row (active, 0 and 0) appears at its folded-name position in the list.

_From 1368-admin-brand-list._

### 1368-FR-004 — When the create answers 409 `brand_exists`, the dialog MUST stay open with the typed name and show the API's message ("Marca există deja: <holder's name>") under the field; any other failure shows "Nu s-a putut salva. Încearcă din nou." / "Could not save. Try again." and leaves the dialog open.

_From 1368-admin-brand-list._

### 1368-FR-005 — Each row MUST offer "Redenumește" / "Rename": the name becomes a field holding the current name (the same bounds as FR-003) with "Salvează" / "Save" and "Renunță" / "Cancel"; saving sends the update operation with the new name and the row's `updatedAt` as `seenUpdatedAt`; the row then shows the answer's values at its folded-name position and the field closes. While the field is open the row's state action (FR-006) is hidden. 409 `brand_exists` keeps the field open with the API's message under it.

_From 1368-admin-brand-list._

### 1368-FR-006 — Each active row MUST offer "Retrage" / "Retire" and each retired row "Readuce" / "Bring back"; pressing it sends the update operation with `active` false or true and the row's `updatedAt` as `seenUpdatedAt`, and the row shows the answer's state and the other action.

_From 1368-admin-brand-list._

### 1368-FR-007 — When a rename, retirement or bring-back answers 409 `stale_value`, the row MUST re-read itself from the brand the answer carries (name, state, counts, `updatedAt`), close any open rename field, and show a short notice under the row, "Alt administrator a modificat marca; rândul a fost actualizat." / "Another admin changed this brand; the row was refreshed.", until the admin's next action on that row. Any other failure of a row action shows "Nu s-a putut salva. Încearcă din nou." / "Could not save. Try again." under the row and leaves the row as it was, an open rename field staying open with its typed name.

_From 1368-admin-brand-list._

### 1368-FR-008 — While a row's save is in flight the row MUST ignore a second action on the same row; while the first read is on its way the section MUST show its heading, search box and button with three skeleton rows, `aria-busy="true"` and no row action; when the read fails the section MUST show "Lista de mărci nu a putut fi citită." / "The brand list could not be read." with a "Încearcă din nou" / "Try again" control, and the demand report above is unaffected either way.

_From 1368-admin-brand-list._

### 1368-FR-009 — Every text of the section MUST exist in Romanian and English (except the `brand_exists` message, which is shown verbatim as the API sends it) in the shared i18n files (a Romanian hyphenated word with U+2011, "Service‑uri"); at 320 px, 390 px, a tablet and a desktop, light and dark, Romanian and English, the section MUST fit without sideways scrolling, laying each row out as a stacked card below 768 px and as a table row from 768 px; every control MUST be operable by keyboard and carry an accessible name that includes its brand's name ("Redenumește Škoda"), the state and the counts MUST be readable as text, a notice or error under a row or field MUST be announced to assistive technology (a status or alert live region), focus MUST return to the control that opened a closed dialog or rename field, and the QA sweep's axe check MUST have no finding on the view.

_From 1368-admin-brand-list._

### 1368-FR-010 — Tests MUST come before the code (Principle II): component specs for FR-001–FR-008 (rows, states and counts from a seeded list; the fold filter on accent and case; the empty-search line; add and the new row; `brand_exists` in the dialog and at a row; rename, retire and bring back with `seenUpdatedAt`; `stale_value` re-read and notice; the busy row; the read failure and retry), and one Playwright flow: the seeded admin adds a brand on screen; the garage form's brand step offers it unmarked; the garage results filtered by it show the red lamp of a brand with no stance; a visitor types it in Home's brand search and is offered it.

_From 1368-admin-brand-list._

### 150-FR-007 — JOB_TYPE MUST gain `needs_lift` (boolean, not null, default false), a catalogue default set by MotorFix: the migration sets it true for the shipped keys `oil-service`, `front-brakes`, `timing-chain` and `suspension-alignment` and leaves `diagnosis`, `ac-regas` and every garage-proposed job false; the job-type loader (`job-types.ts`) carries the flag so a reload keeps it. The confirm options read (`ConfirmOptionsDto`) MUST return `needsLift`, true when any of the quote's jobs has `needs_lift`. The flag advises the dialog only: the confirm accepts a lift or none whatever it says (FR-004).

_From 150-add-booking._

### 1241-FR-001 — The product MUST keep the car systems in a data file beside the licensed model list: exactly the eleven codes `engine`, `brakes`, `suspension`, `aircon`, `exhaust`, `gearbox`, `electrics`, `tyres`, `bodywork`, `electric_motor`, `battery`; each with its fuel types (petrol and diesel: the nine; electric: `electric_motor`, `battery`, `brakes`, `suspension`, `aircon`, `electrics`, `tyres`, `bodywork`; hybrid: the nine plus `battery` and `electric_motor`), its names Motor / Engine, Frâne / Brakes, Suspensie / Suspension, Climă / Air-con, Evacuare / Exhaust, Cutie de viteze / Gearbox, Electrică / Electrics, Anvelope / Tyres, Caroserie / Bodywork, Motor electric / Electric motor, Baterie / Battery, and a display position (the order listed).

_From 1241-3d-catalogue-seed._

### 1241-FR-002 — A Prisma migration MUST create CAR_SYSTEM and CAR_MODEL_3D and add `brand.body_style`. At API boot a loader MUST write CAR_SYSTEM (code, fuel_types, name_ro, name_en, position) from that file and CAR_MODEL_3D (key, brand, model, file_key, popularity = the model's rank within its brand, 1 the most popular, fuel, body_style, licence_ref null) from the licensed model list, as the brand loader writes BRAND: in one transaction under an advisory lock, writing and auditing only the fields that differ (a second run changes no row and writes no audit entry), deleting (audited) a model row whose key left the list (nothing references it), logging one line with the count changed.

_From 1241-3d-catalogue-seed._

### 1241-FR-003 — Every BRAND row MUST carry a `body_style` (saloon, hatchback, suv, crossover, estate, fastback; a NOT NULL column defaulting to `saloon`), written by the brand loader from the brand list's `bodyStyle` on the brands the file owns; a brand an admin changed keeps its stored style, as it keeps its other fields.

_From 1241-3d-catalogue-seed._

### 1241-FR-004 — Every CAR_MODEL_3D row MUST name a file key of the form `<model-key>.<hash>.glb`, where `<hash>` is the first 16 hex characters of the file's SHA-256, and the generic body shapes MUST have keys `generic-<style>.<hash>.glb`; a stored file is never overwritten, a new version has a new key.

_From 1241-3d-catalogue-seed._

### 1241-FR-005 — The decision MUST be recorded (PR body and the `catalogue` capability): the 3D files are held in the product's object storage under `models-3d/`, served with `Cache-Control: public, max-age=31536000, immutable`, a stored key never overwritten; no `.glb` file is committed to the repository (public; the files are licensed). Uploading and serving are ST-1242/ST-1243's.

_From 1241-3d-catalogue-seed._

### 1241-FR-006 — Until the real files arrive (ST-1242 generic shapes, ST-1243 licensed models), the catalogue MUST point at placeholder files the product generates itself (a `body` node plus every `sys_<code>` and `pin_<code>` node the model's fuel needs), generated byte-for-byte deterministically at check time into a temporary directory and never committed, whose content-hashed keys are in the catalogue data (the licensed list and a map of the six generic styles to their keys), so every row points at a file the check accepts.

_From 1241-3d-catalogue-seed._

### 1241-FR-007 — An asset check (a script under `scripts/`, run in CI's Checks job) MUST, given a directory of files, fail naming the file and the part when a file misses a `sys_<code>` or `pin_<code>` its fuel needs, holds a `sys_` or `pin_` node its fuel forbids, lacks `body`, is not a readable GLB, is larger than 2 MiB (2,097,152 bytes; equal passes), or its name's hash does not match its content; fail naming the row when a catalogue row (each licensed model, each generic style) has no file; and fail naming the file when a file matches no row. It reads the catalogue from the data files, never the database. With no directory it checks the placeholder set.

_From 1241-3d-catalogue-seed._

### 1241-FR-008 — The check MUST take a file's fuel from the catalogue by its key; a `generic-<style>` file is held to the petrol/diesel nine.

_From 1241-3d-catalogue-seed._

### 1241-FR-009 — Unit tests MUST cover the check on a good file and on one file per fault (missing part, forbidden part, no body, not a GLB, over 2 MiB, hash mismatch, missing row, unknown file), and the loader's idempotence and every CAR_MODEL_3D row's file key on a real database over the real data files.

_From 1241-3d-catalogue-seed._

### 1315-FR-007 — A refused or failed flip MUST put the row back to the state it had before the press (its `public`, `reason` and `visible` as the read gave them) and show `garage.prices.notSaved` on the row, as 1352-FR-004 shows it today; a re-read in between (a live event) MUST NOT be undone by the rollback (the rollback restores the row only when the shown row is still the optimistic one).

_From 1315-optimistic-toggles._

### 1411-FR-005 — `libs/domain/src/seed.ts` MUST give Atelier Test (slug `atelier-test`, owner `service@example.test`, the QA sweep's `@garage`) three priced jobs: `diagnosis` public, `timing-chain` hidden by the owner (`visible = false`) and `suspension-alignment` with no top price (so it reads "ascuns · fără preț maxim"); each inserted only when absent, so a second run adds and changes no row and an owner's later edit is never put back (1372-FR-004 kept). `libs/domain/src/seed.integration.spec.ts` MUST assert the three rows and the second run; the end-to-end spec in `apps/web-e2e/src/garage-views.spec.ts` that asserted the empty list for Atelier Test MUST assert the seeded rows instead.

_From 1411-1315-qa-fixes._

### 1411-FR-006 — The "MODIFICĂ PREȚURILE" / "EDIT PRICES" button (the `.toggle` of `prices-view.html`) MUST stay on one line at 320 px in ro and en, light and dark (`white-space: nowrap` on `.toggle`; the head already wraps), proven in Playwright by the text's client rectangles lying on one line at 320 px.

_From 1411-1315-qa-fixes._

## Retired

- `354-FR-001` — superseded by `109-FR-021` (2026-10-08)
- `357-FR-007` — superseded by `386-FR-011` (2026-10-17)
- `039-FR-002` — superseded by `228-FR-012` (2026-10-20)
- `039-FR-004` — superseded by `228-FR-015` (2026-10-20)
- `173-FR-007` — superseded by `1352-FR-008` (2026-10-20)
- `039-FR-003` — superseded by `007-FR-004` (2026-10-22)
- `109-FR-021` — superseded by `414-FR-001` (2026-10-23)
- `1352-FR-008` — superseded by `414-FR-010` (2026-10-23)
- `405-FR-005` — superseded by `245-FR-002` (2026-10-23)
- `228-FR-015` — superseded by `245-FR-002` (2026-10-23)
- `039-FR-005` — superseded by `105-FR-012` (2026-10-24)
- `039-FR-006` — superseded by `105-FR-012` (2026-10-24)
- `039-FR-009` — superseded by `105-FR-014` (2026-10-24)
- `112-FR-008` — superseded by `309-FR-008` (2026-10-24)
- `1352-FR-004` — superseded by `1315-FR-006` (2026-10-30)

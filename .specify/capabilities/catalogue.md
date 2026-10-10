---
capability: catalogue
updated: 2026-10-10
features:
  - 039-brand-catalogue
  - 112-opening-hours
  - 354-job-catalogue-prices
  - 109-garage-details-prices
  - 230-brand-search
  - 357-public-price-jobs
---

# Capability: Catalogue

The brand catalogue MotorFix keeps for the whole product: every car brand sold in Romania, loaded from a versioned data file, with its name, slug, popularity and active flag, and the public brand search that every picker uses.

## Requirements

### 039-FR-001 — The system MUST keep one brand list for the whole product, maintained by MotorFix: garages cannot add, rename or remove a brand, and every part of the product that names a brand uses the same brand ids.

_From 039-brand-catalogue._

### 039-FR-002 — Each brand MUST carry a UUID id, a stable key from the data file, a name written one way, a slug unique across brands, a popularity rank and an active flag; a brand is active exactly when it is in the current data file.

_From 039-brand-catalogue._

### 039-FR-003 — The brand list MUST be loaded from a versioned data file kept in the repository by a loader that stores every brand of the file exactly once, and the repository MUST ship a development file holding at least the twelve brands of the mock (BMW, Mini, Mercedes-Benz, Audi, Volkswagen, Škoda, Dacia, Renault, Ford, Toyota, Hyundai, Tesla).

_From 039-brand-catalogue._

### 039-FR-004 — The loader MUST be idempotent: a second run with the same file changes no brand and writes no audit entry. A change is a brand created, retired or brought back, or a change to its name, slug or popularity.

_From 039-brand-catalogue._

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

### 357-FR-007 — The owner MUST be able to read every job of their garage's price list with its state through `GET /api/v1/garages/{garageId}/prices`, answering `{ items: [...] }`, one item per job in the price list's order (as FR-006), each with the job's id, its Romanian and English names, `public` (boolean), `reason` (one of the five codes, present only when not public), `durationMinutes` when set, `fromBani` and `toBani` when set, from the default range; an empty price list answers `items: []`; the answer carries no brand range, no labour range and nothing about other garages.

_From 357-public-price-jobs._

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

## Retired

- `354-FR-001` — superseded by `109-FR-021` (2026-10-08)

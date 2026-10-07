---
capability: catalogue
updated: 2026-10-07
features:
  - 039-brand-catalogue
  - 112-opening-hours
  - 354-job-catalogue-prices
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

### 354-FR-001 — The system MUST keep one job catalogue for the whole product, maintained by MotorFix, with one row per job holding an id, a stable key, a Romanian name, an English name, a status among `approved`, `pending` and `rejected`, an optional car system and an optional RAR activity code (both empty for the first six, filled by the stories that own them), created and updated times.

_From 354-job-catalogue-prices._

### 354-FR-002 — The product MUST ship the six jobs of the mock as approved catalogue data, keyed stably, and load them in every environment, production included, when the product starts or its data load runs; the load MUST mirror the brand load: the file wins on names, each created or changed row is audited once by `system`, rows outside the file are left alone; it MUST be idempotent (a second run with an unchanged file creates, renames and re-ids nothing and writes no audit entry) and atomic (a failed load leaves the catalogue as it was), and two loads at once MUST still leave exactly one row per key.

_From 354-job-catalogue-prices._

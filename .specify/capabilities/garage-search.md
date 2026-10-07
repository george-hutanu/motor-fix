---
capability: garage-search
updated: 2026-10-07
features:
  - 043-brand-first-garage-list
---

# Capability: Garage search

How a driver finds garages for a brand: the public list of approved garages in two groups (those that work on the brand first, then those that refuse it or have not marked it), the two counts over everything found, and the order and paging inside the groups.

## Requirements

### 043-FR-001 — The system MUST answer a request for the garages for one brand with every approved garage, in two groups: first the garages whose answer for the brand is `works_on`, then every other garage (`does_not_take` and `unstated` together); no garage of the first group ever comes after one of the second, on any page.

_From 043-brand-first-garage-list._

### 043-FR-002 — A suspended or never-approved garage MUST be in neither group and in neither count: only garages visible to the public (the one public scope) are read.

_From 043-brand-first-garage-list._

### 043-FR-003 — The request MUST be open to visitors without a session and listed with the public routes.

_From 043-brand-first-garage-list._

### 043-FR-004 — Each listed garage MUST carry its id, name, slug, and its answer for the brand, in a field named `stance`, one of `works_on`, `does_not_take` and `unstated`, so the screen can show the red lamp on every garage of the second group.

_From 043-brand-first-garage-list._

### 043-FR-005 — The answer MUST carry two counts worked out once over every garage found, not over the page: how many work on the brand (`counts.worksOn`) and how many do not take it (`counts.doesNotTake`, refusers and unmarked together), both whole numbers; with no approved garage both are zero and the list is empty, with no error.

_From 043-brand-first-garage-list._

### 043-FR-006 — The list MUST come 20 garages a page as `{ items, nextCursor, total, counts }`, with an opaque cursor for the next page that carries the brand, the group and the last garage's id, the search reading that garage's name back by id as the keyset, even when it has left the public list since (a name has no length limit, so the cursor stays under 200 characters), so the next page continues the same group where the previous one stopped and no garage is repeated or skipped between two consecutive pages of an unchanged list; `total` is the sum of the two counts; `nextCursor` is null on the last page, that is when no garage follows the page.

_From 043-brand-first-garage-list._

### 043-FR-007 — Inside each group the garages MUST come by name under the database's default collation, then by id, so two garages of the same name have one order and a page boundary between them repeats or skips neither.

_From 043-brand-first-garage-list._

### 043-FR-008 — A listed garage MUST carry only the fields FR-004 names: no rating, review count, brand note or refusal phrase is added to the garage or the answer by this story.

_From 043-brand-first-garage-list._

### 043-FR-009 — The brand MUST be named by its uuid; a uuid no brand row holds MUST answer "not found", while a retired (inactive) brand still answers; a missing brand, a value that is not a uuid, an unknown query field, or a cursor that is longer than 200 characters, does not decode, names another brand or names no group, MUST be refused as a bad request, in the API's one error shape with a stable code (`validation_failed`, `invalid_cursor`, `not_found`).

_From 043-brand-first-garage-list._

### 043-FR-010 — The search MUST read a garage's answer for a brand from the garage brand rows ST-39 created (one row per garage and brand, no row is `unstated`), never from a second copy.

_From 043-brand-first-garage-list._

### 043-FR-011 — The search MUST write nothing: no audit entry, no event, no search log (MF-10 owns the search log).

_From 043-brand-first-garage-list._

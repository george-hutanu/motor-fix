---
capability: garage-search
updated: 2026-10-10
features:
  - 043-brand-first-garage-list
  - 042-brand-verdict
  - 225-brand-picker
  - 229-location-or-address
  - 226-best-rated-brand-dial
  - 227-garage-cards-home
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

### 042-FR-012 — Each garage listed by the brand-first search MUST carry its id, name, slug, its `stance` for the brand (`works_on`, `does_not_take` or `unstated`) and its brand answer: the works-on list and the refusal list as lists of (id, name, slug) in catalogue order (popularity rank, then name), the note and the phrase (null when not set); a brand retired from the catalogue stays in the lists; a garage with nothing marked carries two empty lists. The item MUST carry the brand answer flat, in the same shape as the public garage read (`ListedGarageDto` extends `GarageBrandAnswerDto`, as `PublicGarageDto` does), and the stance and the answer MUST be read from one include of all the garage's brand rows, in the same request, never from a second copy.

_From 042-brand-verdict._

### 043-FR-005 — The answer MUST carry two counts worked out once over every garage found, not over the page: how many work on the brand (`counts.worksOn`) and how many do not take it (`counts.doesNotTake`, refusers and unmarked together), both whole numbers; with no approved garage both are zero and the list is empty, with no error.

_From 043-brand-first-garage-list._

### 043-FR-006 — The list MUST come 20 garages a page as `{ items, nextCursor, total, counts }`, with an opaque cursor for the next page that carries the brand, the group and the last garage's id, the search reading that garage's name back by id as the keyset, even when it has left the public list since (a name has no length limit, so the cursor stays under 200 characters), so the next page continues the same group where the previous one stopped and no garage is repeated or skipped between two consecutive pages of an unchanged list; `total` is the sum of the two counts; `nextCursor` is null on the last page, that is when no garage follows the page.

_From 043-brand-first-garage-list._

### 043-FR-007 — Inside each group the garages MUST come by name under the database's default collation, then by id, so two garages of the same name have one order and a page boundary between them repeats or skips neither.

_From 043-brand-first-garage-list._

### 042-FR-013 — A listed garage MUST carry only the fields FR-012 names: no rating, review count or other garage field is added to the item by this story. The search stays open to visitors, reads only approved garages, keeps its order, counts and paging, and writes nothing.

_From 042-brand-verdict._

### 043-FR-009 — The brand MUST be named by its uuid; a uuid no brand row holds MUST answer "not found", while a retired (inactive) brand still answers; a missing brand, a value that is not a uuid, an unknown query field, or a cursor that is longer than 200 characters, does not decode, names another brand or names no group, MUST be refused as a bad request, in the API's one error shape with a stable code (`validation_failed`, `invalid_cursor`, `not_found`).

_From 043-brand-first-garage-list._

### 043-FR-010 — The search MUST read a garage's answer for a brand from the garage brand rows ST-39 created (one row per garage and brand, no row is `unstated`), never from a second copy.

_From 043-brand-first-garage-list._

### 043-FR-011 — The search MUST write nothing: no audit entry, no event, no search log (MF-10 owns the search log).

_From 043-brand-first-garage-list._

### 229-FR-009 — `GET /api/v1/home?brand={slug}&near={lat},{lng}` MUST answer without a session, from the `search` module and the one public garage scope, with: the brand (id, name, slug), `total` (Y) and `takers` (X); when `near` is given, both count only the approved garages in the area of that point (FR-010 and FR-011), and without it they cover all of Romania; `near` MUST be two finite numbers (latitude −90..90, longitude −180..180) inside Romania (the bounding box shared in `libs/contracts`), else 400 `validation_failed`; a missing, blank, over-long or control-character `brand` answers 400 `validation_failed`; a slug with no active brand answers 404 `not_found`; the answer carries `Cache-Control: public, max-age=60`.

_From 229-location-or-address._

### 225-FR-010 — `GET /api/v1/brands/popular?limit={n}` MUST answer without a session, from the `search` module, with the tiles of FR-003 as a list of brands (id, name, slug, popularity), `limit` a whole number 1–12 defaulting to 8 (else 400 `validation_failed`); the answer carries `Cache-Control: public, max-age=60`.

_From 225-brand-picker._

### 225-FR-011 — Both routes MUST be marked public and listed in the public routes test, documented in the OpenAPI document with their DTOs from the contracts library, and the generated web client regenerated from it; nothing in Home calls the API by hand.

_From 225-brand-picker._

### 229-FR-010 — A fixed garage (any business kind but mobile, or none) is in the area when the straight-line distance over the earth between the point and the garage's position is at most 25 000 m (the default search radius, one named constant shared by Home and Results); a garage with no position is never in an area.

_From 229-location-or-address._

### 229-FR-011 — A mobile mechanic (`business_kind = mobile`) is in the area when the point lies within its service radius of its registered seat (its stored position), whatever the distance: 15 km away with a 20 km area is in, 5 km away with a 3 km area is out, 30 km away with a 35 km area is in; one with no service radius uses 20 km (the briefs' default), one with no seat is never in an area; a point exactly on the radius is in. The seat is used for this check only and never leaves the server.

_From 229-location-or-address._

### 229-FR-012 — `GET /api/v1/search/garages?brandId=&near={lat},{lng}` MUST accept the same optional `near`, limit both groups and both counts to the area, and carry on each listed garage its distance: `distanceKm` as a number with one decimal for a fixed garage, and for a mobile mechanic `distanceKm: null` with `comesToYou: true` (false for a fixed garage); without `near` the items carry neither field, and the order, paging and cursor of 043-FR-006/007 are unchanged. The Results screen that shows these is ST-271's.

_From 229-location-or-address._

### 229-FR-013 — The area query, the distance and the mobile-mechanic rule MUST live in one shared place in the `search` module that the Home read and the garage search both call (Constitution V); the distance MUST be the straight-line distance over the earth, in metres, computed in the database.

_From 229-location-or-address._

### 229-FR-015 — A distance MUST be shown in km with one decimal in the language's format (019-FR-004): "3,2 km" in Romanian, "3.2 km" in English; under 1 km as "0,8 km"; a mobile mechanic shows "Mecanic mobil · vine la tine" / "Mobile mechanic · comes to you" instead of a distance, and its registered address is never shown. (On Home this story shows no distances, which Home has no list for; the format and the texts are the shared ones Results uses.)

_From 229-location-or-address._

### 229-FR-019 — The Home read and the garage search stay open to visitors; no new route is added, so the public routes list is unchanged.

_From 229-location-or-address._

### 229-FR-020 — Observability: no new service, endpoint, queue or outside call; the existing places look-up metrics cover the address search; the PR's Observability section states this and, if a counter for Home reads with and without a place is added, lists it in the inventory.

_From 229-location-or-address._

### 227-FR-009 — `GET /api/v1/home` MUST add to each garage of `preview` (and so to `best`): `worksOn` (the names of the brands the garage marked `works_on`, A to Z), `doesNotTake` (the names of the brands it marked `does_not_take`, A to Z; never a brand it left unmarked; a brand retired from the catalogue is in neither list) and `serviceRadiusKm` (whole km, a mobile mechanic only; absent for a fixed garage). Everything else of 226-FR-009 is unchanged: the same validation, errors, order and `Cache-Control`; the generated client is regenerated from `apps/api/openapi.json`.

_From 227-garage-cards-home._

### 226-FR-010 — The order for the dial and the takers MUST be: rating high to low with null ratings after every rated garage, then more reviews first, then name A to Z, then id; the refuser slot uses the same order among the garages whose stance is `does_not_take` or that have no row for the brand. Only approved garages in the area count (the one public scope; the area of 229-FR-010 and FR-011, all of Romania without `near`).

_From 226-best-rated-brand-dial._

## Retired

- `043-FR-004` — superseded by `042-FR-012` (2026-10-07)
- `043-FR-008` — superseded by `042-FR-013` (2026-10-07)

- `225-FR-009` — superseded by `229-FR-009` (2026-10-08)

- `226-FR-009` — superseded by `227-FR-009` (2026-10-10)

---
capability: garage-search
updated: 2026-10-14
features:
  - 043-brand-first-garage-list
  - 042-brand-verdict
  - 225-brand-picker
  - 229-location-or-address
  - 226-best-rated-brand-dial
  - 227-garage-cards-home
  - 267-brand-results
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

### 267-FR-002 — The cursor of 043-FR-006 MUST continue that order: it carries the brand, the group and the last garage's id, and the search reads that garage's rating, review count and name back by id as the keyset, so no garage is repeated or skipped between two consecutive pages of an unchanged list, even when that garage has left the public list since. A rating change between two pages may move the boundary; paging through a changing list is ST-273's.

_From 267-brand-results._

### 267-FR-001 — The garage search for a brand (`GET /api/v1/search/garages`) MUST order each group by rating high to low with unrated garages after every rated one, then more reviews first, then name A to Z under the database's default collation, then id; the rating is the stored one-decimal value (`Decimal(2,1)`), so the order key and the card's number are the same; the group rule of 043-FR-001 (takers first, on every page) is unchanged.

_From 267-brand-results._

### 267-FR-003 — Each listed garage MUST carry, besides the fields of 042-FR-012 and 229-FR-012, what its card shows: `rating` (one decimal, null until reviewed), `reviewCount`, `labourFromLei` (whole lei, null until set), `businessKind`, `city` (the address's city; never for a mobile mechanic; absent when unknown), `serviceRadiusKm` (a mobile mechanic only), and `facilities` (the kinds of its facility rows in status `listed`, in a fixed catalogue order). Nothing private travels: no phone, address, seat or account.

_From 267-brand-results._

### 043-FR-009 — The brand MUST be named by its uuid; a uuid no brand row holds MUST answer "not found", while a retired (inactive) brand still answers; a missing brand, a value that is not a uuid, an unknown query field, or a cursor that is longer than 200 characters, does not decode, names another brand or names no group, MUST be refused as a bad request, in the API's one error shape with a stable code (`validation_failed`, `invalid_cursor`, `not_found`).

_From 043-brand-first-garage-list._

### 043-FR-010 — The search MUST read a garage's answer for a brand from the garage brand rows ST-39 created (one row per garage and brand, no row is `unstated`), never from a second copy.

_From 043-brand-first-garage-list._

### 267-FR-007 — A new search (the page opening for a brand and place, or the brand or the place changing) MUST write exactly one SEARCH_LOG row: `brand_id`, `area_cell` (a geohash of 5 characters of the place, about 5 km; null without a place) and `at`. No account id, no exact point, no cursor page, no `ids=` read, no reload, no retry, no 50 km widening and no live re-read writes one. The page marks a new search with `log=1`; the API writes nothing without it, and writes the row for every `log=1` request whether the answer came from the cache or from PostgreSQL.

_From 267-brand-results._

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

### 267-FR-005 — The search MUST accept `radius` of 25 (the default) or 50 km, applied to fixed garages only (a mobile mechanic's rule of 229-FR-011 is unchanged); any other value answers `validation_failed`.

_From 267-brand-results._

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

### 267-FR-004 — The search MUST accept the brand by its catalogue slug (`brand={slug}`) as well as by id, exactly one of the two, and the answer MUST carry the brand (id, name, slug) so the page can name it; a slug naming no brand answers `not_found`, both given or neither answers `validation_failed`.

_From 267-brand-results._

### 267-FR-006 — The search MUST accept `ids={uuid,…}` (at most 20) with a brand, answering the listed-garage items for those ids that are public, in the same shape and no other field, uncached and never logged, so the page can refresh the cards it shows; an id that names nothing public is left out silently.

_From 267-brand-results._

### 267-FR-008 — The row MUST be written after the answer is sent; a failure to write it MUST be logged and MUST never fail or slow the search. 043-FR-011 ("the search writes nothing") is modified to allow this one write and nothing else: no audit entry and no event.

_From 267-brand-results._

### 267-FR-009 — A page answer MUST be kept in Redis for 60 seconds, keyed by brand, place (as the shared 3-decimal `near` text), radius and cursor (never `log` or `ids`), and the same request within that time MUST be answered from it; the answer is never cached by a CDN (`Cache-Control: no-store`), so every search reaches the API and the log stays complete. `ids=` reads are never cached.

_From 267-brand-results._

### 267-FR-010 — Every cached answer MUST be dropped when a public garage change passes through the API (an approval, suspension, restoration, `garage.updated`, a brand-stance change or a review kind), so a count or card read after it is fresh; 60 seconds is the longest an entry lives either way.

_From 267-brand-results._

### 267-FR-011 — With Redis unavailable the search MUST answer from PostgreSQL directly, with no error and no difference in the answer; the miss is counted.

_From 267-brand-results._

### 267-FR-012 — The web app MUST serve Results at `/:lang/garages` in place of today's placeholder, open to anyone with no session, reading `brand` (the slug) from the address bar, the place from `near` in the bar or else from the browser's kept place (which is then written into the bar), and `radius=50` when widened; the bar is rewritten without a history entry, so a shared link opens the same search.

_From 267-brand-results._

### 267-FR-013 — The page MUST show the title naming the brand in the copy voice of MF-2 ("Service-uri pentru BMW" in the mock's voice), and under it the summary "{total} de service-uri găsite · {takers} lucrează pe {brand} · {others} nu o primesc" with the Romanian plural rules, the area ("în 25 km de {place}" / "în 50 km de {place}", or nothing without a place) and "Schimbă locul".

_From 267-brand-results._

### 267-FR-014 — Each card MUST show: a drawing with the garage's initials (the first letters of its first two words), the name, the area line ("{city} · {distance}", a mobile mechanic's "Mecanic mobil · vine la tine · rază {n} km" instead, never its address), the lamp of `libs/ui-cockpit` green for `works_on` and red otherwise with its words ("primește {brand}" / "nu primește {brand}"), the works-on list and the refusal list ("Lucrează pe" / "Nu primește", the existing brand-answer texts), the listed facilities, "de la {n} lei/oră", "{n} recenzii", the rating dial of `libs/ui-cockpit` with the rating (an unrated garage shows "fără recenzii" and an empty dial) and the link "Vezi service-ul" to `/:lang/garages/{slug}?brand={slug}`. Distances follow 229-FR-015.

_From 267-brand-results._

### 267-FR-015 — The header MUST be the public frame's: the logo, "Căutare nouă" to Home, sign in, "Înscrie-ți service-ul" and the RO / EN switch; the page needs no sign-in and asks for none.

_From 267-brand-results._

### 267-FR-016 — While the search runs the page MUST show six skeleton cards; on an API error or no answer it MUST show "Nu am putut încărca rezultatele" with "Reîncearcă", which runs the same request again (not logged); the page MUST never scroll sideways at 320 px.

_From 267-brand-results._

### 267-FR-017 — Without a place, zero garages read "Niciun service găsit" with "Schimbă locul" only, and `radius` is ignored (no `validation_failed`). With a place and zero garages the page MUST show "Niciun service în 25 km" with "Caută în 50 km" (offered once per place: after it the empty state at 50 km offers "Schimbă locul" only) and "Schimbă locul", which opens the existing place dialog; a place chosen there runs a new, logged search at 25 km.

_From 267-brand-results._

### 267-FR-022 — Warming the result for the most common next filter is recorded as not applicable until the filters exist (#210): this story has no next request to warm (no filters, no sort UI, no second page without ST-273), and the 60-second cache of FR-009 is the warm store #210 will fill once a brand and place are chosen. The story's finish comment records this; #210 carries the warm rule, its hit-rate panel and its alert.

_From 267-brand-results._

### 267-FR-023 — The PR MUST list in its Observability section and in `infra/observability/inventory.json`: a counter of search-log rows written and failed, a counter of cache hits, misses and fallbacks (Redis unavailable), and the search latency histogram with a panel on the MotorFix dashboard and an alert when the fallback rate or the log-failure rate stays above 5% for 10 minutes; `motorfix_searches_total` stays as it is.

_From 267-brand-results._

### 267-FR-024 — Jest on real PostgreSQL and Redis MUST cover: the groups with `works_on`, `does_not_take` and an unmarked brand and draft and suspended garages excluded; the order with equal ratings and equal reviews and unrated garages last in their group, across a page boundary; the 25 km boundary, the 50 km radius and mobile mechanics in and out of their area; the slug and the id naming the brand; `ids=` with a non-public id; one SEARCH_LOG row per new search, none without `log=1`, no account id or exact point, and the search answering when the write fails; the cache key, the drop on a public garage event and the fallback with Redis down; the stream taking 20 garage ids and refusing 21. Web unit tests MUST cover the page's reading of the bar and the kept place, the title and summary texts in both languages, a card's fields for a fixed garage and a mobile mechanic, the empty, loading and error states, the 50 km offer once, and the live rules of FR-019 and FR-020. Playwright: from Home with Dacia selected, open Results and check the order and counts against the seed; in a second context suspend a garage and see its card fade out.

_From 267-brand-results._

## Retired

- `043-FR-004` — superseded by `042-FR-012` (2026-10-07)
- `043-FR-008` — superseded by `042-FR-013` (2026-10-07)

- `225-FR-009` — superseded by `229-FR-009` (2026-10-08)

- `226-FR-009` — superseded by `227-FR-009` (2026-10-10)

- `043-FR-007` — superseded by `267-FR-001` (2026-10-14)
- `043-FR-006` — superseded by `267-FR-002` (2026-10-14)
- `042-FR-013` — superseded by `267-FR-003` (2026-10-14)
- `043-FR-011` — superseded by `267-FR-007` (2026-10-14)
- `229-FR-012` — superseded by `267-FR-005` (2026-10-14)

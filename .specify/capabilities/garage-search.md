---
capability: garage-search
updated: 2026-10-20
features:
  - 043-brand-first-garage-list
  - 042-brand-verdict
  - 225-brand-picker
  - 229-location-or-address
  - 226-best-rated-brand-dial
  - 227-garage-cards-home
  - 267-brand-results
  - 1182-cache-service
  - 1169-prefetch-intent
  - 269-map-price-pins
  - 049-garage-suspension
  - 290-save-garage
  - 270-card-pin-link
  - 271-garage-distance
  - 228-how-it-works-list-garage
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

### 269-FR-006 — In visible-area mode the list MUST keep the brand groups, the order of 267-FR-001, the paging of 267-FR-002 (the cursor names the box), the counts of 043-FR-005 and the distances measured from `near` when it is given; `log=1` with `bbox` MUST write no SEARCH_LOG row (267-FR-007: moving the map is not a new search).

_From 269-map-price-pins._

### 229-FR-009 — `GET /api/v1/home?brand={slug}&near={lat},{lng}` MUST answer without a session, from the `search` module and the one public garage scope, with: the brand (id, name, slug), `total` (Y) and `takers` (X); when `near` is given, both count only the approved garages in the area of that point (FR-010 and FR-011), and without it they cover all of Romania; `near` MUST be two finite numbers (latitude −90..90, longitude −180..180) inside Romania (the bounding box shared in `libs/contracts`), else 400 `validation_failed`; a missing, blank, over-long or control-character `brand` answers 400 `validation_failed`; a slug with no active brand answers 404 `not_found`; the answer carries the public cache policy of 1182-FR-009 (`public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400`; was `public, max-age=60`, amended by 1182-cache-service).

_From 229-location-or-address._

### 228-FR-011 — The popular-brands call MUST accept a limit of up to 16, refuse a larger one (400) and keep its default of 8, and answer in the ranking's order; it stays public and cacheable.

_From 228-how-it-works-list-garage._

### 225-FR-011 — Both routes MUST be marked public and listed in the public routes test, documented in the OpenAPI document with their DTOs from the contracts library, and the generated web client regenerated from it; nothing in Home calls the API by hand.

_From 225-brand-picker._

### 229-FR-010 — A fixed garage (any business kind but mobile, or none) is in the area when the straight-line distance over the earth between the point and the garage's position is at most 25 000 m (the default search radius, one named constant shared by Home and Results); a garage with no position is never in an area.

_From 229-location-or-address._

### 229-FR-011 — A mobile mechanic (`business_kind = mobile`) is in the area when the point lies within its service radius of its registered seat (its stored position), whatever the distance: 15 km away with a 20 km area is in, 5 km away with a 3 km area is out, 30 km away with a 35 km area is in; one with no service radius uses 20 km (the briefs' default), one with no seat is never in an area; a point exactly on the radius is in. The seat is used for this check only and never leaves the server.

_From 229-location-or-address._

### 267-FR-005 — The search MUST accept `radius` of 25 (the default) or 50 km, applied to fixed garages only (a mobile mechanic's rule of 229-FR-011 is unchanged); any other value answers `validation_failed`.

_From 267-brand-results._

### 271-FR-010 — The area membership and the distance (229-FR-010, 229-FR-011, 229-FR-013, 269-FR-004, 269-FR-005: the 25 or 50 km radius for a fixed garage, the service radius for a mobile mechanic, the box in visible-area mode) MUST be computed by the database's spatial functions over that column on the sphere, except the visible-area box, which stays a latitude and longitude range over the stored coordinates (`contracts/area-sql.md`) (`use_spheroid => false`, the values of today's haversine), and shown to one decimal rounded half away from zero as today (a value on a tie such as 3.25 reads 3.3), in the one shared place of the `search` module, and the plan of the area query MUST use the GiST index; the PR carries the `EXPLAIN` showing it.

_From 271-garage-distance._

### 229-FR-015 — A distance MUST be shown in km with one decimal in the language's format (019-FR-004): "3,2 km" in Romanian, "3.2 km" in English; under 1 km as "0,8 km"; a mobile mechanic shows "Mecanic mobil · vine la tine" / "Mobile mechanic · comes to you" instead of a distance, and its registered address is never shown. (On Home this story shows no distances, which Home has no list for; the format and the texts are the shared ones Results uses.)

_From 229-location-or-address._

### 269-FR-001 — The API MUST answer `GET /api/v1/search/garages/pins` without a session, from the `search` module and the one public garage scope (approved garages only; draft, suspended and never-approved excluded, as 043-FR-002), with the brand named as the list names it (`brand={slug}` or `brandId`, exactly one, 267-FR-004; an unknown brand answers 404 `not_found` as the list does), `near` and `radius` with the list's validation (267-FR-005, 229-FR-009's `near` rules), and `bbox` (FR-005); the route is marked public, listed in the public routes test, documented in the OpenAPI document with DTOs from the contracts library, and the web client is regenerated from it (225-FR-011).

_From 269-map-price-pins._

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

### 269-FR-019 — The pins answer MUST carry `Cache-Control: no-store` and be kept in Redis for 60 seconds under the list's rules, keyed by brand, place, radius and box (267-FR-009), dropped on the same public garage events (267-FR-010), answered from PostgreSQL when Redis is unavailable (267-FR-011); the list's `bbox` joins its cache key.

_From 269-map-price-pins._

### 267-FR-010 — Every cached answer MUST be dropped when a public garage change passes through the API (an approval, suspension, restoration, `garage.updated`, a brand-stance change or a review kind), so a count or card read after it is fresh; 60 seconds is the longest an entry lives either way.

_From 267-brand-results._

### 267-FR-011 — With Redis unavailable the search MUST answer from PostgreSQL directly, with no error and no difference in the answer; the miss is counted.

_From 267-brand-results._

### 271-FR-001 — Results opened in the browser with no `near` in the address bar and no kept place (a `bbox` alone is not a place) MUST ask the browser's location once on load (the existing 10 s timeout); while the request is open it MUST show its loading state and a polite status "Se caută locația…" / "Finding your location…" and run no search; a position inside Romania becomes the kept place (origin location, rounded as 229-FR-008), is written into the bar as `near` and starts one logged search. With `near` in the bar or a kept place it MUST search at once and ask nothing (267-FR-012 otherwise unchanged).

_From 271-garage-distance._

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

### 1182-FR-008 — The brand pages MUST go through the cache service: the Home answer for a brand (`GET /api/v1/home`, keyed by brand and the shared 3-decimal place text or none) and the popular tiles (`GET /api/v1/brands/popular`, keyed by limit), each with a soft lifetime of 60 seconds, tagged so that the relay purges them on the same public garage and search events that drop the search page today (267-FR-010's rule). Their answers and validation are unchanged (229-FR-009, 225-FR-010, 227-FR-009).

_From 1182-cache-service._

### 1169-FR-007 — The results page's card MUST pre-fetch the public profile of its garage, with the brand in context, on the first of: the pointer resting on the card for 100 ms, a touch starting on it, or the card scrolling into view after the visitor's first scroll (cards visible at first paint are not pre-fetched on visibility alone: first paint is not intent). At most 3 pre-fetches are in flight at once (later signals wait for a slot); a card already stored or in flight starts no second fetch; the pointer leaving a card before its answer cancels the fetch and stores nothing. On the same signal the profile route's lazy code is requested once per page life.

_From 1169-prefetch-intent._

### 269-FR-002 — The answer MUST carry `total` (every garage found, the same number the list's `total` gives for the same parameters) and `pins`, one per garage found, each with `id`, `lat`, `lng`, `rateLei` (whole lei, the hourly labour rate rounded to the nearest leu; null when not set), `stance` (`works_on`, `does_not_take` or `unstated`, read from the garage brand rows as 043-FR-010) and, for a mobile mechanic only, `serviceRadiusKm` (20 when none is set, 229-FR-011). A mobile mechanic's `lat`/`lng` is the centre of its circle rounded to 2 decimals (about 1 km), so the answer never gives its seat (X20c); no name, address, city or other field travels.

_From 269-map-price-pins._

### 269-FR-003 — The answer MUST hold at most 500 pins (`SEARCH_PINS_MAX`, a named constant in the contracts library); above that the 500 nearest the place, or the box's centre without a place, are answered and `total` still counts every garage found.

_From 269-map-price-pins._

### 269-FR-004 — The garages found MUST be the list's: the area rule of 229-FR-010 and 229-FR-011 for the 25 or 50 km search, and FR-005's box rule in visible-area mode, through the one shared area query of 229-FR-013 (Constitution V); the pins and the list for the same parameters never disagree on which garages are found.

_From 269-map-price-pins._

### 269-FR-005 — Both the list route (`GET /api/v1/search/garages`) and the pins route MUST accept `bbox={south},{west},{north},{east}` (four finite numbers, latitudes −90..90, longitudes −180..180, south < north, west < east, the box inside Romania's bounding box, each number rounded to 3 decimals as `near` is); with it, a fixed garage is found when its position is inside the box, `radius` is ignored, and a mobile mechanic is found when `near` is given and the place is inside its area (never by the box; without `near` no mobile mechanic). A box wider than 100 km (`SEARCH_BBOX_MAX_KM`) on its longer side, or one failing the checks above, answers 400 `validation_failed`.

_From 269-map-price-pins._

### 269-FR-007 — The page MUST request the visible area when the map has been still for 400 ms after a drag or zoom by the driver (never after the page's own fit-to-pins move), with the box the map shows clamped to Romania's bounding box (nothing is requested when the clamped box is empty), for the pins and for the list's first page; a box equal to the one last loaded requests nothing; a newer request supersedes an in-flight one; the address bar is unchanged (a reload returns to the 25 km search). While a visible-area request is in flight the pins and cards shown stay and the list's loading state of 267-FR-016 applies; when it fails the list shows its error state (267-FR-017) with a retry, the pins stay and the box is not recorded as loaded.

_From 269-map-price-pins._

### 269-FR-008 — In visible-area mode the summary MUST read "{total} de service-uri în zona hărții · {takers} lucrează pe {brand} · {others} nu o primesc" ("{total} garages in the map area · …") with the Romanian plural rules of 267-FR-013, and show a button "Înapoi la 25 km" ("Back to 25 km"; "50 km" when the first search was widened) that restores the first search's list and pins and fits the map to them.

_From 269-map-price-pins._

### 269-FR-009 — When the box the map shows is wider than 100 km on its longer side, the page MUST request nothing, keep the pins and the list it shows, and show the hint "Apropie harta" ("Zoom in") on the map until the box is narrower; the hint and the "map not available" line of FR-017 sit outside the hidden map canvas, in a polite live region (`role="status"`), so a screen reader announces them.

_From 269-map-price-pins._

### 269-FR-010 — Results MUST show an interactive MapLibre map beside the list on desktop (the list and the map side by side from 1024 px), and above the list at full width and a fixed height below that; the phone layout of #51 (summary, map, list sheet) is not built here, and the page never scrolls sideways at 320 px (267-FR-016). The map uses MapLibre's cooperative gestures (one finger scrolls the page, two move the map; Ctrl or ⌘ with the wheel zooms), so it never traps a page scroll.

_From 269-map-price-pins._

### 269-FR-011 — The map MUST use the tile styles and the dark-scheme choice of the place-step map (A17's provider, openfreemap `liberty` and `dark`), honouring the same test override that points it at the app's empty style, so the neighbourhood names come from the style and no test fetches a tile from outside.

_From 269-map-price-pins._

### 269-FR-012 — On load, and on "Înapoi la 25 km", the map MUST fit the bounds of the place and every fixed pin (with padding, at most zoom 15, so one pin does not fill the screen); mobile circles do not widen the fit; with no place and no pin it shows Romania whole. The move is instant (never animated), so reduced motion needs nothing more.

_From 269-map-price-pins._

### 269-FR-013 — Each fixed garage MUST be one pin labelled with its `rateLei` (no label when null) and coloured with the lamp colours of `libs/ui-cockpit` (green for `works_on`, red for `does_not_take` and `unstated`); when the pins answer holds more than 50 fixed pins, pins MUST merge into clusters showing their count (MapLibre's GeoJSON clustering), and a cluster MUST split when zoomed into.

_From 269-map-price-pins._

### 269-FR-014 — Each mobile mechanic MUST be one light circle of its `serviceRadiusKm` around its centre, drawn under the pins, with a small label of its `rateLei` inside and no centre marker, no pin and no address.

_From 269-map-price-pins._

### 269-FR-015 — A legend MUST sit on the map in both languages, with the mock's words (Results.dc.html, `mf-legend-d`): the green lamp "primește {brand}" ("takes {brand}"), the red lamp "nu primește" ("doesn't"), and "lei pe oră" ("lei per hour") for the number on a pin; when a circle is on the map, a fourth entry explains it ("Mecanic mobil · zona deservită" / "Mobile mechanic · service area").

_From 269-map-price-pins._

### 269-FR-016 — The map MUST NOT be the accessible path: the map region carries a text label ("Harta service-urilor" / "Map of garages"), the map canvas, its pins, clusters and controls are hidden from assistive technology and skipped by the keyboard order, and every garage stays in the list.

_From 269-map-price-pins._

### 269-FR-017 — While the search runs the map area MUST show a grey map with the legend; pins appear when the pins request answers. When the map's style fails to load (a map `error` before `load`, or no `load` within 10 s; a single tile error is ignored) the map area MUST read "Harta nu este disponibilă acum" ("The map is not available now") and the list is unchanged; when the pins request fails the map stays without pins, with no message over the list. The map is browser-only: the server renders the placeholder and the legend.

_From 269-map-price-pins._

### 269-FR-018 — The pins MUST be re-read (one pins request for the current parameters) within 2 seconds when a live message of the kinds the list follows about a public garage arrives (`garage.updated`, `garage.suspended`, `garage.restored`, `verification.decided`), through the same stream as the list (267-FR-019), bursts folded as the list folds them; a review event re-reads nothing (a pin shows no rating).

_From 269-map-price-pins._

### 269-FR-020 — The PR MUST list in its Observability section and in `infra/observability/inventory.json`: the pins route counted by outcome (`results`, `none`) and by mode (`area`, `bbox`) in `motorfix_search_pins_total{outcome,mode}`, its latency in `http.server.request.duration` by `http.route` (automatic), a panel on the MotorFix dashboard, and the existing search cache fallback alert covering it; no new outside call (the tiles are fetched by the browser from A17's provider, already in use by the place-step map).

_From 269-map-price-pins._

### 269-FR-021 — Jest on real PostgreSQL and Redis MUST cover: the pins for the 25 km circle and for a box; the 500 cap with the nearest kept and `total` exact; a mobile mechanic only when the place is inside its area, in both modes, and never by the box alone; draft, suspended and never-approved garages excluded; `bbox` validation (wider than 100 km, outside Romania, inverted corners); the list route in visible-area mode (groups, order, counts, distances from the place, no SEARCH_LOG row with `log=1`); the cache key with the box and the drop on a public garage event; the public routes list. Web unit tests MUST cover the pin label and colour for each stance and a null rate, the circle for a mobile mechanic, the legend texts in both languages, the 400 ms stillness and the 100 km guard, the "Înapoi la 25 km" return, the loading, tiles-failed and pins-failed states, and the live re-read. Playwright, with the tile service stubbed: open Results and check the number of pins equals the total of fixed garages found; drag the map and see the list and the total change; tap "Înapoi la 25 km".

_From 269-map-price-pins._
### 290-FR-010 — Each result card on the results page, list and map (267-FR-014), MUST show the same control as an icon-only bookmark button (accessible name "Salvează" / "Salvat", outline or filled), for a signed-in driver or a visitor, absent in the other roles; tapping it MUST not open the card's profile link.

_From 290-save-garage._
### 049-FR-006 — Every public read MUST keep going through the one public scope (`status = approved`), so a suspended garage is in neither group and neither count of the brand search (043-FR-002), absent from the brand pages' counts and dials, answers 410 `gone` on its profile (307-FR-001) and is never a recipient of request routing (221-FR-007). This story adds no new read and MUST prove the rule with tests on a garage suspended through the use case.

_From 049-garage-suspension._

### 270-FR-001 — Results MUST hold, in the page only (no address bar entry, no storage, no request), one **selected** garage id or none and one **pointed** garage id or none; the lit pin (or circle) is the pointed garage's while there is one, else the selected garage's; the card in the amber state is the selected garage's; never two cards or two pins at once.

_From 270-card-pin-link._

### 270-FR-002 — A card MUST become pointed while a pointer (not a touch) rests on it or while an element inside it holds the keyboard focus, and stop being pointed when the pointer leaves it or focus leaves it.

_From 270-card-pin-link._

### 270-FR-003 — A tap or click on a card anywhere but its "Vezi service-ul" link and its bookmark button MUST select its garage; the link and the button keep doing what they do (267-FR-014, 290-FR-010) and select nothing.

_From 270-card-pin-link._

### 270-FR-004 — A tap on a pin (its dot or its rate label) or on a mobile mechanic's rate label MUST select its garage and, when its card is in the list, scroll that card into view (the nearest edge, smooth unless reduced motion), without moving the keyboard focus; a tap on a circle's fill, on the map away from any pin, or on the cluster selects nothing. A tap on a cluster MUST zoom the map to the zoom at which it splits, as the page's own move (no list reload, no selection change). Selecting a card MUST NOT move the map.

_From 270-card-pin-link._

### 270-FR-005 — When the list shown is replaced by a fresh answer (a new brand, place or radius, a visible-area load of 269-FR-007, "Înapoi la 25 km" of 269-FR-008, the "Reîncarcă" chip of 267-FR-020, and any later sort or filter change) the first card's garage MUST become selected and the pointed state cleared, without scrolling the list; with an empty list nothing is selected. An in-place card change (267-FR-019) and a pins re-read (269-FR-018) MUST keep the selection.

_From 270-card-pin-link._

### 270-FR-007 — The selected card MUST show the theme's selected state (050-FR-007: amber border and text accent on the 10% amber tint, the `--mf-amber*` tokens of `libs/ui-cockpit`), in both schemes; its lamp, texts and controls are otherwise unchanged. A pointed card that is not selected shows no card change: only its pin lights.

_From 270-card-pin-link._

### 270-FR-008 — The lit pin MUST be amber (`--mf-amber`) with its rate label in the on-amber ink (`--mf-on-amber`), drawn above every other pin and circle; every other pin keeps its lamp colour (269-FR-013). A lit mobile mechanic's circle MUST fill and outline amber (a fill denser than the resting 12% so it reads as active, still letting the map show through) with its rate label readable; a resting circle is unchanged (269-FR-014). A cluster is never lit.

_From 270-card-pin-link._

### 270-FR-009 — When the map's style failed, the pins request failed, or the selected garage is not among the pins (the 500 cap, a cluster) the card states of FR-001 to FR-007 MUST work unchanged and nothing is drawn for the pin; no message is shown.

_From 270-card-pin-link._

### 270-FR-010 — When a tapped pin's garage is not in the list shown, a small card MUST open on the map at the pin, outside the hidden canvas so its text is readable, showing at once the pin's lamp (green for `works_on`, red otherwise, with the lamp's words) and rate ("de la {n} lei/oră"; no rate line when null), and, once read through the `ids=` read of 267-FR-006 with the brand, the garage's name, its rating as the list card shows it ("fără recenzii" when unrated) and the link "Vezi service-ul" to `/:lang/garages/{slug}?brand={slug}`; it closes when another pin or card is selected, when the map is tapped away from any pin, or when the list is replaced (FR-005). When the read fails or answers no item, the small card closes and nothing else happens. The small card is not designed (Build brief, Screens): it follows the Cockpit panel look. It stays inside the map's box (clamped, not flipped, at 320 px too), takes no focus when it opens, is not a dialog and has no Escape handling; its link is an ordinary tab stop, and it shows a skeleton line for the name until the read answers.

_From 270-card-pin-link._

### 270-FR-011 — The map MUST stay out of the accessible path (269-FR-016): the pins are pointer targets only, nothing new takes focus, no announcement is made for a pin tap, and the keyboard user reaches every garage through the list, its focus lighting the garage's pin (FR-002); no new tab stop is added to the card. A pin's tap target is the drawn box of its dot or label (no larger hit area is added); the list is the path for anyone who cannot hit it. The page MUST never scroll sideways at 320 px, and the selected card and the small card MUST pass the QA sweep's axe checks.

_From 270-card-pin-link._

### 270-FR-012 — Observability: the story adds no service, endpoint, queue, outside call or product action (the `ids=` read exists); the PR's Observability section states this and the inventory is unchanged.

_From 270-card-pin-link._

### 270-FR-013 — Web unit tests (Jest) MUST cover the active-garage state: set by a card tap, set by a pointer and cleared on leave, set by focus and cleared on blur, set by a pin tap, the first card on a fresh list (brand, place, visible area, back, reload), kept on an in-place change, passed on a fade-out, none on an empty list; the card's selected state; the pin, circle and cluster look for the active garage; the small card's fields and its close rules; the no-map case. Playwright, with the tile style stubbed: hover a card and check its pin's state; click a pin and check its card is amber and in view. Every test file carries a whole-line `// @traces 270-FR-<n>` comment (Constitution II).

_From 270-card-pin-link._

### 271-FR-001 — Results opened in the browser with no `near` in the address bar and no kept place (a `bbox` alone is not a place) MUST ask the browser's location once on load (the existing 10 s timeout); while the request is open it MUST show its loading state and a polite status "Se caută locația…" / "Finding your location…" and run no search; a position inside Romania becomes the kept place (origin location, rounded as 229-FR-008), is written into the bar as `near` and starts one logged search. With `near` in the bar or a kept place it MUST search at once and ask nothing (267-FR-012 otherwise unchanged).

_From 271-garage-distance._

### 271-FR-002 — On a refusal, a browser error, no geolocation in the browser, a point outside Romania, or no answer within 10 s, Results MUST show an address field labelled "Introdu o adresă" / "Enter an address" at the top of the page, above the map, with focus, and MUST assume no city and run no search; the map shows no pins and the list no cards until a place exists. Choosing a suggestion makes it the kept place (origin address), writes `near` into the bar and starts one logged search; the field then gives way to the summary line of 267-FR-013. An empty answer, a failed or rate-limited look-up and a text under three characters behave as 229-FR-004 ("Nu am găsit adresa", "Nu putem căuta adrese acum", nothing); a place from a link or from the browser keeps working while the geocoding service is down.

_From 271-garage-distance._

### 271-FR-003 — A location answer that arrives after the driver already chose a place another way MUST be dropped; a kept place set by this story on Results MUST be the same place Home reads (one storage, 229-FR-005).

_From 271-garage-distance._

### 271-FR-004 — The map MUST show one marker at the place, for the browser's location and a typed address alike, visually distinct from the price pins and the mobile areas, that pulses unless the device asks for reduced motion (`prefers-reduced-motion: reduce`); it moves when the place changes, is included in the map's fit to its contents (the Results map's `fit`) and is hidden from assistive technology (the summary line names the place). Its colour is the theme's accent, distinct from the pins in both themes and readable against the map (the sweep checks it). In visible-area mode it stays where the place is.

_From 271-garage-distance._

### 271-FR-006 — Distances and the mobile line on the cards stay as built (229-FR-015, 267-FR-014: "3,2 km" / "3.2 km", under 1 km "0,8 km", "Mecanic mobil · vine la tine · rază {n} km", never an address), and this story MUST prove them end to end from a real place: the seeded Service Mărăști reads "1,0 km" from the Cluj test point.

_From 271-garage-distance._

### 271-FR-007 — Changing the place from the summary line MUST keep running one new, logged search from the new place (267-FR-013, 267-FR-017, 267-FR-007: unchanged, proven here).

_From 271-garage-distance._

### 271-FR-008 — Every new text MUST live in the shared i18n files in Romanian and English; the page with the status line, the address field and the marker MUST hold at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll.

_From 271-garage-distance._

### 271-FR-010 — The area membership and the distance (229-FR-010, 229-FR-011, 229-FR-013, 269-FR-004, 269-FR-005: the 25 or 50 km radius for a fixed garage, the service radius for a mobile mechanic, the box in visible-area mode) MUST be computed by the database's spatial functions over that column on the sphere, except the visible-area box, which stays a latitude and longitude range over the stored coordinates (`contracts/area-sql.md`) (`use_spheroid => false`, the values of today's haversine), and shown to one decimal rounded half away from zero as today (a value on a tie such as 3.25 reads 3.3), in the one shared place of the `search` module, and the plan of the area query MUST use the GiST index; the PR carries the `EXPLAIN` showing it.

_From 271-garage-distance._

### 271-FR-011 — The garage search (both groups, both counts, the order and the paging of 267-FR-001/002), the Home read's counts and preview (229-FR-009, 227) the pins (269-FR-001), the cars list's distances (291-FR-004) and the quote request's candidate garages (`candidates()`, today `garagesInArea`) MUST select the garages inside the area and read their distance in the same query, with no `id IN` list built from the area in the application; each read is one raw SQL statement over the area and the public scope, and cards are hydrated by the ids of the one page it answers, never of the whole area; their answers for the seeded fixture are identical before and after, which the existing integration suites prove unchanged.

_From 271-garage-distance._

### 271-FR-012 — Every read this story touches MUST keep applying the one public scope (approved garages only, 043-FR-002, 049-FR-006), and the scope guard test MUST cover the new reads so a raw query that forgets the scope fails it.

_From 271-garage-distance._

### 271-FR-013 — Before the PR is ready, the spatial extension MUST be verified available on the staging and production databases (the extension's availability read on each; the migration's `CREATE EXTENSION IF NOT EXISTS` is what enables it), and the PR MUST say so; an environment that cannot offer it makes the task Blocked with a needs-confirmation question on the story's issue, never a silent change of database image.

_From 271-garage-distance._

### 271-FR-017 — This story writes nothing new on the server: no audit entry, no event, no live update, no account field; the search log keeps logging one row per new search (267-FR-007/269-FR-006, unchanged). Observability: no new service, endpoint, queue or outside call; the profile read with `near` is the same endpoint; the PR's Observability section says so.

_From 271-garage-distance._

### 271-FR-018 — Tests: unit (Jest) for the Results location flow with a fake geolocation (allowed, refused, 10 s timeout, late answer dropped), the marker's reduced-motion rule, the shared address field, and the profile's distance line; integration for the migration (every position kept, the derived point equals the pair), the area query (identical answers, the index in the plan), the profile `near` read and its cache; end to end (Playwright): Results with geolocation granted at the Cluj test point shows the marker and "1,0 km" on Service Mărăști; with geolocation denied, the field shows, "Cluj" is typed (fake provider), the suggestion picked and the results appear.

_From 271-garage-distance._

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

- `229-FR-019` — superseded by `269-FR-001` (2026-10-17)
- `267-FR-009` — superseded by `269-FR-019` (2026-10-17)
- `267-FR-007` — superseded by `269-FR-006` (2026-10-17)

- `267-FR-012` — superseded by `271-FR-001` (2026-10-18)
- `229-FR-013` — superseded by `271-FR-010` (2026-10-18)

- `225-FR-010` — superseded by `228-FR-011` (2026-10-20)

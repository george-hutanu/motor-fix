---
capability: garage-profile
updated: 2026-10-30
features:
  - 307-public-garage-profile
  - 310-photo-gallery
  - 312-report-garage
  - 384-response-rate
  - 143-profile-views
  - 355-price-list-ranges
  - 1182-cache-service
  - 1169-prefetch-intent
  - 1235-unknown-brand-cache
  - 290-save-garage
  - 386-brand-price-range
  - 356-live-estimate
  - 271-garage-distance
  - 311-estimate-within-reach
  - 1183-garage-profile-page
  - 1353-verified-badge-last-check
  - 330-listed-facilities
  - 1192-photo-variants
  - 308-profile-details
  - 025-review-mechanic
  - 133-garage-public-profile
  - 136-legal-check-panel
  - 309-open-now-directions
  - 385-share-garage-link
  - 024-garage-reviews
  - 1367-review-price-marks
  - 1366-garage-map-directions
  - 1246-garage-profile-edit
  - 1247-brand-fuel-edit
---

# Capability: Garage profile

The public page of an approved garage, one address per language: the site bar, the header (back link, brand lamp, verified badge, name, place line, description, rating dial), the verification line with the date of the last check, the slots the other profile stories fill, the 404 and "no longer available" views, the public read that serves it with its cache, and the live re-read on the public stream.

## Requirements

### 307-FR-001 — `GET /api/v1/garages/{slug}` MUST keep answering only through the one public scope: 200 for an `approved` garage, 404 `not_found` with no garage data for a `draft`, waiting or unknown slug, to everyone including the garage's own staff, and 410 `gone` with no garage data for a `suspended` garage (modifies 207-FR-005: the profile is now served from its cache, 307-FR-006).

_From 307-public-garage-profile._

### 1353-FR-001 — The public profile read (`GET /api/v1/garages/{slug}`) MUST take its verification date `verifiedAt` from the garage's stored date of last check (`GARAGE.last_checked_on`, the day of the latest approval or of the latest valid re-check, whichever came last, as 303-FR-005 and 1351-FR-006 write it), read as stored and never computed from the verification files, as the UTC midnight of the stored day; when the stored date is empty it MUST fall back to the garage's approval instant, as today, and when both are empty it MUST be null (no line). The field's name and shape stay; its description MUST say what it now carries. Modifies 307-FR-002.

_From 1353-verified-badge-last-check._

### 307-FR-003 — The read MUST accept an optional `brand` query parameter, a catalogue brand's slug. When it names a catalogue brand (active or retired), the answer MUST carry `brand: { id, name, slug, stance }` where `stance` is `works_on` when the garage marked the brand so and `does_not_take` when it refused it or has no row for it; when the parameter is absent, blank, over-long, holds a control character or names no catalogue brand, the answer MUST carry no `brand` and MUST NOT fail.

_From 307-public-garage-profile._

### 309-FR-006 — The public profile read (`GET /api/v1/garages/{slug}`, with its optional `brand`) MUST carry `closedDays`: every day from today (Bucharest) through today + 14 that is a legal holiday of the calendar or a closed day of the garage, each as `{ day, reason }` with `day` a Bucharest date ("YYYY-MM-DD") and `reason` `holiday` or `closed`, in date order, a day held once with `holiday` winning; empty when there is none. The closed day's note is not sent. The answer's key allow-list test MUST gain `closedDays` and keep failing on `phone`, `cui`, `seatAddress` and a mobile mechanic's `latitude`/`longitude`; `hours` and every other field stay as they are (modifies 308-FR-002: one more allowed key).

_From 309-open-now-directions._

### 1182-FR-007 — The public garage profile read MUST go through the cache service in place of its own Redis hash, slug pointer and generation: one entry per garage and brand in context (and one for none), found from the slug, tagged with the garage, a soft lifetime of 10 minutes, keeping every rule of 307-FR-001 and 307-FR-006 that the reader sees (the one public scope, the 404/410 verdicts of garages that exist read fresh every time, the brand-in-context variants, the drop on every event relayed to `public:garage:{id}`, PostgreSQL the only truth). The old keys, generation and per-module fail-open wrapper are removed, not kept beside the new service.

_From 1182-cache-service._

### 307-FR-008 — The web app MUST serve the profile at `/{lang}/garages/{slug}` (replacing the placeholder, one address per language, 021), server-rendered like the other public pages, inside the public frame, and keep `?brand=` on the address so a shared link carries the brand in context.

_From 307-public-garage-profile._

### 307-FR-009 — The page's site bar MUST show, from 640 px wide, the logo (to Home), "Găsește un mecanic" / "Find a mechanic" (to Home), "Autentificare" / "Sign in" (the sign-in dialog), "Înscrie-ți service-ul" / "List your garage" (to the listing form) and the RO / EN switch, which opens the same profile, brand included, in the other language; under 640 px the links hide, a 44 px account button ("Cont" / "Account", the sign-in dialog) stays beside the logo and RO / EN, and the public tab bar stands in for navigation (design.md).

_From 307-public-garage-profile._

### 1353-FR-002 — The header MUST keep showing, for every approved garage with a date, the badge "Verificat · autorizație RAR" / "Verified · RAR authorisation" and the line "Firmă activă și autorizație tehnică RAR, verificate de MotorFix. Ultima verificare: {date}." / "Active company and RAR technical authorisation, checked by MotorFix. Last check: {date}." with FR-001's date in the language's short form and the Europe/Bucharest zone ("1 aug. 2027" / "1 Aug 2027"; 019-FR-005, 019-FR-007), the same for a mobile mechanic, at 320 px and 390 px, tablet and desktop, light and dark, with no sideways scroll (307-FR-016). It MUST show no warning or other mark when the date is old. Modifies 307-FR-010 (the date's source).

_From 1353-verified-badge-last-check._

### 307-FR-011 — The lamp MUST be green with "Lucrează pe {brand}" / "Works on {brand}" for `works_on`, red with "Nu lucrează pe {brand}" / "Does not work on {brand}" for `does_not_take`, and absent without a brand in context; the brand's name comes from the answer, never from the address.

_From 307-public-garage-profile._

### 307-FR-012 — The back link MUST read "Service-uri pentru {brand}" / "Garages for {brand}" and point to `/{lang}/garages?brand={slug}` when a brand is in context, else "Acasă" / "Home" and point to Home.

_From 307-public-garage-profile._

### 271-FR-015 — The profile's place line MUST read "la {d} km" / "{d} km away" for a fixed garage when the browser holds a kept place (the server renders without it; the browser re-reads once with `near` and shows the distance in place), be left out without a place, and keep the mobile mechanic's area line "Mecanic mobil · zonă de {r} km" with no distance and no address (307-FR-013 completed).

_From 271-garage-distance._

### 385-FR-008 — On the 410 answer the page MUST show the view with the heading "Acest service nu mai este disponibil pe MotorFix." / "This garage is no longer available on MotorFix.", never the old garage's name or any detail of it, then the similar garages of FR-009 as result cards in a list (one list item per card, the heading before it as an `h1`) (the card of Results, 267-FR-014, each opening its garage's profile with the link's brand, or the card's own brand when the link had none), under a line "Service-uri similare în apropiere" / "Similar garages nearby"; the server answers the page with status 410, as today (modifies 307-FR-015: the Home link gives way to the cards and the search link).

_From 385-share-garage-link._

### 307-FR-016 — The page MUST render well at 320 px and 390 px (stacked), tablet and desktop (header side by side), light and dark, Romanian and English, with no sideways scroll; its texts MUST live in the public texts for both languages, and text the garage wrote MUST be shown as written in both. Accessibility: the lamp's stance and the dial's value are carried by text, never by colour alone; the back link, the sign-in controls and "Încearcă din nou" / "Try again" are reachable by keyboard with a visible focus and an accessible name; touch targets are at least 44 px under 640 px; the skeletons are hidden from assistive technology and an in-place change of the lamp or the dial is announced politely, without moving focus.

_From 307-public-garage-profile._

### 307-FR-017 — The open profile MUST join `public:garage:{garageId}` through the public live stream (`GET /api/v1/live/public?garages={id}&brand={brandId}` when a brand is in context) from the browser only, never during server rendering, and leave it when the page is left. While the stream cannot be opened or drops, the page keeps showing its last answer with no error block and reconnects and re-reads on the stream's own reopen rule (256-FR-002), never a polling loop of its own.

_From 307-public-garage-profile._

### 1353-FR-003 — The open profile MUST re-read in place when `recheck.recorded` arrives on its `public:garage:{garageId}` subscription (the event already reaches the channel, 1351-FR-013), as it does for `verification.decided` and the garage's other events, keeping the brand, the place and the scroll position (307-FR-018); a re-read answering 410 MUST switch the page to the "no longer available" view as today. Modifies 307-FR-018 (`recheck.recorded` joins the kinds the profile re-reads on).

_From 1353-verified-badge-last-check._

### 307-FR-019 — The story MUST write nothing: no view count (another story's), no audit entry, no event, no search log.

_From 307-public-garage-profile._

### 310-FR-001 — The public profile read MUST answer the garage's photos as a list in the owner's order (ascending position), each entry carrying a thumbnail address and a full-screen address, both signed download addresses valid for 60 minutes, plus the width and height of the photo as seen upright when they are known. The answer MUST never carry a storage key, bucket name or path; a test fails on any of them in the response.

_From 310-photo-gallery._

### 310-FR-002 — A photo whose copies are not yet in storage MUST be left out of the list (a row with a known width is trusted to have its copies; only a row whose width is still null is checked against the thumbnail copy's metadata at read time, which also supplies its width and height), and a garage whose list is empty MUST answer an empty list (never an absent field), so the page hides the section.

_From 310-photo-gallery._

### 310-FR-003 — The thumbnail address MUST serve the upload story's thumbnail copy (at most 400 px on its long side) and the full-screen address its display copy (at most 1,600 px, the original's format for PNG and WebP, JPEG otherwise); nothing is resized or re-encoded at read time. The read MUST never serve the original upload.

_From 310-photo-gallery._

### 1192-FR-009 — The profile page MUST fill its photos slot with a "Fotografii" / "Photos" section only when the list is not empty: the first photo large and the rest as tiles, in the list's order, each at a fixed geometry so the layout holds before the images arrive (the cover tile twice the basis of the others, every tile `clamp(220px, 28vw, 340px)` tall). A photo with an `imageBase` MUST show as a `<picture>`: an AVIF `<source>` whose `srcset` lists the four widths, and an `NgOptimizedImage` `<img>` whose custom image loader names the WebP variant of each of the four widths (listed in its `ngSrcset`: its own srcset generation refuses a `sizes` holding pixels), both with a `sizes` matching the tile's rendered width (below 640 px `calc(100vw - 32px)`; above it the cover `min(66vw, 840px)` and the others `min(33vw, 420px)`, from the section's 1,280 px width and the tile bases), the image filling its tile so the tile's size never depends on the image, the ThumbHash as the tile's background (a data URL) until the image paints over it (NgOptimizedImage's own placeholder sits on the image, which stays transparent until it loads), and `priority` (`fetchpriority="high"`, eager) on the cover only, the other tiles lazy. A photo without `imageBase` MUST show its display copy on the cover tile and its thumbnail copy on the others, the first eager and the rest lazy, as before. Alt texts, the full-screen view and its failure handling (310-FR-006 to 310-FR-012) do not change (supersedes 310-FR-004).

_From 1192-photo-variants._

### 310-FR-005 — While the profile is being read the section MUST show grey tiles in the final layout, and a tile whose image fails to load MUST show a neutral placeholder tile while the others still show.

_From 310-photo-gallery._

### 310-FR-006 — Every tile MUST be reachable with Tab, carry the alt text "Fotografie {n} din {total} · {garage}" / "Photo {n} of {total} · {garage}" in the page's language, and open the full-screen view on that photo with Enter, Space or a click.

_From 310-photo-gallery._

### 310-FR-007 — The full-screen view MUST be a Cockpit component built on the Spartan dialog (CDK overlay): modal, over the page, showing the chosen photo's display copy on a full-screen backdrop in the theme's page colour (dark in the dark theme) with the garage's name, "{n} / {total}", previous, next and close controls, and the same alt text as the tile. It MUST trap focus and block scrolling of the page behind it while open, name itself to assistive technology with the garage's name and "{n} / {total}" (announced again when the photo changes), give previous, next and close a touch target of at least 44 px, and show a grey surface in the photo's place while its display copy loads.

_From 310-photo-gallery._

### 310-FR-008 — In the view the left and right arrow keys MUST move to the previous and next photo without wrapping; on a touch screen a horizontal swipe (a pointer move of at least 50 px with |dx| > |dy|) MUST do the same; Esc, the close control or a tap on the backdrop (a pointer down and up on the backdrop element itself, moving less than the swipe threshold) MUST close it, and a tap on the image does nothing. Closing MUST leave the page at the scroll position it had and return keyboard focus to the tile that opened the view.

_From 310-photo-gallery._

### 310-FR-009 — The view MUST preload the next and previous photos' display copies: when it shows photo n, requests for photos n-1 and n+1 (where they exist) have been started, and MUST honour the visitor's reduced-motion setting (no slide or fade when it is set).

_From 310-photo-gallery._

### 310-FR-010 — When `garage.updated` arrives on the profile's `public:garage:{garageId}` subscription the section MUST re-read with the profile (the existing live re-read) and show the new order or set; a view open on a photo MUST stay on that photo when it is still in the list (matched by its id), else show the photo at the same index clamped to the new length, and close when the list is empty. When the tile that opened the view is gone after a re-read, closing returns focus to the section's first remaining tile.

_From 310-photo-gallery._

### 310-FR-011 — When an image in the open view fails to load (an expired address among the causes), the page MUST re-read the profile once and retry that photo from the fresh address; a second failure shows the placeholder and the other photos stay reachable. No more than one re-read per failure.

_From 310-photo-gallery._

### 310-FR-012 — The section and the view MUST show the same photos and texts in Romanian and English, at 320 px and 390 px phones, tablet and desktop, light and dark, with no horizontal scroll at 320 px; the thumbnails wrap or scroll inside the section, never the page.

_From 310-photo-gallery._

### 310-FR-013 — The read MUST stay within the profile's existing cache and live-update rules: the cached answer carries the addresses and is dropped on `garage.updated` as today; the cache's answer shape version is bumped so no older shape without photos is read back. The read performs no write, emits no event and records no audit history.

_From 310-photo-gallery._

### 310-FR-014 — Nothing in this story uploads, reorders or deletes photos (110 and the owner's later dashboard story), and job photos (MF-22) are out of scope; the only new front-end code is the section and the Cockpit viewer, with no new runtime dependency (Principle I, III).

_From 310-photo-gallery._

### 312-FR-001 — The public garage profile MUST show, after its last section, one quiet text link reading "Raportează service-ul" / "Report this garage", only while the session is a driver's or there is no session and the browser last saw no garage-side or admin role (the rule the "Cere ofertă" button already applies); a garage-side or admin role hides it. It MUST be reachable by keyboard and at least 44 px tall as a target.

_From 312-report-garage._

### 312-FR-002 — For a signed-in driver the link MUST open the shared task (`dialog` shape: centred from 768 px, the bottom sheet below, 158-FR-010) titled "Ce s-a întâmplat?" / "What happened?", holding one multi-line text field with a visible 20–1,000 character rule and a live count, a send button "Trimite raportarea" / "Send the report", and the task's usual ways to cancel. Sending MUST show progress and refuse a second press until the answer arrives. The task MUST be operable by keyboard and screen reader: the field has a programmatic label, its error and the outcome lines are announced (live region), focus moves into the task on open and returns to the link on close.

_From 312-report-garage._

### 312-FR-003 — For a visitor with no session the link MUST first open the sign-in gate over the page; once the person is signed in as a driver the report task MUST open on the same profile, at the same address, with no navigation; a cancelled sign-in opens nothing, and a sign-in as an account that is not a driver opens nothing and hides the link.

_From 312-report-garage._

### 312-FR-004 — The task MUST validate the text before sending — fewer than 20 or more than 1,000 characters shows an error under the field and sends nothing — and MUST answer the API's outcomes: 201 closes the task and replaces the link with "Mulțumim. Raportarea a ajuns la echipa MotorFix." / "Thank you. Your report has reached the MotorFix team."; 409 shows "Ai raportat deja acest service." / "You have already reported this garage." in the task; 429 shows "Ai trimis prea multe raportări. Încearcă mai târziu." / "You have sent too many reports. Try again later."; 404 closes the task and hides the link with no message (the server's answer is final); a network failure, a 5xx or any other 4xx keeps the task open with the text kept and offers "Încearcă din nou" / "Try again". Every text exists in Romanian and English.

_From 312-report-garage._

### 384-FR-007 — The public profile read (`GET /api/v1/garages/{slug}`) MUST carry `responseRate`: `{ state: 'new' }` when the garage has no stats row or `lifetime_requests` < RESPONSE_RATE_MIN_REQUESTS (10); `{ state: 'rate', rate: <0..100> }` when `lifetime_requests` ≥ 10 and `requests_30d` > 0; `{ state: 'none' }` when `lifetime_requests` ≥ 10 and `requests_30d` = 0. The answer's cached copy carries it like every other field (307-FR-006); the relay's drop on `response_stats.updated` keeps it current; the cache key's shape version is bumped since the answer's shape changed.

_From 384-response-rate._

### 384-FR-008 — The profile header MUST show, in the text column after the verification line and before the request button, in the same small style as the verification line (same font size, weight and colour token as `.verified`'s text, which the PR QA type measurement compares): for state `rate`, "Răspunde la {rate}% din cereri într-o zi" / "Answers {rate}% of requests within a day"; for state `new`, "Nou pe MotorFix" / "New on MotorFix"; for state `none`, nothing. The texts live in the public texts for both languages; the line is plain text, never colour alone; an in-place change is announced politely without moving focus (307-FR-016).

_From 384-response-rate._

### 384-FR-009 — The open profile MUST re-read its answer when `response_stats.updated` for its garage arrives on the public live stream it already joins (307-FR-017), with no polling of its own.

_From 384-response-rate._

### 143-FR-008 — The web profile page MUST send one beacon per page load with the source taken from the in-app route the visitor came from (the results list, the results map, Home, the saved list), `shared_link` when the address carries `?src=share` (which the shared link of #363 now adds), else `profile_direct`; the results map has no screen yet and is mapped to `map` when it ships; the page MUST NOT wait for the answer, retry, or show any state for it.

_From 143-profile-views._

### 355-FR-001 — The public profile read (`GET /api/v1/garages/{slug}`, with its optional `brand`) MUST carry the garage's price list in the same answer, with no new endpoint: the labour range (both ends in bani, only when both are set) and the list's rows, one per job that is public by the ST-357 rule (357-FR-001 to 357-FR-003) and not left out for the brand in context (FR-003), each with the job's Romanian and English names, its duration in minutes when the default row has one, and the range chosen by FR-002 (both ends in bani). The existing `jobTypes` list, which the quote request reads, is unchanged.

_From 355-price-list-ranges._

### 386-FR-002 — The public read (`GET /api/v1/garages/{slug}?brand=`) MUST give a job the brand's range when the profile is read for a catalogue brand the garage **takes** (`works_on`) and a complete row for that brand exists; in every other case (no brand, another brand, an incomplete brand row, the brand refused or unstated) the default range. This narrows 355-FR-002: a brand row of a brand without a `works_on` row is kept and never used, and applies again when the brand is taken again. Visibility, duration and order stay the default row's, and the ticked-jobs rule of 355-FR-002 is unchanged: once the garage ticked any job for the brand, only the ticked jobs are listed for it.

_From 386-brand-price-range._

### 355-FR-003 — When the profile is read with a catalogue brand for which the garage recorded at least one job tick (a `GarageBrandJob` row for that garage and brand, the tick of specs issue #207), the rows of jobs not ticked for that brand MUST be left out; when the garage recorded no tick for that brand, or the read has no catalogue brand, every public job is listed. A tick never lists a job the ST-357 rule hides.

_From 355-price-list-ranges._

### 355-FR-004 — Rows MUST be in the order of the default row's `position` (the order the garage entered them), as the ST-357 rule orders them; a brand row never moves a job.

_From 355-price-list-ranges._

### 355-FR-005 — The rows and the labour range MUST be served from the profile's cache like the rest of the answer (307-FR-006), per brand in context, and the answer's shape version in the cache key MUST be bumped since its shape changed.

_From 355-price-list-ranges._

### 355-FR-006 — The profile page MUST fill its prices slot with a "Lista de prețuri" / "Price list" section: when the list has at least one row, an intro of two sentences ("Pornește ce ai nevoie. Prețurile sunt intervale, pentru că lucrarea depinde de mașină." / "Switch on what you need. Prices are ranges, because the job depends on the car."), a third sentence "Manopera este {range} / oră." / "Labour is {range} / hour." only when the answer carries a labour range, then the line "Prețurile includ piese și manoperă, cu TVA, și sunt orientative." / "Prices include parts and labour, VAT included, and are a guide.", then the rows.

_From 355-price-list-ranges._

### 355-FR-007 — Each row MUST show the job's name in the page's language (`nameRo` / `nameEn`), its duration when it has one (FR-009), its range (FR-008) and a switch (FR-011).

_From 355-price-list-ranges._

### 355-FR-008 — Every range, labour included, MUST show in whole lei through the shared money range format (019-FR-002): both ends with the language's thousands separator ("1.100–1.700 lei" in Romanian, "1,100–1,700 lei" in English), an en dash, one amount when the ends are equal, and " lei" after. Values stored in bani are rounded to whole lei (never truncated) and shown with no decimals.

_From 355-price-list-ranges._

### 355-FR-009 — A duration MUST read, in both languages: under 60 minutes as "{n} min"; from 60 minutes, a whole number of days (multiples of 480 minutes) as "{d} zi" / "{d} zile" in Romanian ("1 zi", "2 zile") and "{d} day" / "{d} days" in English; otherwise hours as "{h} h" with the remaining minutes after a space when there are any ("1 h", "1 h 5", "1 h 30", "10 h"; the minutes are not zero-padded). A duration of 0 or less, or none, shows nothing.

_From 355-price-list-ranges._

### 355-FR-010 — When the list has no row (no public job, or none for the brand in context), the section MUST show its heading and "Service-ul nu și-a publicat încă prețurile." / "The garage has not published its prices yet." and nothing else.

_From 355-price-list-ranges._

### 356-FR-009 — The switched-on jobs MUST be kept per garage in the browser's session storage (keyed by the garage's id, holding job ids), restored when the same profile opens again in the same browser tab's session and forgotten when the session ends (a new tab starts empty); a job restored that the list does not carry is dropped silently and pruned from storage (what is stored is what is on, so a job hidden for the brand in context does not come back on the default list); a refused or failing storage, or a stored value that is not a list of job ids, leaves the box working for the open page and is treated as nothing on; the server render and the first client render show nothing on, and the stored selection is applied after hydration, so the markup never disagrees with the server's.

_From 356-live-estimate._

### 355-FR-012 — On `price_list.updated` (and every other message the profile already reacts to) the section MUST re-read with the profile, with the same brand, and show the new list in place, keeping the scroll position (307-FR-018). The swap is silent for assistive technology (no live region): the list is not an alert, and the page's other sections re-read the same way.

_From 355-price-list-ranges._

### 355-FR-013 — While the profile is being read the section MUST show its skeleton like the other sections (307-FR-015); a 404 or 410 shows the profile's own views, with no section.

_From 355-price-list-ranges._

### 355-FR-014 — The section MUST render at 320 px and 390 px (stacked rows), tablet and desktop, light and dark, Romanian and English, with no sideways scroll, and its texts MUST live in the public texts for both languages (307-FR-016); a job's name is the catalogue's text and is not translated by the page.

_From 355-price-list-ranges._

### 355-FR-015 — The development data MUST hold, for one approved seeded garage, a labour range and the six jobs of the mock with their default ranges and durations, one of them with no top price, a BMW range for front brakes and a BMW tick list that leaves out "Kit lanț de distribuție", so the acceptance scenarios run end to end against the development catalogue (as 230-FR-015 did for brands).

_From 355-price-list-ranges._

### 355-FR-016 — Accessibility of the section MUST be stated and measurable: the section is a named region holding an `h2` heading (the profile's heading level for sections); each switch is reachable and operable with the keyboard (Tab, Space), shows a visible focus ring, exposes the switch role and its on/off state, and is named by its job's name; the whole row is its click target, at least 44 px high; every text and the range in both states (on, off) meets 4.5:1 contrast against the card in light and dark (the PR QA sweep's axe and contrast checks); the on state is also carried by the switch itself, never by the range's colour alone.

_From 355-price-list-ranges._

### 1169-FR-008 — The pre-fetched answer MUST be kept in one root-level store keyed by slug and brand with its fetch time; the profile page, when opened with a matching entry younger than 120 s, MUST draw from it with no first read, then join the garage's live stream and re-read on its messages as today; an older or missing entry leaves the page's reads as today. A profile that answered not found or gone is remembered in the store for 120 s and not fetched again on another signal.

_From 1169-prefetch-intent._

### 1235-FR-001 — The profile read MUST look up a brand the catalogue does not hold under the no-brand key, so a repeat of the same or any other made-up brand is served from that one entry.

_From 1235-unknown-brand-cache._

### 1235-FR-002 — A brand the catalogue holds, active or retired, MUST keep its own profile entry and its brand in context.

_From 1235-unknown-brand-cache._

### 1235-FR-003 — The brand a profile read names MUST be looked up through the cache service (kind `brands`, one entry per slug: a held brand kept 10 minutes, a slug no brand holds remembered 60 seconds as none), so a repeat read with the same brand, held or not, costs no PostgreSQL read, and a made-up brand adds no profile entry.

_From 1235-unknown-brand-cache._

### 290-FR-009 — The garage profile header (Mechanic / MGarage boards, 307-FR-010) MUST show, for a signed-in driver or a visitor, a save button next to the share button's place: an outline bookmark icon with "Salvează" / "Save" when not saved, a filled bookmark with "Salvat" / "Saved" when saved (`aria-pressed` reflecting it). In the garage, receptionist, mechanic or admin role in use the button MUST be absent.

_From 290-save-garage._

### 290-FR-011 — For a signed-in driver the web app MUST read the saved ids (FR-005) once per activation of a profile or results route, into one store shared by every control on the page that saves and removals update in place, and show the saved state on every profile button and card from that answer; until the answer arrives the controls read "Salvează" and are usable. For a visitor no read is made.

_From 290-save-garage._

### 290-FR-012 — Tapping save MUST be optimistic: the control shows the saved state at once and the save is sent; on 201 or 200 a toast "Salvat în Service-uri salvate" / "Saved to Saved garages" shows. A tap on a control whose save or removal for that garage is still in flight does nothing (the control keeps its look). On an error the control goes back and a toast explains why in the person's language: 404 replaces the control with the text "Indisponibil" / "Unavailable" and shows no toast; a failed connection shows "Fără conexiune" / "No connection"; any other error the shared error text.

_From 290-save-garage._

### 290-FR-013 — Tapping a saved control MUST remove the garage at once (optimistic) and show an undo bar "Scos din salvate · Anulează" / "Removed from saved · Undo" for 8 seconds; "Anulează" sends the save again with the removed row's `savedAt` (FR-002, from the 200 of FR-004) and the control shows the saved state; a 422 or any other error goes back to "Salvează" with the error toast. A new removal replaces an undo bar still showing. A removal that fails puts the control back to "Salvat", dismisses the bar and shows the error toast; "Anulează" tapped before the removal answered waits for it, then sends the save (with no body when the removal answered 204). The undo bar is announced to assistive technology and its "Anulează" is reachable and operable by keyboard.

_From 290-save-garage._

### 290-FR-014 — For a visitor, tapping either control MUST open the sign-in dialog over the page, sending nothing before. When the dialog resolves "signed in" (080-FR-013) for an account with the `driver` role, the page stays where it is and the tapped garage is saved as FR-012; when the sign-in goes through an outside provider, which leaves the page and returns to it (083-FR-009), the tapped garage is kept for this browser tab and saved once the returned page shows its control to a driver; for an account without that role, nothing is sent and the controls are hidden. A dialog closed without signing in saves nothing.

_From 290-save-garage._

### 290-FR-015 — The texts MUST live in the public texts for both languages and the screens MUST render well at 320 px and 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll (307-FR-016, 267-FR-016).

_From 290-save-garage._

### 386-FR-003 — Story #75's estimate MUST get the chosen range from the same public rows (FR-002); this story adds no second choice and no estimate of its own.

_From 386-brand-price-range._

### 311-FR-009 — From 1024 px, the profile's sections MUST lay out in two columns: a main column (photos, brands, mechanics, prices, reviews, in today's order) and a side column (the estimate box, then the `where` slot) that sticks under the site bar while the main column scrolls, and scrolls inside itself when taller than the window below the site bar; the side column exists only when the estimate box or the `where` slot has content, else the main column takes the full width; from 768 to 1023 px and below 768 px the page stays one column as today.

_From 311-estimate-within-reach._

### 356-FR-002 — The box MUST list every switched-on job (355-FR-011) in the list's order, each with its name in the page's language and the range the list shows for it (355-FR-002, 355-FR-008), and nothing else about jobs that are off.

_From 356-live-estimate._

### 356-FR-003 — The totals MUST be, in bani, the sum of the `fromBani` of the switched-on rows and the sum of their `toBani`, each row's range being the one the profile answer carries for the brand in context (the brand's range where the garage set one, else the default; 355-FR-002), shown as whole lei through the shared money format (019-FR-002: "1.040" in Romanian, "1,040" in English), labelled "DE LA" / "FROM" and "PÂNĂ LA" / "TO" (the mock's English); with nothing on both are 0.

_From 356-live-estimate._

### 356-FR-004 — The totals MUST be shown in the Cockpit odometer (the shared rolling-digit component) as digit cells only, padded with leading zeros to 5 places and, each total on its own, to 6 places when it is above 99.999 lei (the mock: "01040", no group separator in the cells, the leading zeros dimmed, "LEI" written once after both totals); the digits roll to the new value on every switch change, and under the person's reduced-motion setting there is no roll, only the new number (the theme's reduced-motion rule).

_From 356-live-estimate._

### 356-FR-005 — The totals block MUST read to assistive technology as one sentence, "Estimare de la {from} la {to} lei" / "Estimate from {from} to {to} lei", both amounts in the shared money format (019-FR-002), and the box MUST hold exactly one polite live region, which carries that sentence once after each switch change; the digit cells and the odometers' own live texts are hidden from assistive technology; when the last job is switched off the live region carries the empty text (FR-006) once instead; on load nothing is announced.

_From 356-live-estimate._

### 356-FR-006 — With nothing switched on the box MUST show "Pornește lucrările de care ai nevoie în lista de prețuri și contorul le adună." / "Switch on the jobs you need in the price list and the counter adds them up." in place of the job rows, with the totals at 0 and the button still shown.

_From 356-live-estimate._

### 356-FR-007 — Under the button the box MUST always show "Unde ajungi în interval depinde de mașină. Service-ul confirmă după ce o vede." / "Where you land in the range depends on your car. The garage confirms once it has seen it." (the brief and the mock show it with or without jobs on).

_From 356-live-estimate._

### 356-FR-008 — The box MUST show the line "Mecanic: Orice mecanic" / "Mechanic: Any mechanic"; it is a preference, not a choice, and no control changes it in this story (picking one is #107; hiding the line when the garage's team feature is off waits for the profile answer to carry that flag, which #107 adds).

_From 356-live-estimate._

### 356-FR-010 — On a re-read of the profile (355-FR-012) a switched-on job no longer listed MUST be switched off and leave the box and the stored selection at once, the totals following; the box MUST then show, until the next switch change, "O lucrare pornită nu mai este oferită de service." / "A job you switched on is no longer offered by the garage." as visible text that the box's one polite live region (FR-005) carries once, so the box never holds a second live region; a job still listed keeps its state and takes its new range.

_From 356-live-estimate._

### 356-FR-011 — The box MUST hold a "CERE OFERTĂ" / "REQUEST A QUOTE" button that opens the profile's existing request dialog for this garage with the switched-on jobs ticked (the dialog's `jobTypeIds` prefilled; ids are the catalogue job ids, the same in the list and in `jobTypes`) and, when nothing is on, with no job ticked and the description field focused; it follows the header button's rules unchanged: shown to a visitor or a driver only, disabled with the same note when the page's brand is refused, the same sign-in demand for a visitor, the same `quote_request_started` analytics event with `source: profile`; the selection is left as it is when the dialog is closed or a request is sent, and the dialog's own focus return on close is unchanged.

_From 356-live-estimate._

### 356-FR-012 — The box MUST render at 320 px and 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll, with its texts in the public texts for both languages (307-FR-016); the box is a named region with an `h2` heading (the profile's section heading level); the button is reachable by keyboard with a visible focus ring; every text, the rows and the digits meet 4.5:1 contrast against the box in light and dark (the PR QA sweep's axe and contrast checks).

_From 356-live-estimate._

### 356-FR-013 — Nothing is written to the server and no event is emitted: the box reads the profile answer the page already holds and re-reads with it; it adds no endpoint, no metric, no dashboard panel and no alert (`infra/observability/inventory.json` unchanged).

_From 356-live-estimate._

### 356-FR-014 — The end-to-end walk MUST run against the seeded garage (`service-auto-militari`, 355-FR-015): for BMW, switch on diagnosis and front brakes and read 1.250 and 1.920 lei; switch brakes off and read 150 and 220 lei; unit tests cover the sums with default and brand ranges, switching off, nothing on, a job removed by a re-read, the session storage round trip and the hand-over to the dialog.

_From 356-live-estimate._

### 271-FR-014 — The profile read `GET /api/v1/garages/{slug}` MUST accept the optional `near={lat},{lng}` with the search's validation (229-FR-009: 400 `validation_failed` when malformed or outside Romania) and, with it, carry `distanceKm` (one decimal, the shared rule of FR-010) for a fixed garage; a mobile mechanic and a read without `near` carry no `distanceKm`. The distance MUST be computed per request after the cached answer is read, so the shared profile cache key (307-FR-006) never holds a distance, and the place is never stored on the server. The key-set test of 307-FR-005 MUST cover the read with `near` for a fixed and a mobile garage.

_From 271-garage-distance._

### 311-FR-001 — Below 768 px, the profile page MUST show a bar fixed above the public tab bar (and above the consent bar while it is shown) on every profile that has a request button to show (a visitor or a driver, 356-FR-011); while the profile loads, is unknown or removed, and for a signed-in garage-side account, no bar is rendered; from 768 px the bar's markup stays (FR-010) but is not shown and not announced (`display: none`). Below 768 px it is shown wherever the page stands, the in-page box on screen or not.

_From 311-estimate-within-reach._

### 311-FR-002 — The bar MUST hold, left, the running total as the estimate box's totals written through the shared whole-lei range format ("1.040–1.620 lei" / "1,040–1,620 lei") and, right, the estimate's "CERE OFERTĂ" / "REQUEST A QUOTE" button; the total reads the shared selection and the ranges the page holds, exactly as the box does (356-FR-003), and computes nothing of its own: the box and the bar call one shared pure totals function kept beside the shared selection.

_From 311-estimate-within-reach._

### 311-FR-003 — With nothing switched on, the total's place MUST read "Alege lucrările" / "Pick the jobs"; when the garage lists no public job the bar MUST show only the button; until the stored selection is applied after hydration the total's place MUST hold a placeholder (no text, hidden from assistive technology).

_From 311-estimate-within-reach._

### 311-FR-004 — The bar's button MUST be the profile's request button with the estimate box's inputs and rules (356-FR-011): the switched-on jobs ticked, or none and the description focused; disabled and described by the refusal text when the page's brand is refused; the same analytics event with `source: profile`; its sent line stays in the bar's own status. After a send from the bar or the sheet, the sheet stays open, the selection is unchanged and only the button that sent speaks.

_From 311-estimate-within-reach._

### 311-FR-005 — The total (or the empty text) MUST be a button, named "Estimare de la {from} la {to} lei" / "Estimate from {from} to {to} lei" (the box's sentence, 356-FR-005) or the empty text, that opens the estimate box as a bottom sheet through the overlay service with the title "Estimarea ta" / "Your estimate" (158-FR-001 to FR-009: grip, X, Escape, outside, scroll lock and position kept); the sheet holds the same box as the page (rows, mechanic line, totals, button, note) without a second heading; the sheet's button opens the request dialog on top (157-FR-011); when the garage lists no public job there is no total to tap and no sheet.

_From 311-estimate-within-reach._

### 311-FR-006 — While a text field has focus (287-FR-009's definition) the bar MUST be hidden, not announced and not focusable, and show again when focus leaves.

_From 311-estimate-within-reach._

### 311-FR-007 — The bar MUST publish its measured height as `--estimate-bar` on the document (as the consent bar publishes `--consent-bar`) and sit at `bottom: calc(var(--tab-bar) + var(--consent-bar, 0px))` above the page and below every overlay (the sheet, the request dialog and the sign-in dialog cover it); the page MUST get bottom padding equal to that height while the bar is shown, so the page's last content (the report link) is reachable above it; the bar MUST respect the bottom safe-area inset: it rests on the tab bar, which already holds the inset, and adds none of its own (every route that shows the bar has the tab bar; see Edge Cases).

_From 311-estimate-within-reach._

### 311-FR-008 — The bar's smallest text MUST be at least 12 px, its buttons at least 44 × 44 px, its total in tabular figures; it MUST fit 320 px without sideways scroll, with the button's label wrapping rather than cut (286-FR-002, FR-003, FR-004, FR-006); it MUST pass axe and 4.5:1 contrast in light and dark, Romanian and English; the total wraps onto a second line rather than being cut or shrunk below 12 px, and the bar stays readable at 200% text size without sideways scroll; both of its buttons show the kit's visible focus ring and are reached in reading order (total, then "CERE OFERTĂ"); the total's changes are not announced as a live region (the button's name carries the current sum, read when it is focused), only the request button's own sent status is.

_From 311-estimate-within-reach._

### 311-FR-010 — The server render and the first client render MUST agree with each other (no hydration mismatch): the bar's markup is rendered on the server and hidden by width, and the total's placeholder is what both show until the selection is applied.

_From 311-estimate-within-reach._

### 311-FR-011 — Every new text (the empty text, the total button's name if it differs from the box's sentence, the sheet's title) MUST live in the public texts for both languages; the bar and the sheet reuse the estimate's existing keys wherever one exists.

_From 311-estimate-within-reach._

### 311-FR-012 — Nothing is written to the server and no event is emitted; the story adds no endpoint, metric, dashboard panel or alert (`infra/observability/inventory.json` unchanged).

_From 311-estimate-within-reach._

### 311-FR-013 — Tests: component tests cover the bar shown on a phone only, hidden while a text field has focus, the empty text with nothing on, the placeholder before the selection is applied, the button alone with no public job, no bar for a garage-side role and the sheet opening on the total; the end-to-end walk, at 375 × 812 on the seeded garage, switches two jobs on, scrolls to the end, checks the button is inside the viewport and opens the request, then taps the total and sees the sheet (brief Tests).

_From 311-estimate-within-reach._

### 330-FR-007 — On a cache miss, the public profile read MUST obtain everything the answer needs in exactly one PostgreSQL statement, as 1183-FR-001 states, with "the courtesy-car facility" replaced by every facility row in status `listed` and the facilities note; the query-count integration test keeps asserting one statement.

_From 330-listed-facilities._

### 1183-FR-002 — The same statement MUST also return the status of a garage that is not publicly listed, so that the 404 `not_found` / 410 `gone` verdict of 307-FR-001 needs no second statement; the verdict rules themselves do not change.

_From 1183-garage-profile-page._

### 1183-FR-003 — The answer MUST be the same `PublicGarageDto` as today, field for field and value for value, for every existing case: every public-garages integration spec, the key allow-list and forbidden-list test (307-FR-005), the brand variants (307-FR-003), the photo, price, response-rate and verification cases MUST pass unchanged. The contract in `libs/contracts`, `apps/api/openapi.json` and the generated client do not change.

_From 1183-garage-profile-page._

### 1183-FR-004 — The statement's garage filter MUST come from one shared public scope exported beside the existing `publicGarages()` scope, in its SQL form, and that export MUST be the only way a raw SQL read scopes a visitor's or driver's garage read: every reachable raw read that filters on status inline today switches to it. The two forms (query-builder and SQL) MUST express the same condition, and a test MUST prove they agree on the same fixture of garages across every status.

_From 1183-garage-profile-page._

### 1183-FR-005 — After `garage.updated`, `price_list.updated`, or a published `verification.decided` for a garage, the next profile read MUST show the change within 5 s, through the existing purge by audience (1182-FR-007). One integration test per emitting event kind MUST make the write through the emitting service, drive the relay once in-process (as 1182's purge tests do) and read the changed value at once; the 5 s bound is the relay's, cited from 1182. `facility.*` is covered by the same audience rule once an emitter exists; none does today (Assumptions).

_From 1183-garage-profile-page._

### 1183-FR-007 — The public-scope spec MUST check every read of the garage table reachable by a non-staff actor. Entry points are: every controller handler in `apps/` and `libs/` that a visitor or driver can reach (marked `@Public()`, carrying no `@Requires`, or `@Requires('driver.*')`; only an effective staff capability, `@Requires('garage.*')` / `@Requires('admin.*')` resolved per handler with the method over the class, excludes it; the app-wide `ActorGuard` is no class-level guard) and every assistant tool in `libs/mcp-tools` whose `capability` is absent or `driver.*`. From each it MUST follow `this.x()` and `this.field.x()` calls and calls to plain functions in the same module, and it MUST see raw SQL reads of the garage table (`$queryRaw` and `Prisma.sql` templates) as well as Prisma `garage.find*`/`count` calls. Each legitimate exception (a read that deliberately returns unlisted garages, such as saved garages' `available` flag) MUST be listed in the spec with its reason.

_From 1183-garage-profile-page._

### 1183-FR-008 — The scope spec MUST fail on a deliberately unscoped garage read placed in a non-controller service and reached from such an entry point, and on an unscoped raw SQL garage read, each proven by a fixture test that names the offending file and line; the spec run on the real tree MUST pass.

_From 1183-garage-profile-page._

### 1183-FR-009 — The page MUST keep making one unauthenticated profile call and none in the browser after hydration: the existing `apps/web-e2e/src/transfer-cache.spec.ts` stays the proof and MUST pass unchanged; PR QA's network log of the profile route is the second proof. No new route, path or `lang` parameter is added (Assumptions).

_From 1183-garage-profile-page._

### 1353-FR-004 — After a valid re-check, the next profile read MUST show the new date through the existing purge by audience (1182-FR-007, 1183-FR-005); this story MUST add no purge, relay rule or channel of its own.

_From 1353-verified-badge-last-check._

### 1353-FR-005 — The story MUST write nothing (no audit entry, no event, no field) and add no endpoint, service, queue or outside call; the DTO description change lives in the contracts library, the OpenAPI document and the generated client are regenerated when it changes (Principle V).

_From 1353-verified-badge-last-check._

### 1353-FR-006 — Tests MUST exist before the code (Principle II). Jest on real PostgreSQL and Redis: the profile's `verifiedAt` equals the stored date of last check after an approval and after a valid re-check recorded through the re-check use case, and the approval instant when the stored date is empty; `recheck.recorded`, written through the re-check use case, reaches `public:garage:{garageId}` and, the relay driven once in-process, the next profile read shows the new date (the 1183-FR-005 pattern). Web unit tests: the line in Romanian and in English for a seeded date, absent without one; the page re-reads on `recheck.recorded` and switches to the "no longer available" view when the re-read answers 410. Playwright: with Atelier Dinamo's profile open, record a valid re-check as the seeded admin in another session and see the line's date change without a reload. The four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 1353-verified-badge-last-check._

### 330-FR-005 — The public read of an approved garage (`GET /api/v1/garages/:slug`) MUST carry `facilities` — every facility of the garage with status `listed`, in catalogue order (`courtesy_car`, `pickup_dropoff`, `waiting_area`) — always present (empty when none), and `facilitiesNote`, a string, when the garage has one (absent otherwise); the courtesy car's terms stay as 397-FR-012 defines them, now shown only when `courtesy_car` is listed.

_From 330-listed-facilities._

### 1192-FR-006 — `GET /api/v1/images/g/{owner}/{digest}/{file}` MUST be public (no session, `@Public()`, on the public-routes list) and answer a variant's bytes with its content type and `Cache-Control: public, max-age=31536000, immutable` and `CDN-Tag: garage:<garage id>` (so the purge every `garage.updated` already sends to the CDN drops a removed photo's cached variants, the one case that needs a purge) only when `{owner}` is a valid owner id, `{digest}` 64 lowercase hex characters, `{file}` one of the eight `<width>.<avif|webp>` names, and a gallery row of an approved garage holds the variant path; otherwise it MUST answer 404 `not_found` with `Cache-Control: no-store` and read no object (a draft's photos stay unreachable without the draft's token, 110-FR-012). A held path whose object is missing in the store also answers that 404; a store that cannot be read answers 503 `storage_unavailable` with `Cache-Control: no-store`. A refused address costs at most one indexed lookup (none for a malformed one); the route carries no rate limit of its own, as the CDN answers repeat reads. The API never resizes or re-encodes at read time.

_From 1192-photo-variants._

### 1192-FR-007 — The public profile read MUST add, for each photo whose row has a variant path, `imageBase` (the image host's base address followed by `/g/<owner id>/<digest>`, no trailing slash, so a variant's address is `<imageBase>/<width>.<avif|webp>`) and `thumbhash`; the widths are the fixed list shared by the API and the web app. Photos without one answer as today. The answer still never carries a storage key, bucket or the original's path (310-FR-001); the variant path is a public address, not a storage key of the original. The profile cache's shape version MUST be bumped (310-FR-013).

_From 1192-photo-variants._

### 1192-FR-008 — The image host's base address MUST come from the optional `IMAGE_BASE_URL` of the API (the `img.` host behind the CDN in production), defaulting to `/api/v1/images` so the web app's own origin serves variants where no image host exists (local, CI, PR QA). A value that is not an absolute `https:`/`http:` URL or a path starting with `/` is refused at boot. The CDN configuration (`infra/cdn/bunny.json`) MUST exempt `*/api/v1/images/*` from the edge rule that stops caching `/api/` in every environment, so the CDN keeps variants by their `Cache-Control`; a signed-in viewer's requests still bypass the CDN (the browser cache keeps them).

_From 1192-photo-variants._

### 308-FR-001 — The public profile read (`GET /api/v1/garages/{slug}`, with its optional `brand`) MUST carry the garage's weekly opening hours as entered — for each weekday Monday to Sunday the list of its intervals, each a start and an end on the 24-hour Europe/Bucharest clock, at most two a day, an empty list for a closed day — present for every approved garage, workshop or mobile mechanic, and empty when the garage never sent its hours (the profile renders an empty table as no hours lines, never as the default week the booking rule assumes). No new endpoint is added; the shared contract's hours type is reused; the generated client is regenerated.

_From 308-profile-details._

### 309-FR-007 — The closed days MUST be read in the profile's existing read path and served from the profile's cache per brand in context (307-FR-006, 1182-FR-007): the cached answer carries the list, the answer's shape version in the cache key MUST be bumped so no older answer without it is read back, and the cache's own lifetime bounds how far "today" can drift inside a cached answer (the window of FR-006 starts at the day the answer was built; the browser evaluates on its own clock, so a day that slid out of the window is simply not consulted, and a day that slid in is at most the cache's lifetime away). The read performs no write, emits no event and records no audit history (modifies 308-FR-003: the shape version moves once more).

_From 309-open-now-directions._

### 308-FR-004 — The profile page MUST fill its brands slot with "Lucrează pe" / "Works on": one chip per brand of `worksOn`, each a green lamp carrying the brand's name as text, and "Nu lucrează pe" / "Does not work on": one chip per brand of `doesNotTake`, each a red lamp carrying the name. A brand with no row (unstated) is in neither list. The stance is carried by the section heading, with the brand's name as the chip's visible text and the lamp `aria-hidden`, as the header lamp does (307-FR-016); no per-chip screen-reader string; never by colour alone.

_From 308-profile-details._

### 308-FR-005 — The brand in context (the `brand` of the answer, when its id is in a list) MUST be the first chip of its list; every other chip keeps the answer's order (the catalogue's: popularity rank, unranked after, then name). The page sorts nothing else.

_From 308-profile-details._

### 025-FR-016 — On the public garage profile, below 768 px wide, the fuel line under each "Lucrează pe" chip MUST render at the body text size (at least 16 px); at 768 px and above it keeps today's small size. A Jest spec reading the section's stylesheet MUST pin the phone override, and no other text of the section changes size.

_From 025-review-mechanic._

### 308-FR-007 — After the two lists the page MUST show the garage's brand note as written when the answer carries one, and no note line when it does not. "Nu lucrează pe" MUST be hidden when `doesNotTake` is empty, and "Lucrează pe" when `worksOn` is empty; with both empty the brands slot shows nothing.

_From 308-profile-details._

### 308-FR-008 — The page MUST show a "Facilități" / "Facilities" section listing, in the answer's catalogue order, each facility of `facilities` with its label: `courtesy_car` "Mașină la schimb" / "Courtesy car", `pickup_dropoff` "Preluare și predare" / "Pick-up and drop-off", `waiting_area` "Sală de așteptare" / "Waiting area". Only facilities the answer carries (status `listed`) are shown; a facility an admin removed, or that the garage never declared, is absent.

_From 308-profile-details._

### 308-FR-009 — The courtesy car's label MUST carry its terms: " · gratuit" / " · free" when `courtesyCar.paid` is false, and " · {price} / zi" / " · {price} / day" when true, with the price in whole lei formatted by the money rule (019-FR-001: "150 lei", "1.500 lei" in Romanian, "1,500 lei" in English) from `pricePerDayBani`; a paid car with no price shows the bare label.

_From 308-profile-details._

### 308-FR-010 — The section MUST show one line "Plată: {methods}" / "Payment: {methods}" listing the ticked methods of `paymentMethods` in the fixed order cash, card, transfer, named "numerar", "card", "transfer" / "cash", "card", "transfer" and separated by ", "; the line is hidden when none is ticked. The facilities note MUST be shown as written after the facilities and the payment line when the answer carries one. The whole section MUST be hidden when there is no listed facility, no payment method and no facilities note; a facilities note alone still shows the section (autonomous default: the garage wrote it, so it is not dropped).

_From 308-profile-details._

### 1366-FR-001 — For a workshop (`businessKind` other than `mobile`) whose profile answer carries `latitude` and `longitude`, "Unde" MUST show, as the section's first element above the heading and the address (the Garage profile board's map strip, design.md), a small map of the garage's surroundings with one pin at the garage, using ST-1196's static-first piece (1196-FR-018): the static image from `GET /api/v1/maps/static`, the pin drawn in the browser over it, the control and the attribution, the image set in the browser after the first measure of the box (1196-FR-013) and the server render showing the placeholder only. The rest of 308-FR-011 is unchanged: the address first, the hours lines, the mobile mechanic's line.

_From 1366-garage-map-directions._

### 308-FR-012 — The hours MUST be shown Monday first, one line per run of one or more consecutive days with identical intervals: a run of two or more days reads "{first} – {last}" ("Luni – vineri", "Monday – Friday"), a single day its name ("Sâmbătă", "Saturday"), day names in the language's full form with Romanian in lower case after the first word; the intervals follow as "{start} – {end}" in 24-hour two-digit times (019-FR-006), two intervals joined by ", " ("08:00 – 12:00, 13:00 – 19:00"); a day with no interval reads "Închis" / "Closed". Empty or malformed hours show no hours line.

_From 308-profile-details._

### 308-FR-013 — When the public read answers a garage whose address change waits for an admin, the answer and "Unde" MUST carry the last approved address: the public read serves the garage record's address, which is the approved one (207-FR-007 makes an address change a new approval, and the editing story keeps the pending value apart from it); a test MUST pin that the read serves the garage record's stored `address` column; no pending-address model is built here (#18 owns it).

_From 308-profile-details._

### 308-FR-014 — The three sections MUST re-read with the profile on the messages it already reacts to on `public:garage:{garageId}` — `garage.updated`, `facility.removed`, `facility.re_add_decided` among them — and show the new values in place with the brand, the place and the scroll position kept (307-FR-018), with no reload and no polling of their own; the swap is silent for assistive technology, like the price list's (355-FR-012).

_From 308-profile-details._

### 308-FR-015 — The sections MUST render at 320 px and 390 px (stacked, "Unde" after the main column), tablet and desktop ("Unde" in the side column), light and dark, Romanian and English, with no sideways scroll; every label of this story MUST live in the public texts for both languages and switch with the language without a reload; text the garage wrote (the address, the brand note, the facilities note) is shown as written in both languages (307-FR-016). Chips and lines are plain text, with no control inside them, so no touch-target rule applies beyond the page's.

_From 308-profile-details._

### 308-FR-016 — Tests MUST cover, in Jest: the public read's two brand lists from each stance and a brand with no row in neither; the fuels per taken brand (three ticked, and all four by default); `hours` in the answer with the key allow-list; a facility that is not `listed` left out; the courtesy car's wording free and paid, and the payment line with one, two and no methods; a mobile mechanic's answer without any address field, the seat included, and its area text with and without a radius; the hours grouping (the scenarios of User Story 2, a two-day run, a whole week, a lunch break, closed days, empty and malformed hours); the brand in context first; the read serving the stored address. End to end (Playwright): list a garage with two taken brands, one refused brand, a paid courtesy car and card payment, enter explicit opening hours (not the default week), approve it, and the profile shows exactly what was entered. Every test file names its requirements in a `// @traces` line.

_From 308-profile-details._

### 308-FR-017 — The feature adds no service, queue, outside call, endpoint or product action: the observability inventory is unchanged, and this is recorded in the PR.

_From 308-profile-details._

### 024-FR-001 — The public garage profile MUST show a "Ce spun șoferii" / "What drivers say" section in the page's `reviews` slot (after the prices, in the main column from 1024 px, 311-FR-009), visible to everyone, signed in or not, with the same content for both.

_From 024-garage-reviews._

### 024-FR-002 — The section MUST show the garage's rating with one decimal in the language's separator ("4,9" / "4.9", 019-FR-003), its review count ("212 recenzii" / "212 reviews", with the singular for 1), and the breakdown: for each star value from five to one, its label ("5 stele" … "2 stele", "1 stea" / "5 stars" … "1 star") and the number of published reviews with that rating. A garage with no published review shows "—" for the rating, "Încă nu are recenzii." / "No reviews yet." and no breakdown rows.

_From 024-garage-reviews._

### 024-FR-003 — The rating and the count MUST be the garage's stored figures (written by the ratings job, 025-FR-006); the breakdown MUST be counted from the garage's `published` reviews on each read, in the same answer as the list, so the five counts add up to that answer's `total`. The empty state shows when `total` is 0; the rating shows "—" when the stored rating is null; the count line shows the stored count.

_From 024-garage-reviews._

### 024-FR-011 — The open profile MUST re-read the section (its first page, dropping the extra pages) when any `review.*` or `rating.*` message for its garage arrives on the `public:garage:{garageId}` stream it already joins (307-FR-017), and after the stream reopens (256-FR-002), with no polling of its own; the re-read swaps the content in place, keeps the scroll position (307-FR-018) and is silent for assistive technology (a re-read that starts while a "Vezi mai multe" page is loading replaces it: the last answer to arrive for the newest request wins), except that the rating's in-place change is announced politely as the header's dial already is (307-FR-016).

_From 024-garage-reviews._

### 024-FR-012 — While the section has no answer yet (a client-side navigation to the profile) it MUST show a skeleton hidden from assistive technology, never over content already shown; when the read fails (network or 5xx) it MUST show "Nu am putut încărca recenziile" / "We could not load the reviews" with "Încearcă din nou" / "Try again", which reads again (also when the server-side first read failed); a failed re-read keeps the last shown content; a failed "Vezi mai multe" keeps the loaded pages and shows the error line with "Încearcă din nou" in the button's place.

_From 024-garage-reviews._

### 024-FR-013 — The section MUST render at 320 px and 390 px, tablet and desktop, light and dark, Romanian and English with no sideways scroll; "Vezi mai multe" and "Încearcă din nou" are reachable by keyboard with a visible focus and a touch target of at least 44 px under 640 px; the breakdown is readable as text, never colour alone (307-FR-016).

_From 024-garage-reviews._

### 024-FR-014 — The section MUST be a web component of its own folder under the garage profile, rendered on the server with the profile's first page as the rest of the page is, and MUST join no stream of its own.

_From 024-garage-reviews._

### 024-FR-015 — The mock's "Scrie o recenzie" button MUST NOT be added by this story (removed while `reviews_only_after_confirmed_job` is on; ST-22's button covers the off case).

_From 024-garage-reviews._
### 309-FR-001 — The status rule MUST be one pure, browser-safe function in the shared contracts library (beside the hours types; no server-framework, validator or database import), taking the garage's weekly hours, the list of closed days ahead (each a Bucharest date with its reason, `holiday` or `closed`) and the instant "now", and answering one of: no line; open until a time of today; on a break until a time of today; closed, with the reason for today (`hours`, `holiday` or `closed`) and the next opening (the day's offset from today, 0 to 14, and its start time), or closed with no opening in the window. It MUST be usable unchanged by #210's "open now" filter (decided in #864).

_From 309-open-now-directions._

### 309-FR-002 — Every time MUST be worked out on the Europe/Bucharest wall clock, including the nights of the March and October clock changes: "today" is the Bucharest date of now, a weekday is the Bucharest weekday, and the hours' "HH:MM" ends are read on that clock.

_From 309-open-now-directions._

### 309-FR-003 — The rule for a day MUST be, in this order: a legal holiday or a garage closed day closes the whole day; otherwise the day's intervals apply, and a day with no interval is closed. A garage whose hours table is empty, or fails the contracts library's existing weekly-hours guard (`isWeeklyHours`, the one check), gets no line.

_From 309-open-now-directions._

### 309-FR-004 — Intervals are half-open, [start, end): 08:00:00 is open, 19:00:00 is closed. Now inside an interval MUST answer open until that interval's end; now after one interval of today and before the next MUST answer a break until the next interval's start; otherwise the garage is closed and the next opening is the start of the first interval of the first day, today included, from now through today + 14 that is neither a holiday nor a closed day and has an interval starting after now (today) or at all (a later day). With no such day the rule answers closed with no opening, and the page shows no line. The rule trusts only the closed days it is given: a day past the answer's window (a cached answer, a tab left open for days) is not known to it, and that drift is accepted.

_From 309-open-now-directions._

### 309-FR-005 — The line's texts MUST be, Romanian / English, from the public texts of both languages: open "Deschis azi până la {end}" / "Open today until {end}"; break "Pauză până la {start}" / "Break until {start}"; closed by hours "Închis acum · deschide {when} la {start}" / "Closed now · opens {when} at {start}"; closed by a holiday "Închis azi · sărbătoare legală · deschide {when} la {start}" / "Closed today · public holiday · opens {when} at {start}"; closed by a garage closed day "Închis azi · deschide {when} la {start}" / "Closed today · opens {when} at {start}". `{when}` is "azi" / "today" for an opening later today, "mâine" / "tomorrow" for one day ahead, the weekday's name in the language's full form (Romanian lower case: "luni"; English capitalised: "Monday") for two to six days ahead, and from seven days ahead the date as "pe {d} {month}" / "on {d} {month}", the day unpadded and first, the month's full name (Romanian lower case): "pe 5 noiembrie" / "on 5 November". Times are 24-hour two-digit (019-FR-006). The middle dot is " · " (a middle dot between ordinary spaces), as the header's other lines use.

_From 309-open-now-directions._

### 309-FR-009 — The profile header MUST show the line as one short text in the header's text column, where the mock places "Deschis azi până la 19:00" (under the name and place line, before the verification line), for a workshop and for a mobile mechanic alike; the line MUST be absent, leaving no empty space, when the rule answers no line. The line is plain text with no control, so no touch-target rule applies; it is not announced on each change (no live region), the way the header's other lines are silent (307-FR-016).

_From 309-open-now-directions._

### 309-FR-010 — The server render MUST draw the line once on the server's clock; in the browser the page MUST evaluate it again at start and then once a minute, on the browser's clock, from the answer it already holds, with no request of its own; the timer stops when the page is left.

_From 309-open-now-directions._

### 309-FR-011 — When `garage.updated` arrives on the profile's `public:garage:{garageId}` subscription the line MUST re-read with the profile (the existing live re-read, 307-FR-018, 310-FR-010) and show the new state in place, with no reload and no polling of its own.

_From 309-open-now-directions._

### 309-FR-012 — The line MUST render at 320 px and 390 px (wrapping onto a second line when the text is long, no sideways scroll), tablet and desktop, light and dark, Romanian and English, switching with the language without a reload; every text of this story MUST live in the public texts of both languages.

_From 309-open-now-directions._

### 309-FR-013 — Tests MUST cover, in Jest, a table of cases for the status rule: open, before opening, after closing, a lunch break, Saturday with hours, Sunday closed, a legal holiday (1 December 2027), a garage closed day (27 December 2027), the exact start (08:00, open) and end (19:00, closed) of an interval, a date seven or more days ahead ("pe 5 noiembrie"), Orthodox Easter Monday 2027 (3 May 2027), the nights of the March and October 2027 clock changes, two closed days in a row, a next opening seven or more days ahead, fifteen closed days (no line) and no hours; the seeded holidays of 2028 to 2030 (17 rows each year, no shared day, the Easter-derived days); the public read's `closedDays` window (a holiday inside, a closed day inside, a closed day on day 15 left out, a holiday winning over a closed day on one day) with the key allow-list; the header line for each rule outcome, the absent line, the minute tick and the live re-read. End to end (Playwright): with the browser's clock fixed at a Tuesday 10:15 inside the answer's window, the open line shows on a garage with weekday hours; with the clock fixed at 10:15 on a day the profile answer carries as a holiday (the plan chooses the day, research R7), the holiday line shows. Every test file names its requirements in a `// @traces` line.

_From 309-open-now-directions._

### 309-FR-014 — The feature adds no service, queue, outside call, endpoint or product action and writes nothing but the seed migration: the observability inventory is unchanged, and this is recorded in the PR.

_From 309-open-now-directions._
### 1246-FR-008 — The owner's profile read (133-FR-001) MUST carry a change stamp `version` (an opaque string backed by a new `profile_version` column, default 0, that changes on every successful save of this write). A save whose `version` is not the current one MUST answer 409 `profile_changed` with no write. The stamp check and the write MUST be one conditional update inside the save's transaction (the row is written only where `profile_version` still equals the sent value), so two saves carrying the same stamp at the same moment cannot both succeed: exactly one answers 200 and the other 409.

_From 1246-garage-profile-edit._

### 133-FR-002 — The read MUST answer: 200 for the garage's owner (role `garage`); 403 `forbidden` for the garage's staff who do not hold `garage.profile` (the mechanic, and the receptionist until ST-1369); 404 `not_found` for every other actor (another garage's staff, a driver, an admin) and for a `garageId` that is no garage; 410 `gone` for the staff of a suspended garage, as the public read does; a garage not yet approved answers 404 like the public read. The checks run in this order: no session 401; not staff of this garage (or no such garage) 404; staff without `garage.profile` (the mechanic) 403; then the garage's status (not approved 404, suspended 410). The trust check runs on the server; the menu entry and the view only mirror it.

_From 133-garage-public-profile._

### 133-FR-003 — The capability table MUST stay unchanged in this story: `garage.profile` stays the owner's only, so the receptionist is refused the read like the mechanic (granting it is ST-1369's, see `## Split`). Every write keeps checking the owner (`assertGarageOwner`).

_From 133-garage-public-profile._

### 133-FR-004 — The read MUST write no database row, emit no event, record no audit entry and count no profile view; it is read-only and idempotent (filling the public read's cache on a miss, as the public read does, is not a write in this sense).

_From 133-garage-public-profile._

### 133-FR-005 — The dashboard view `profile` of the garage area MUST render the view "Profilul service-ului" / "Garage profile" with the subtitle "Așa te văd șoferii pe hartă" / "This is how drivers see you on the map" (the titles of 097-FR-003 are already in place), read only, with no edit control: the place where "Modifică profilul" will go stays empty until the editing stories (#1246–#1249) add their dialogs.

_From 133-garage-public-profile._

### 1247-FR-010 — The brands group of Profilul service-ului (133-FR-007) MUST show, for the owner only (1246-FR-011's rule), one "Modifică profilul" / "Edit profile" control next to the brand lists, labelled for assistive technology with the group ("Modifică profilul: Mărci și carburanți" / "Edit profile: Brands and fuel types"); a receptionist sees no control.

_From 1247-brand-fuel-edit._

### 133-FR-007 — The view MUST show "Lucrează pe" / "Works on" and "Nu lucrează pe" / "Does not work on" with chips built in the garage area the way the public profile builds them (308-FR-004, 308-FR-005 minus the brand in context) — the shared lamp, the same fuel labels and order; the public profile's own section component is not reused, as it carries the brand in context and the driver's copy: one chip per brand of `worksOn` with a green lamp, one per brand of `doesNotTake` with a red lamp, in the answer's order; each `worksOn` chip carries its fuel line ("benzină · motorină · hibrid · electric" / "petrol · diesel · hybrid · electric", the ticked ones in that fixed order) exactly as the public profile shows it; the lamp is `aria-hidden`, the stance carried by the heading. An unstated brand is in neither list. An empty list shows its heading and "nimic ales încă" / "nothing chosen yet". Under both lists one line reads "Mărcile nemarcate contează ca refuz: apari ultimul la ele și nu primești cereri." / "Unmarked brands count as a refusal: you show last for them and get no requests." The garage's brand note, when the answer carries one, follows as on the public profile (308-FR-007).

_From 133-garage-public-profile._

### 133-FR-008 — The view MUST show "Facilități" / "Facilities" with every catalogue facility, in catalogue order (`courtesy_car`, `pickup_dropoff`, `waiting_area`): one listed in the answer's `facilities` with its label and a green lamp — the courtesy car's label carrying " · gratuit" / " · free" or " · {price} / zi" / " · {price} / day" with the price in whole lei by the money rule (308-FR-009) — and one not listed as "{label}: nu" / "{label}: no" with a grey lamp. Then "Plată: {methods}" / "Payment: {methods}" with the ticked methods in the fixed order numerar, card, transfer / cash, card, transfer (308-FR-010), hidden when none is ticked; then the facilities note when the answer carries one. The labels are the public profile's (308-FR-008).

_From 133-garage-public-profile._

### 133-FR-009 — The view MUST show one button "Vezi profilul public" / "View public profile" that opens `/{lang}/garages/{slug}` — `lang` the interface language, `slug` the answer's — in a new tab with `rel="noopener"`; it is hidden while the view has no answer and on the 410 state.

_From 133-garage-public-profile._

### 136-FR-005 — On the view's suspended state (the profile read answers 410, 133-FR-010) the view MUST show the suspended line in place of the "Profilul public" panel and MUST still show the legal panel below it, which reads the legal check as for an approved garage (the API answers 200 with `status: suspended`, 1354-FR-001) and shows its "Suspendat" tag and rows (1354-FR-004); the panel's host is mounted once the profile read has answered, with 200, 410 or a failure other than 403 or 404 (each panel then shows its own error and retry, as the Edge Cases state), so on 403 or 404 of the profile read the view redirects as today and the panel is never rendered (no flash of its error or skeleton), and while the first profile read is open neither is the panel; the legal check's own 404 hides the panel alone. Modifies 133-FR-010 (the 410 state keeps the legal panel).

_From 136-legal-check-panel._

### 1246-FR-014 — On a successful save the dialog MUST close, the view MUST show the answer's values at once (no second read), and the open view MUST keep re-reading on `garage.updated` (133-FR-011). The texts dialog's address MUST be read only, with the text that a change of address goes to an admin and the control that starts the flow of #127 (ST-135); until ST-135 ships the control is that story's entry point and this story adds no address write.

_From 1246-garage-profile-edit._

### 133-FR-012 — Every text this story introduces for FR-005 to FR-010 MUST come from the garage area's translation files in Romanian and English with comma-below diacritics (016-FR-002); the labels the view shares with the public profile (fuel words, weekday names, "Închis", the facility labels, "gratuit" / "{price} / zi", "Plată: {methods}" and the payment words) are read from the public area's files, the one copy the public profile shows; money in whole lei and hours in 24-hour time through the shared formats (019-FR-001, 019-FR-006); the view MUST render at 320 px and 390 px (fields stacked, chips wrapping), tablet and desktop, light and dark, Romanian and English, with no sideways scroll at 320 px, buttons at least 44 × 44 px and the smallest text at least 12 px.

_From 133-garage-public-profile._

### 133-FR-013 — The view MUST be one named region, the board's panel "Profilul public" with its `h2` under the view's `h1`, the groups "Lucrează pe", "Nu lucrează pe" and "Facilități" each headed by an `h3`, the lamps `aria-hidden` and never the only carrier of meaning (the "nu" / "no" text carries the not-offered state), the public-profile button a link with its destination announced ("se deschide într-o filă nouă" / "opens in a new tab"); the QA sweep's axe checks pass on the view.

_From 133-garage-public-profile._

### 133-FR-014 — The read of FR-001 MUST be listed in `infra/observability/inventory.json` as an endpoint with its route metric (as `GET /api/v1/garages/:slug` is), with no new panel beyond the existing API latency and error panels, and no alert of its own: it is a staff read of an existing read model. The story adds no service, queue or outside call.

_From 133-garage-public-profile._

### 133-FR-015 — Tests MUST exist before the code (Principle II) and name this feature's ids. Jest on real PostgreSQL and Redis: the answer equals the public read's answer for the same garage plus `phone` (key allow-list: the public keys plus `phone`, never `cui`, `seatAddress`, `latitude`/`longitude` of the seat for a mobile mechanic); 200 owner, 403 receptionist (until ST-1369), 403 mechanic, 404 another garage's owner, driver, admin and a random uuid, 401 without a session, 410 suspended, 404 pending; the read writes no audit row and no event; the capability table and its tests are unchanged (ST-1369 changes them). Jest for the web: the panel lines for a workshop and a mobile mechanic, the two chip lists with fuel lines and the refusal line, the facilities with a not-offered row, the courtesy car free and paid, the payment line, the skeleton, the error with retry, the 410 state, the re-read on each of the five live kinds with the latest answer winning, the public-profile link's address and target. Playwright: the owner opens the view and the public profile and sees the same brands, fuel types, facilities and hours; the phone shows only in the dashboard; a mechanic's menu lacks it.

_From 133-garage-public-profile._

### 136-FR-001 — The dashboard view `profile` ("Profilul service-ului", 133-FR-005) MUST show, for the garage's owner, the panel "Verificare legală" / "Legal check" below the "Profilul public" panel as the board's `prof` view places it (a full-width panel under the grid, `DashGarage.dc.html` lines 499–568), placed as the next sibling of the "Profilul public" section with no grid wrapper (the grid's second panel is ST-143's, unbuilt): the same reusable panel component and the same owner host that the overview shows (`mf-garage-legal-check`, 210-FR-012), with no second read, copy or component.

_From 136-legal-check-panel._

### 136-FR-002 — On the view the panel MUST show exactly what it shows on the overview: the tag "Verificat" (or "Suspendat" in red, 1354-FR-004), the four rows company, CAEN, RAR and documents in that order with their state in words and colour (`ok` green "în regulă", `warning` amber "atenție", `failed` red "problemă", `not_run` grey "neverificat"), the RAR row dated by the stored last check or re-check (1354-FR-003), the mobile mechanic's CAEN wording (210-FR-007), the dates as "1 oct. 2026" / "1 Oct 2026" in Europe/Bucharest (210-FR-008), the note on the monthly re-check (1354-FR-006), the "Încarcă documentele" button (068-FR-005), the four-row skeleton and the error with retry (210-FR-010); no admin note, reviewer, evidence or document file is in the answer or the view.

_From 136-legal-check-panel._

### 136-FR-006 — The panel on the view MUST be rendered only for the garage's owner (role `garage`), with no gate of its own: the view's route and redirect (133-FR-010) and the legal check read's refusals (210-FR-001) already keep everyone else out; this story MUST change no capability, role, menu entry or API answer: the receptionist and the mechanic do not reach the view (133-FR-002, 133-FR-003) and the legal check read keeps its 403 for them (210-FR-001). The brief's receptionist tag-only form is deferred to ST-1369 (see Assumptions).

_From 136-legal-check-panel._

### 136-FR-007 — Every text this story introduces MUST come from the garage area's translation files in Romanian and English with comma-below diacritics (016-FR-002); the view with the panel MUST render at 320 px and 390 px (the panel's rows stacking and wrapping), tablet and desktop, light and dark, Romanian and English, with no sideways scroll at 320 px, every button at least 44 × 44 px and the smallest text at least 12 px; the panel keeps its own named region (its `h2` under the view's `h1`, beside the "Profilul public" region in the approved state, 133-FR-013; on the suspended state the suspended line stays a paragraph, 133-FR-010), its lamps `aria-hidden` and every state carried by text, not colour alone; the QA sweep's axe checks pass on the view in both states.

_From 136-legal-check-panel._

### 136-FR-008 — The story MUST write nothing (no audit entry, no event, no field written), add no endpoint, table, service, queue or outside call, and change no entry of `infra/observability/inventory.json`: the legal check read is already listed there as `garage-legal-check` (210-FR-013) and the profile read as ST-133 lists it (133-FR-014).

_From 136-legal-check-panel._

### 136-FR-009 — Tests MUST exist before the code (Principle II) and name this feature's ids. Jest for the web: the view renders the legal panel for the owner under the "Profilul public" panel; the panel is present on the 410 state and absent on the panel's own 404; the `due` row's text and colour in Romanian and English, with the `valid`, `in_review`, `overdue` and `refused` rows unchanged; the re-read on `document.due` with the latest answer winning; the public profile panel's error leaves the legal panel standing and the reverse. Playwright: the seeded owner opens Profilul service-ului and sees "Verificare legală" with "Verificat", four rows, the RAR day, the documents deadline and the note; a receptionist's and a mechanic's menu lack the view. The amber-without-reload case is covered in Jest through the live kind, and end to end when the e2e fixtures can set the seeded cycle `due` without a new seed (see Assumptions).

_From 136-legal-check-panel._

### 385-FR-001 — The public profile header MUST show one button "Distribuie" / "Share" beside the garage's name, with a share icon, at least 44 px tall and wide on phones, reachable by keyboard with a visible focus ring, named for assistive technology "Distribuie" / "Share" followed by the garage's name (a visible label, not the icon alone), visible from 320 px without sideways scrolling, in light and dark; it is shown only on the 200 page, never on the 404 or 410 views.

_From 385-share-garage-link._

### 385-FR-002 — The shared address MUST be the canonical profile address in the sharer's interface language, `{site origin}/{lang}/garages/{slug}`, with `brand={slug}` when the page has a brand in context, plus `src=share`, and no other parameter; the origin is the site's public origin (`SITE_ORIGIN`, the canonical link's origin), never the browser's `location.origin`.

_From 385-share-garage-link._

### 385-FR-003 — When the browser offers the share menu, the button MUST open it with the garage's name as the title and the address of FR-002 as the link; a dismissed menu does nothing; a failed share falls through to FR-004.

_From 385-share-garage-link._

### 385-FR-004 — Without a share menu the button MUST copy the address to the clipboard and show the toast "Link copiat" / "Link copied" (the shared toast, announced politely to assistive technology); when the copy is refused, the page MUST instead show a read-only field holding the address, selected and focused, under the line "Copiază linkul de mai jos" / "Copy the link below" (the field's accessible name, so a screen reader announces it on focus), kept until the page or garage changes.

_From 385-share-garage-link._

### 385-FR-005 — Nothing in the share action needs a session: the button, the menu, the copy and the field behave the same for a visitor and a signed-in driver.

_From 385-share-garage-link._

### 385-FR-006 — A shared link to an `approved` garage MUST open the public profile with the brand in context, the view counted as `shared_link` (143-FR-008) and a request started from it storing `shared_link` as its source (the existing rules); no change to the 200 page beyond FR-001.

_From 385-share-garage-link._

### 385-FR-007 — A link to a garage that was never public (draft, waiting or unknown slug) MUST keep the plain not-found view and status 404 of 307-FR-015, with no similar garages and no call for them.

_From 385-share-garage-link._

### 385-FR-009 — The view MUST read the similar garages from `GET /api/v1/garages/{slug}/similar?brand={slug}` with the link's `brand` when present and show at most 3; with no item it MUST show "Caută un service pentru {brand name}" / "Find a garage for {brand name}" opening the results for that brand when the answer names a brand; when the link had no brand, or the read fails or answers `not_found` (an unknown brand), it MUST show "Caută un service" / "Find a garage" opening Home; it never shows an error block for this read.

_From 385-share-garage-link._

### 385-FR-010 — On the server the page MUST render the view with its similar garages in the same pass that found the 410, so the first paint holds the cards; in the browser the read is not repeated when the server rendered it.

_From 385-share-garage-link._

### 385-FR-011 — The view MUST lay out phones first: one column of cards at 320 and 390 px, the Results card's wider layout from the tablet width, no sideways scrolling at 320 px, light and dark, Romanian and English.

_From 385-share-garage-link._

### 1367-FR-001 — Under each review of the "Ce spun șoferii" / "What drivers say" section (024-FR-004), after the text (or the score when there is no text) and before the author line, the section MUST show one price line of up to three parts joined by " · ", in this order: the accepted quote's range, the job's final price, the driver's amount; a part shows exactly when the read carries its value (FR-003 for the third); when no part shows, no line and no empty element is rendered. The line is muted text under the review, styled as the author line.

_From 1367-review-price-marks._

### 1367-FR-005 — The section MUST show the mark "Editată · {day}" / "Edited · {day}" exactly when the review's edited date is set, the day in the shared day format in Europe/Bucharest ("5 oct. 2026" / "5 Oct 2026"), as muted text joined to the author line after the posted month ("Andrei M. · oct. 2026 · Editată · 5 oct. 2026"); the "·" separators around the mark are decorative and hidden from assistive technology, so a screen reader reads "Editată" and the day; a review with no edited date shows no mark and no separator for it.

_From 1367-review-price-marks._

### 1367-FR-010 — The price line and the marks MUST render at 320 px and 390 px, tablet and desktop, light and dark, Romanian and English with no sideways scroll, wrapping onto more lines where needed, with the muted text meeting WCAG AA contrast (4.5:1) in both themes as the author line already does.

_From 1367-review-price-marks._

### 1366-FR-002 — The view MUST be zoom 15 centred on the garage's point snapped as the image service snaps (1196-FR-002) — the static image and the interactive map open at that snapped centre, the pin within half a grid step of the box's centre — computed by the shared view function so the static image and the interactive map agree; the pin is drawn at the garage's exact point over the snapped image, and carries no price label and no brand colour (the profile has one garage; the Results pin's rate and lamp are 269-FR-013's and do not apply).

_From 1366-garage-map-directions._

### 1366-FR-003 — The map box MUST fill the section's width edge to edge and be 200 px tall (the board's strip) at every width from 320 px up, with the attribution and the control inside the box, no sideways scroll at 320 px, and the dark palette under the dark scheme; the image is decorative (`alt=""`) and the pin is hidden from assistive technology (`aria-hidden`): the address text is the accessible place, and the control is the one focusable element the map adds (1196-FR-019).

_From 1366-garage-map-directions._

### 1366-FR-004 — On a phone a finger moving over the static map MUST scroll the page: the static image captures no gesture, and a tap that scrolled is not an activation (the piece's host click fires only on a tap without movement, as the browser's click already does); the interactive map, once open, MUST keep MapLibre's cooperative gestures (two fingers to move on a touch screen, a modifier key for the wheel), as the opener already sets them.

_From 1366-garage-map-directions._

### 1366-FR-005 — A tap or a click anywhere on the static map, or activating the control "Hartă interactivă" / "Interactive map" (the existing text, reused), MUST open the interactive map in the same box at the view of FR-002 with one marker at the garage, by the shared opener (`openMapLibre` with the view as `start`); a second activation while loading does nothing; once the style has loaded the static image and the control are removed with the cross-fade of 1196-FR-019. The interactive profile map has no re-search, legend, hint or small card: it shows the garage's surroundings, pans and zooms, nothing else.

_From 1366-garage-map-directions._

### 1366-FR-006 — When the static image fails to load (the piece's broken state: the image's `error` event, no timeout of our own) or the interactive map fails to load after an activation (the opener rejects; no timeout of our own, the browser's), the map box MUST be removed with no message and nothing announced; the address, the directions link and the hours stay exactly as they were.

_From 1366-garage-map-directions._

### 1366-FR-007 — When the answer carries no `latitude` or no `longitude`, or the garage is a mobile mechanic, "Unde" MUST show no map and no directions link; the mobile mechanic's section is unchanged in every other way (308-FR-011), its circle being the follow-up story's.

_From 1366-garage-map-directions._

### 1366-FR-008 — For a workshop with a point, "Unde" MUST show a link "Arată traseul" / "Get directions" under the hours lines, as the section's last line (the board's placement; the same place when the map is gone), whose address is the platform's: `https://maps.apple.com/?daddr={lat},{lng}` on an iPhone, iPad or iPod; `geo:{lat},{lng}?q={lat},{lng}` on an Android device; `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}` anywhere else, the computer address alone opened in a new tab (`target="_blank"`, `rel="noopener noreferrer"`), the phone addresses with no `target` and no `rel`; `{lat}` and `{lng}` are the answer's numbers as `String(n)` writes them, unrounded, with a `.` decimal separator whatever the language.

_From 1366-garage-map-directions._

### 1366-FR-009 — The platform MUST be read from the browser's user agent by one pure function (iPhone, iPad or iPod → `ios`; Android → `android`; anything else, the server and an iPad reporting a Macintosh user agent included → `computer`); the server render carries the `computer` address and the browser replaces it with the platform's before the link is interactive, so a browser without script keeps a working link. The function is the one tested unit; no device sniffing elsewhere.

_From 1366-garage-map-directions._

### 1366-FR-010 — The link MUST be a real link (an anchor with `href`), at least 44 px tall on a phone, in the theme's link style, in the keyboard order after the map's control, and readable in both schemes (the sweep's contrast check); it carries no icon-only form.

_From 1366-garage-map-directions._

### 1366-FR-012 — The new text "Arată traseul" / "Get directions" MUST live in the shared i18n files (`libs/i18n/src/public/ro.json`, `en.json`) in Romanian and English; the control and the attribution reuse ST-1196's keys.

_From 1366-garage-map-directions._

### 1366-FR-013 — Jest MUST cover: the platform function (an iPhone, an iPad, an Android, a desktop and an iPadOS Macintosh user agent, and an empty one → `computer`); the computer address alone carrying `target` and `rel`; the directions address for each platform with the coordinates written in full; the section's states (a workshop with a point: map, heading, address, hours, link in that order; without a point: no map, no link; a mobile mechanic: unchanged; the image broken: the map gone, the link kept; the interactive map rejected: the same); the view for the profile (zoom 15, the garage at the centre); the activation opening the interactive map once with the view as `start`; the analytics event sent with `platform` only; and the pin drawn without a rate label.

_From 1366-garage-map-directions._

### 1366-FR-014 — End to end (`apps/web-e2e`, the profile of a seeded workshop, `MAP_TILES_TILEJSON_URL=off` and `__MF_MAP_STYLE` as today): the directions link's `href` carries the seeded garage's latitude and longitude (the brief's test), as the computer address under Playwright's desktop browser; after the map shows, the network log holds one `maps/static` request with `z=15` and no `maplibre-gl` request; a tap opens the interactive map at the garage's point and zoom 15 (read from `__MF_MAP`); with the image route blocked the map box is gone and the link still carries the coordinates; at 320 px the page does not scroll sideways and the attribution and the control sit inside the map box.

_From 1366-garage-map-directions._

### 1246-FR-001 — A new owner write `PATCH /api/v1/garages/{garageId}/profile` (beside `GET …/profile`; the settings write `PATCH /api/v1/garages/{garageId}` for payment methods and the courtesy car is left unchanged) MUST accept, each optional and each a group of its own, `name` (2–80 characters after trimming), `description` (at most 1,000 characters after trimming; empty stored as none), `phone` (a number the shared normaliser accepts, stored normalised), `hours` with `closedDays` (the listing's hours section shape, 112-FR-003 and 112-FR-004) and `serviceRadiusKm` (a whole number from 5 to 100, accepted only for a garage whose `businessKind` is `mobile`); every other field is refused as unknown (400), except the verification fields of FR-003 (422). The body MUST carry the profile's change stamp `version` (FR-008).

_From 1246-garage-profile-edit._

### 1246-FR-002 — A value outside its limits (a name of 1 or 81 characters, a description of 1,001, a radius of 4 or 101, a fraction, a non-number, a phone the normaliser refuses, a radius for a workshop) MUST answer 400 `validation_failed` naming the field, and nothing MUST be written.

_From 1246-garage-profile-edit._

### 1246-FR-003 — `address`, company fields (`name` of the company, `cui`, `mobileLegalForm`), `seatAddress`, `rarActivities` and `proposedJobs` (kinds of work) sent to this endpoint MUST answer 422 `needs_verification` with no write: a change of those goes through the warned flow of ST-135 (#127).

_From 1246-garage-profile-edit._

### 1246-FR-004 — The endpoint MUST answer 200 for the garage's owner (role `garage` on this garage), 403 `forbidden` for its receptionist or mechanic, 404 `not_found` for the owner of another garage and for a garage not yet approved, 410 `gone` for a suspended garage, and 401 `sign_in_required` with no session; trust is checked on the server (Principle V).

_From 1246-garage-profile-edit._

### 1246-FR-005 — A successful save MUST write, in one transaction: the changed fields; one `update` audit entry per changed field (field, old, new, actor, garage id) through the audit writer (390-FR-001, 390-FR-003); one `garage.updated` outbox event for the garage (Principle VI); and the new change stamp. A field sent with its current value is not a change; a save that changes nothing writes no entry, no event and keeps the stamp. If any of the writes fails, none of them stays (no field without its audit entry or its event). The phone is stored and audited in its normalised form only; it MUST NOT appear in the outbox event payload, the logs, the metric labels or the trace attributes (109-FR-014 keeps it out of every public read).

_From 1246-garage-profile-edit._

### 1246-FR-006 — The hours and closed days MUST be written through the listing's one hours write (112-FR-009, 112-FR-010), so a legal holiday, a day in the past or one past the two-year window is dropped and never stored; the use case passes the garage's current facilities and facilities note with the new hours so they are left as they are, and the write itself is not changed (FR-026). A change of the weekly hours adds one `update` audit entry for `hours`; closed days keep the write's own per-day entries.

_From 1246-garage-profile-edit._

### 1246-FR-007 — The answer MUST be the owner's profile as `GET /api/v1/garages/{garageId}/profile` answers it (133-FR-001), with the new stamp, so the dialog and the view show exactly what was saved.

_From 1246-garage-profile-edit._

### 1246-FR-009 — After `garage.updated` the public profile cache for the garage MUST be dropped (1183-FR-005) so the public read, the open-now line, the search cards and the search's mobile area (229-FR-011, 269-FR-014) use the new name, description, hours, closed days and radius on their next read, with no review and no admin step.

_From 1246-garage-profile-edit._

### 1247-FR-011 — The control MUST open a dialog of the shared task shape (1246-FR-012: Spartan dialog, centred from 768 px, a sheet below, focus and Escape rules) titled "Mărci și carburanți" / "Brands and fuel types", listing every active catalogue brand in catalogue order plus any retired brand the garage has marked, each with the listing step's three-state control (tap: unstated → "Lucrează pe" green → "Nu lucrează pe" red → unstated; `aria-pressed`), and under each taken brand the four fuel ticks (benzină, motorină, hibrid, electric / petrol, diesel, hybrid, electric) and the jobs disclosure ("{ticked} din {total} lucrări" / "{ticked} of {total} jobs", one tick per price-list job, "Bifează toate" / "Tick all"), reusing the brands step's controls (`apps/web/src/app/public/brands-step`), not a copy; then the brand note (140) and the refusal phrase (60) with their limits and counts; "Salvează" / "Save" and "Renunță" / "Cancel". With no priced job the disclosure shows the brands step's "no jobs yet" text linking to the price list view.

_From 1247-brand-fuel-edit._

### 1246-FR-013 — The dialog MUST check each field as the owner leaves it with the shared rules (name 2–80, description at most 1,000, phone through the shared normaliser, radius 5–100 whole, its error the listing form's own "Alege raza de deplasare" / "Choose how far you travel", one text under one key) and show the error under the field in the page's language; a dialog with an error MUST NOT send the save. The server's 400 MUST be shown under its field; a 409 MUST be shown as "Profilul a fost modificat între timp. Reîncarcă." / "The profile was changed meanwhile. Reload." with a reload control that re-reads the profile into the dialog and nothing else. While a save is in flight the Save control MUST be disabled and show a busy state (no second send from a double click); a network failure or a 5xx MUST keep the dialog open with the typed values and show a retry text in the page's language, with Save enabled again; "Renunță" / "Cancel", Escape and a click on the backdrop MUST close the dialog without sending anything and without a confirmation, and reopening it shows the saved values.

_From 1246-garage-profile-edit._

### 1246-FR-015 — An open public profile MUST show the saved hours, closed days, name and description within 5 s of the save with no reload, through its existing `garage.updated` re-read (307-FR-017, 309-FR-011); the open-now line MUST be re-worked on the new hours (309-FR-011).

_From 1246-garage-profile-edit._

### 1246-FR-024 — Every new text (the control labels, the dialog titles, the field labels and limits, the errors, the 409 text, the address note) MUST live in the garage area's translation files in Romanian and English, and the dialogs MUST render at 320 and 390 px (a sheet, no sideways scroll, 44 px targets, 16 px text fields, 286-FR-005), tablet and desktop, light and dark, in both languages.

_From 1246-garage-profile-edit._

### 1246-FR-025 — The endpoint's new fields and the `garage.updated` it emits MUST be recorded in `infra/observability/inventory.json` (the existing endpoint's entry grows; the event is already listed) and the OpenAPI document and the generated client MUST be regenerated; no new service, queue or outside call is added.

_From 1246-garage-profile-edit._

### 1246-FR-026 — Every change to the hours and closed-day data, to the hours write (112-FR-009) and to anything that reads them MUST be additive: no field, function, message or meaning renamed, removed or changed, because ST-427 (workshop time blocks) reads them in another lane; PR #616 (`333-media-timeout-budget`) is not touched.

_From 1246-garage-profile-edit._

### 1246-FR-027 — Tests MUST exist before the code (Principle II) and name this feature's ids in `// @traces` lines: Jest on real PostgreSQL and Redis for FR-001 to FR-010 (each limit's boundary, 422 for every verification field, 403/404/410, the per-field audit entries and the one event in one transaction, 409 on a stale stamp, the cache drop); component tests for the view's controls per role and business kind, each dialog's field checks, the 400 and 409 handling, the no-second-read close, and the reused hours block; the PR QA flows of FR-020 and a flow that saves Saturday's hours and sees the public profile update.

_From 1246-garage-profile-edit._

### 1247-FR-012 — The dialog MUST open on FR-001's read (a skeleton while it loads, the retry text on failure) and never on the profile answer's lists alone; a brand that becomes taken in the dialog starts with all four fuels and every job ticked; a brand turned refused or unstated loses its ticks in the dialog; the last ticked fuel of a taken brand is disabled with "Cel puțin un carburant rămâne bifat" / "At least one fuel type stays ticked" beside it; a taken brand stored with no fuel (possible under 397-FR-010) opens with no fuel ticked and the same text as an error, and Save stays blocked until one is ticked; a re-taken brand within one dialog session starts fresh (all four fuels, every job) and the dialog always sends `fuels` and `jobs` for each taken brand; a taken brand with every job unticked shows the brands step's existing warning "Nu vei primi cereri pentru {brand}" (`public.listing.brands.noRequests`), which does not block the save; the last-fuel rule lives in the shared brands step, so the listing form gains it too (research.md R8); a note over 140 or a phrase over 60 characters shows the limit error under the field and blocks the send.

_From 1247-brand-fuel-edit._

### 1247-FR-013 — Save MUST send one `PUT` with every marked brand, each taken one with its `fuels` and `jobs`, and the note and phrase; while in flight Save is disabled with a busy state; a 400 is shown under its field (or at the top for a brand-level code, naming the brand); a network failure or 5xx keeps the dialog open with the ticks as made and shows the retry text; on 200 the dialog closes and the view shows the answer's lists at once (fuel lines included) while it keeps re-reading on `garage.updated` (1246-FR-014); "Renunță", Escape and the backdrop close without sending.

_From 1247-brand-fuel-edit._

### 1247-FR-014 — The dialog's code MUST be loaded lazily (a dynamic import or `@defer` from the profile view, out of the eager chunks) and the web app's production build MUST stay under its `initial` warning budget (`apps/web/project.json`, 500 kB), which the build asserts; the PR body records the initial size before and after as evidence.

_From 1247-brand-fuel-edit._

### 1247-FR-015 — Every new text MUST live in the garage area's translation files in Romanian and English with comma-below diacritics, the brand, fuel and job labels being the ones the brands step and the profile already show; the dialog MUST render at 320 and 390 px (a sheet, brands stacked, no sideways scroll, 44 px targets, 16 px text fields), tablet and desktop, light and dark, both languages; the lamps are `aria-hidden`, the stance carried by text; the QA sweep's axe checks pass.

_From 1247-brand-fuel-edit._

### 1247-FR-016 — An open public profile MUST show the saved brands, fuel lines and brand note within 5 s of the save's 200 with no reload through its existing `garage.updated` re-read (307-FR-017), the public profile cache dropped on the event (1183-FR-005); the search for a brand whose stance changed ranks the garage by its new stance on the next read; a brand turned refused stops being offered new requests for that brand at once while requests already received stay (the existing rule, MF-09).

_From 1247-brand-fuel-edit._

## Retired

- `307-FR-004` — not built: the distance with `near` (and FR-013's "la {d} km" for a fixed garage) moved whole to the ST-307 tech-debt task, waiting on ST-229's `near` rule (PR #282); that task adds it back (2026-10-08)
- `307-FR-014` — superseded by `310-FR-004` (2026-10-09)
- `307-FR-007` — removed by 1182-cache-service (2026-10-15)
- `307-FR-006` — superseded by `1182-FR-007` (2026-10-15)
- `355-FR-002` — superseded by `386-FR-002` (2026-10-17)
- `355-FR-011` — superseded by `356-FR-009` (2026-10-17)
- `307-FR-013` — superseded by `271-FR-015` (2026-10-18)
- `356-FR-001` — superseded by `311-FR-009` (2026-10-18)
- `307-FR-002` — superseded by `1353-FR-001` (2026-10-20)
- `307-FR-010` — superseded by `1353-FR-002` (2026-10-20)
- `307-FR-018` — superseded by `1353-FR-003` (2026-10-20)
- `1183-FR-001` — superseded by `330-FR-007` (2026-10-22)
- `310-FR-004` — superseded by `1192-FR-009` (2026-10-22)
- `307-FR-005` — superseded by `308-FR-002` (2026-10-22)
- `308-FR-006` — superseded by `025-FR-016` (2026-10-23)
- `133-FR-010` — superseded by `136-FR-005` (2026-10-24)
- `308-FR-002` — superseded by `309-FR-006` (2026-10-24)
- `308-FR-003` — superseded by `309-FR-007` (2026-10-24)
- `307-FR-015` — superseded by `385-FR-008` (2026-10-24)
- `308-FR-011` — superseded by `1366-FR-001` (2026-10-25)
- `133-FR-001` — superseded by `1246-FR-008` (2026-10-30)
- `133-FR-006` — superseded by `1246-FR-011` (2026-10-30)
- `133-FR-011` — superseded by `1246-FR-014` (2026-10-30)
- `1246-FR-011` — superseded by `1247-FR-010` (2026-10-30)
- `1246-FR-012` — superseded by `1247-FR-011` (2026-10-30)

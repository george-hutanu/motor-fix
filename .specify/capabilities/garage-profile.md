---
capability: garage-profile
updated: 2026-10-18
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
  - 311-estimate-within-reach
  - 1183-garage-profile-page
---

# Capability: Garage profile

The public page of an approved garage, one address per language: the site bar, the header (back link, brand lamp, verified badge, name, place line, description, rating dial), the verification line with the date of the last check, the slots the other profile stories fill, the 404 and "no longer available" views, the public read that serves it with its cache, and the live re-read on the public stream.

## Requirements

### 307-FR-001 — `GET /api/v1/garages/{slug}` MUST keep answering only through the one public scope: 200 for an `approved` garage, 404 `not_found` with no garage data for a `draft`, waiting or unknown slug, to everyone including the garage's own staff, and 410 `gone` with no garage data for a `suspended` garage (modifies 207-FR-005: the profile is now served from its cache, 307-FR-006).

_From 307-public-garage-profile._

### 307-FR-002 — The answer MUST add to today's fields: `description` (the one line the garage wrote about itself, as written, in both languages; omitted when empty), `verifiedAt` (the decision time of the garage's latest approved verification file, else the garage's `approvedAt`, an ISO-8601 instant; null when neither exists), `rating` (one decimal or null) and `reviewCount` (a whole number, 0 until reviews exist), the garage's `businessKind` (`mobile` or a fixed kind) and, for a mobile mechanic, `serviceRadiusKm` with the 20 km default filled in.

_From 307-public-garage-profile._

### 307-FR-003 — The read MUST accept an optional `brand` query parameter, a catalogue brand's slug. When it names a catalogue brand (active or retired), the answer MUST carry `brand: { id, name, slug, stance }` where `stance` is `works_on` when the garage marked the brand so and `does_not_take` when it refused it or has no row for it; when the parameter is absent, blank, over-long, holds a control character or names no catalogue brand, the answer MUST carry no `brand` and MUST NOT fail.

_From 307-public-garage-profile._

### 307-FR-005 — The answer MUST never contain the garage's phone, CUI, a mobile mechanic's seat address or position, or any personal data; a test MUST pin the answer's keys with one allow-list, asserted as a superset over a fixed and a mobile garage each read with and without `brand` and `near`, and a forbidden list (`phone`, `cui`, `seatAddress`, a mobile mechanic's `latitude`/`longitude`), so a new field is a deliberate change. A fixed garage keeps `address`, `latitude` and `longitude` (207).

_From 307-public-garage-profile._

### 1182-FR-007 — The public garage profile read MUST go through the cache service in place of its own Redis hash, slug pointer and generation: one entry per garage and brand in context (and one for none), found from the slug, tagged with the garage, a soft lifetime of 10 minutes, keeping every rule of 307-FR-001 and 307-FR-006 that the reader sees (the one public scope, the 404/410 verdicts of garages that exist read fresh every time, the brand-in-context variants, the drop on every event relayed to `public:garage:{id}`, PostgreSQL the only truth). The old keys, generation and per-module fail-open wrapper are removed, not kept beside the new service.

_From 1182-cache-service._

### 307-FR-008 — The web app MUST serve the profile at `/{lang}/garages/{slug}` (replacing the placeholder, one address per language, 021), server-rendered like the other public pages, inside the public frame, and keep `?brand=` on the address so a shared link carries the brand in context.

_From 307-public-garage-profile._

### 307-FR-009 — The page's site bar MUST show, from 640 px wide, the logo (to Home), "Găsește un mecanic" / "Find a mechanic" (to Home), "Autentificare" / "Sign in" (the sign-in dialog), "Înscrie-ți service-ul" / "List your garage" (to the listing form) and the RO / EN switch, which opens the same profile, brand included, in the other language; under 640 px the links hide, a 44 px account button ("Cont" / "Account", the sign-in dialog) stays beside the logo and RO / EN, and the public tab bar stands in for navigation (design.md).

_From 307-public-garage-profile._

### 307-FR-010 — The header MUST show, in this order: the back link; the lamp when a brand is in context; the badge "Verificat · autorizație RAR" / "Verified · RAR authorisation"; the garage's name; the place line; the description when there is one; the rating dial with the review count ("212 RECENZII" / "212 REVIEWS"; "—" and "Nicio recenzie încă" / "No reviews yet" with none); then, when `verifiedAt` is set, the verification line "Firmă activă și autorizație tehnică RAR, verificate de MotorFix. Ultima verificare: {date}." / "Active company and RAR technical authorisation, checked by MotorFix. Last check: {date}." with the date in the language's short form and the Europe/Bucharest zone (019-FR-005, 019-FR-007).

_From 307-public-garage-profile._

### 307-FR-011 — The lamp MUST be green with "Lucrează pe {brand}" / "Works on {brand}" for `works_on`, red with "Nu lucrează pe {brand}" / "Does not work on {brand}" for `does_not_take`, and absent without a brand in context; the brand's name comes from the answer, never from the address.

_From 307-public-garage-profile._

### 307-FR-012 — The back link MUST read "Service-uri pentru {brand}" / "Garages for {brand}" and point to `/{lang}/garages?brand={slug}` when a brand is in context, else "Acasă" / "Home" and point to Home.

_From 307-public-garage-profile._

### 307-FR-013 — The place line MUST read "la {d} km" / "{d} km away" for a fixed garage when the visitor has a place (the one Home keeps in local storage, 229-FR-005, sent as `near` by the browser's re-read: the server renders without it), be left out for a fixed garage without one, and read "Mecanic mobil · zonă de {r} km" / "Mobile mechanic · {r} km area" for a mobile mechanic, whatever the place; the page MUST show no address and no seat.

_From 307-public-garage-profile._

### 310-FR-004 — The profile page MUST fill its photos slot with a "Fotografii" / "Photos" section only when the list is not empty: the first photo large and the rest as thumbnails, in the list's order, the large cover tile showing the photo's display copy and every other tile its thumbnail copy, each at a fixed geometry so the layout holds before the images arrive (the cover tile twice the basis of the others, every tile `clamp(220px, 28vw, 340px)` tall, as `design.md` fixes them). Photos below the fold MUST load lazily; the first photo MUST load eagerly.

_From 310-photo-gallery._

### 307-FR-015 — The page MUST show skeletons for the header and each section while the read is open; on 404, the "Pagina nu există" / "This page does not exist" view with a link to Home (the existing not-found view); on 410, the "no longer available" view, "Acest service nu mai este disponibil" / "This garage is no longer available" with a link to Home; the server answers the page with status 404 and 410 for those two views, 200 otherwise; on any other failure, an error block "Nu am putut încărca service-ul" / "We could not load the garage" with "Încearcă din nou" / "Try again" that repeats the read.

_From 307-public-garage-profile._

### 307-FR-016 — The page MUST render well at 320 px and 390 px (stacked), tablet and desktop (header side by side), light and dark, Romanian and English, with no sideways scroll; its texts MUST live in the public texts for both languages, and text the garage wrote MUST be shown as written in both. Accessibility: the lamp's stance and the dial's value are carried by text, never by colour alone; the back link, the sign-in controls and "Încearcă din nou" / "Try again" are reachable by keyboard with a visible focus and an accessible name; touch targets are at least 44 px under 640 px; the skeletons are hidden from assistive technology and an in-place change of the lamp or the dial is announced politely, without moving focus.

_From 307-public-garage-profile._

### 307-FR-017 — The open profile MUST join `public:garage:{garageId}` through the public live stream (`GET /api/v1/live/public?garages={id}&brand={brandId}` when a brand is in context) from the browser only, never during server rendering, and leave it when the page is left. While the stream cannot be opened or drops, the page keeps showing its last answer with no error block and reconnects and re-reads on the stream's own reopen rule (256-FR-002), never a polling loop of its own.

_From 307-public-garage-profile._

### 307-FR-018 — On every message of the stream and on every reopen the page MUST re-read the profile in place, with the same brand and place, merging the answer so the scroll position stays (256-FR-001, 256-FR-002); a re-read that answers 410 MUST switch the page to the "no longer available" view, and one that answers 404 to the not-found view; a failed re-read keeps the last answer and waits for the next event (419).

_From 307-public-garage-profile._

### 307-FR-019 — The story MUST write nothing: no view count (another story's), no audit entry, no event, no search log.

_From 307-public-garage-profile._

### 310-FR-001 — The public profile read MUST answer the garage's photos as a list in the owner's order (ascending position), each entry carrying a thumbnail address and a full-screen address, both signed download addresses valid for 60 minutes, plus the width and height of the photo as seen upright when they are known. The answer MUST never carry a storage key, bucket name or path; a test fails on any of them in the response.

_From 310-photo-gallery._

### 310-FR-002 — A photo whose copies are not yet in storage MUST be left out of the list (a row with a known width is trusted to have its copies; only a row whose width is still null is checked against the thumbnail copy's metadata at read time, which also supplies its width and height), and a garage whose list is empty MUST answer an empty list (never an absent field), so the page hides the section.

_From 310-photo-gallery._

### 310-FR-003 — The thumbnail address MUST serve the upload story's thumbnail copy (at most 400 px on its long side) and the full-screen address its display copy (at most 1,600 px, the original's format for PNG and WebP, JPEG otherwise); nothing is resized or re-encoded at read time. The read MUST never serve the original upload.

_From 310-photo-gallery._

### 310-FR-004 — The profile page MUST fill its photos slot with a "Fotografii" / "Photos" section only when the list is not empty: the first photo large and the rest as thumbnails, in the list's order, the large cover tile showing the photo's display copy and every other tile its thumbnail copy, each at a fixed geometry so the layout holds before the images arrive (the cover tile twice the basis of the others, every tile `clamp(220px, 28vw, 340px)` tall, as `design.md` fixes them). Photos below the fold MUST load lazily; the first photo MUST load eagerly.

_From 310-photo-gallery._

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

### 386-FR-002 — The public read (`GET /api/v1/garages/{slug}?brand=`) MUST give a job the brand's range when the profile is read for a catalogue brand the garage **takes** (`works_on`) and a complete row for that brand exists; in every other case (no brand, another brand, an incomplete brand row, the brand refused or unstated) the default range. This narrows 355-FR-002: a brand row of a brand without a `works_on` row is kept and never used, and applies again when the brand is taken again. Visibility, duration and order stay the default row's, and the ticked-jobs rule of 355-FR-002 is unchanged: once the garage ticked any job for the brand, only the ticked jobs are listed for it.

_From 386-brand-price-range._

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

### 356-FR-009 — The switched-on jobs MUST be kept per garage in the browser's session storage (keyed by the garage's id, holding job ids), restored when the same profile opens again in the same browser tab's session and forgotten when the session ends (a new tab starts empty); a job restored that the list does not carry is dropped silently and pruned from storage (what is stored is what is on, so a job hidden for the brand in context does not come back on the default list); a refused or failing storage, or a stored value that is not a list of job ids, leaves the box working for the open page and is treated as nothing on; the server render and the first client render show nothing on, and the stored selection is applied after hydration, so the markup never disagrees with the server's.

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

### 311-FR-009 — From 1024 px, the profile's sections MUST lay out in two columns: a main column (photos, brands, mechanics, prices, reviews, in today's order) and a side column (the estimate box, then the `where` slot) that sticks under the site bar while the main column scrolls, and scrolls inside itself when taller than the window below the site bar; the side column exists only when the estimate box or the `where` slot has content, else the main column takes the full width; from 768 to 1023 px and below 768 px the page stays one column as today.

_From 311-estimate-within-reach._

### 311-FR-010 — The server render and the first client render MUST agree with each other (no hydration mismatch): the bar's markup is rendered on the server and hidden by width, and the total's placeholder is what both show until the selection is applied.

_From 311-estimate-within-reach._

### 311-FR-011 — Every new text (the empty text, the total button's name if it differs from the box's sentence, the sheet's title) MUST live in the public texts for both languages; the bar and the sheet reuse the estimate's existing keys wherever one exists.

_From 311-estimate-within-reach._

### 311-FR-012 — Nothing is written to the server and no event is emitted; the story adds no endpoint, metric, dashboard panel or alert (`infra/observability/inventory.json` unchanged).

_From 311-estimate-within-reach._

### 311-FR-013 — Tests: component tests cover the bar shown on a phone only, hidden while a text field has focus, the empty text with nothing on, the placeholder before the selection is applied, the button alone with no public job, no bar for a garage-side role and the sheet opening on the total; the end-to-end walk, at 375 × 812 on the seeded garage, switches two jobs on, scrolls to the end, checks the button is inside the viewport and opens the request, then taps the total and sees the sheet (brief Tests).

_From 311-estimate-within-reach._

### 1183-FR-001 — On a cache miss, the public profile read MUST obtain everything the answer needs in exactly one PostgreSQL statement: the garage row with the brands it works on (each with its fuels and job ticks), its photos in position order, its price rows with their job types, the courtesy-car facility, its response stats and the decision time of its latest approved verification file, each aggregate with an explicit `ORDER BY` that reproduces today's order (deep equality, not byte-level). The brand-in-context lookup stays its own cached read (1235-FR-003) and does not count. An integration test MUST count every query event the read issues on a miss after the brand lookup, unfiltered, and assert one; the read runs outside `$transaction`.

_From 1183-garage-profile-page._

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

## Retired

- `307-FR-004` — not built: the distance with `near` (and FR-013's "la {d} km" for a fixed garage) moved whole to the ST-307 tech-debt task, waiting on ST-229's `near` rule (PR #282); that task adds it back (2026-10-08)

- `307-FR-014` — superseded by `310-FR-004` (2026-10-09)

- `307-FR-007` — removed by 1182-cache-service (2026-10-15)
- `307-FR-006` — superseded by `1182-FR-007` (2026-10-15)

- `355-FR-002` — superseded by `386-FR-002` (2026-10-17)

- `355-FR-011` — superseded by `356-FR-009` (2026-10-17)

- `356-FR-001` — superseded by `311-FR-009` (2026-10-18)

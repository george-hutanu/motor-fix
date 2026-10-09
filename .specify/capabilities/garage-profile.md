---
capability: garage-profile
updated: 2026-10-09
features:
  - 307-public-garage-profile
  - 310-photo-gallery
  - 312-report-garage
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

### 307-FR-006 — The answer, without the distance, MUST be served from a cache in Redis held as one Redis hash per garage with a field per brand in context (and one for none), dropped as a whole by the worker's outbox relay whenever it relays an event to that garage's `public:garage:{id}` channel, whatever the kind, and expiring on its own after 10 minutes as a safety net; a 404 or 410 is never cached; with Redis unavailable the read answers from PostgreSQL, warning once per outage (the first failing call logs; the next only after a call has succeeded), and a drop Redis refuses fails the relay's batch, which leaves the event unrelayed and retries it with one log per streak (T005), so no cached profile outlives its change; the generation expires with the profile, after 10 minutes. The cache keys carry the answer's shape version (`v1`). *(Amended in harden, 2026-10-08: the drop throws rather than being skipped, so the relay's retry keeps the cache honest; see auto-run.md.)* A read that began before a drop MUST NOT leave its older answer in the cache: the drop also advances a per-garage generation, and a read writes its answer only when the generation it saw before reading PostgreSQL is unchanged. PostgreSQL stays the only truth (Principle VI).

_From 307-public-garage-profile._

### 307-FR-007 — The read's cache MUST be observable: hits, misses and drops counted in the API's metrics, listed in `infra/observability/inventory.json` with the panel and alert they feed, or the reason none is needed.

_From 307-public-garage-profile._

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

## Retired

- `307-FR-004` — not built: the distance with `near` (and FR-013's "la {d} km" for a fixed garage) moved whole to the ST-307 tech-debt task, waiting on ST-229's `near` rule (PR #282); that task adds it back (2026-10-08)

- `307-FR-014` — superseded by `310-FR-004` (2026-10-09)

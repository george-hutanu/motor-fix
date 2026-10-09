---
capability: garage-profile
updated: 2026-10-08
features:
  - 307-public-garage-profile
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

### 307-FR-014 — Below the header the page MUST leave the sections other stories fill (brands, facilities, hours and address; prices; photos; reviews; mechanics) as named slots that show nothing until their stories land: a section with no data is hidden, never shown empty.

_From 307-public-garage-profile._

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

## Retired

- `307-FR-004` — not built: the distance with `near` (and FR-013's "la {d} km" for a fixed garage) moved whole to the ST-307 tech-debt task, waiting on ST-229's `near` rule (PR #282); that task adds it back (2026-10-08)

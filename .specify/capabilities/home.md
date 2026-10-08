---
capability: home
updated: 2026-10-08
features:
  - 225-brand-picker
  - 229-location-or-address
---

# Capability: Home

The public Home page: the brand picker of the most searched brands, the hero that names the selected brand, the count of listed garages that take it and the main button to Results.

## Requirements

_None yet: 225-brand-picker's Spec Delta adds the first ones when it is archived._

### 225-FR-001 — Home MUST show a brand picker of up to eight tiles, read through the public tiles read (FR-010), rendered on the server with the page so they are present before any script runs; the tiles MUST be buttons with the brand name as their text (written as the catalogue writes it), in a radio-group pattern (one group with an accessible name "Marca mașinii" / "Car brand", each tile telling whether it is selected), each at least 44 px tall, with no text under 12 px; the group MUST be one Tab stop with the arrow keys moving the selection between tiles (roving focus), and the focused tile MUST show a visible focus ring in both themes.

_From 225-brand-picker._

### 225-FR-002 — Exactly one tile MUST be selected at all times; on load it is the first tile. Choosing a tile selects it and deselects the others.

_From 225-brand-picker._

### 225-FR-003 — The tiles MUST be the active brands by popularity rank (1 first, unranked last, then by name), `min(limit, active brands)` of them, the same for every actor. The own-cars-first order waits for the car store and is deferred (see Assumptions).

_From 225-brand-picker._

### 225-FR-004 — The hero MUST be filled through one copy slot taking the brand name: a label, a headline and a paragraph in the page's language (texts in Clarifications), re-filled whenever the selected brand changes; the hero's section order MUST leave the car section's place after the picker (an empty, named region, nothing else) for the Brand experience stories.

_From 225-brand-picker._

### 225-FR-005 — Under the main button, the count MUST read "{X} din {Y} service-uri primesc {brand}" through the message format's plural forms — Y of 1: "1 service", 2–19: "{Y} service-uri", 20 and up: "{Y} de service-uri"; the verb agrees with X ("primește" for 1, "primesc" otherwise) — English "{X} of {Y} garage(s) take(s) {brand}"; where Y = the approved garages (all of Romania until a place exists) and X = those whose answer for the brand is `works_on`; `does_not_take` and `unstated` garages count in Y only; `draft` and `suspended` garages count nowhere.

_From 225-brand-picker._

### 225-FR-006 — Choosing a brand MUST issue one Home read (FR-009) for it and update the count from that one answer (the hero and the main button follow the selected tile at once, with no request); every selection change, automatic or by hand, issues exactly one read and never a duplicate; an answer for a brand no longer selected MUST be dropped. The count is fetched in the browser only: the server's HTML and the time until the answer show the count's skeleton. The count area MUST be a polite live region that announces a new count or the error only after the first touch (the automatic moves stay silent).

_From 225-brand-picker._

### 225-FR-007 — Until the first touch, the selection MUST move to the next tile every 5 s (wrapping from the eighth to the first), the hero and count following each move; the moving MUST start only after hydration, MUST pause while the document is hidden and resume when visible, MUST stop for the rest of the visit at the first pointer down, click, key press or keyboard focus on a tile, MUST never run while the device asks for reduced motion (stopping at once when the setting turns on), and MUST write nothing: no search, no event, no audit entry.

_From 225-brand-picker._

### 225-FR-008 — The main button, "Caută service-uri" / "Find garages", MUST open the results route of the current language with the selected brand's slug as the `brand` query parameter, a plain link built from the selected tile's slug (never from the Home answer) so it works before hydration and while the Home read is in flight or failed.

_From 225-brand-picker._

### 225-FR-012 — If the Home read fails (network, 5xx, 404), the count area MUST read "Nu am putut încărca service-urile" / "We could not load the garages" with a "Reîncearcă" / "Try again" button that repeats the read for the selected brand; the picker, the hero and the main button MUST keep working meanwhile.

_From 225-brand-picker._

### 225-FR-013 — At 320 px wide the picker MUST have two columns and the page MUST NOT scroll sideways; from 768 px it MUST use four columns; a long brand name ("Mercedes-Benz") wraps inside its tile and never widens it; the picker, hero, button and count MUST hold in light and dark, Romanian and English, at 320 px, 390 px, tablet and desktop.

_From 225-brand-picker._

### 225-FR-014 — Every text of this story MUST live in the shared i18n files in Romanian and English; switching the language MUST change every text and keep the selected brand and the cycling state.

_From 225-brand-picker._

### 225-FR-015 — The development seed MUST hold six approved garages (Bucharest names) with brand answers such that exactly three have `works_on` for Dacia, one `does_not_take` and two no row, plus the existing unapproved garages, so Home and the end-to-end tests read a known count; running the seed again changes nothing.

_From 225-brand-picker._

### 225-FR-016 — This story writes nothing to the database (no audit entry, no event, no live update); the data is re-read on each brand change only.

_From 225-brand-picker._

### 229-FR-001 — Home MUST show one place line under the hero: before a place exists, "În toată România · Alege locul" / "All of Romania · Choose a place"; with a place from the browser's location, "Lângă tine · Schimbă" / "Near you · Change"; with a typed address, "Lângă {label} · Schimbă" / "Near {label} · Change" where {label} is the chosen suggestion's label on one line (an over-long label is cut with an ellipsis, never wrapped into a second line); "Alege locul" and "Schimbă" are one button that opens the place dialog. Nothing on Home assumes Bucharest.

_From 229-location-or-address._

### 229-FR-002 — The place dialog MUST hold a "Folosește locația mea" / "Use my location" button and an address field with the suggestion list under it; it is a dialog in the app's overlay pattern (focus trapped, closed by Escape and by choosing a place, focus returning to the button that opened it), works at 320 px with no sideways scroll, in light and dark, Romanian and English. When the browser offers no geolocation the button is not shown.

_From 229-location-or-address._

### 229-FR-003 — The browser's location MUST be asked for only when the visitor taps "Folosește locația mea", never on load; while the request is open the button is disabled and reads "Se caută locația…" / "Finding your location…" and the page keeps working; the request waits at most 10 s (the geolocation `timeout` option, which does not count the time the permission prompt is open). On a position inside Romania the place becomes that point, the dialog closes and the line reads "Lângă tine"; on refusal, timeout, error or a point outside Romania, the address field gets focus with a short hint ("Nu am putut afla locația; scrie o adresă" / "We could not get your location; type an address") and the previous place stays.

_From 229-location-or-address._

### 229-FR-004 — The address field MUST ask the address look-up from the third character, 300 ms after the last key, with the page's language, and show at most 5 suggestions as a listbox the keyboard can walk; choosing one makes it the place (its label and point) and closes the dialog. An empty answer shows "Nu am găsit adresa" / "Address not found"; a failed or rate-limited look-up shows "Nu putem căuta adrese acum" / "We cannot search addresses now" and keeps the previous place; a text under three characters asks nothing and shows nothing. These messages and the hint of FR-003 sit in a polite live region so a screen reader announces them.

_From 229-location-or-address._

### 229-FR-005 — The place MUST be kept in the browser's local storage only (label, point, origin: location or address) and read back on the next visit, so the same browser starts from the last place; a stored value that does not parse or lies outside Romania is dropped. The server never stores the point: it leaves the browser only as a search parameter of the Home and garage search reads.

_From 229-location-or-address._

### 229-FR-006 — For a signed-in driver with a city in Setări and no stored place, Home MUST take that city as the place: the city, read from `GET /api/v1/me` (`MeDto.city`, nullable, added by this story), goes through the address look-up once per load and its first suggestion supplies the point, while the line reads "Lângă {city}" with the Setări text; this place is not written to local storage; when the look-up finds nothing or fails, Home stays on all of Romania with no message. The Setări city is edited in Driver account basics, never here. Home never asks for the session itself: the city is taken once the session is known on the page (a screen opened earlier in the tab loaded it, or a sign-in on Home), because asking on every Home load would renew the refresh cookie for each visitor and apply the account's language to a public page (decided 2026-10-08 in review; the owner may reverse it in a story of its own).

_From 229-location-or-address._

### 229-FR-007 — Whenever the place changes (location, suggestion, stored place, Setări city), the Home read for the selected brand MUST be sent again with the place, exactly once per change, and the count MUST follow the answer; an answer for a place or brand no longer selected is dropped; a failed read follows 225-FR-012 (message and "Reîncearcă"), and the retry repeats the read with the same place. Without a place the Home read carries no point and the count covers all of Romania (225-FR-005 unchanged).

_From 229-location-or-address._

### 229-FR-008 — The point MUST be rounded to three decimals (about 100 m) before it leaves the browser, and the API rounds it again before querying, so one visitor's requests from one spot share one answer and the cached Home answer (`Cache-Control: public, max-age=60`, 225-FR-009) is not spent on metre-level variants.

_From 229-location-or-address._

### 229-FR-016 — Every text of this story MUST live in the shared i18n files in Romanian and English; switching the language keeps the place and re-fills the place line and the dialog.

_From 229-location-or-address._

### 229-FR-017 — The place line and the dialog MUST hold at 320 px, 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll; the button that opens the dialog is at least 44 px tall and the suggestions are at least 44 px tall each.

_From 229-location-or-address._

### 229-FR-018 — This story writes nothing on the server: no audit entry, no event, no live update, no search log (ST-267 owns the search log) and no account field; it reads the garage's position, business kind, service radius and status, and the signed-in driver's city (exposed read-only on `MeDto.city`).

_From 229-location-or-address._

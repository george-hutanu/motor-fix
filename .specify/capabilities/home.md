---
capability: home
updated: 2026-10-10
features:
  - 225-brand-picker
  - 229-location-or-address
  - 230-brand-search
  - 226-best-rated-brand-dial
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

### 230-FR-001 — Home's brand picker MUST show a search field under the tiles labelled "Caută marca" / "Search for a brand", full width of the picker at every size, present in the server-rendered page.

_From 230-brand-search._

### 230-FR-002 — The field MUST suggest active catalogue brands whose name, or any word in it (words split on spaces and hyphens), starts with the typed text, ignoring case, diacritics and surrounding spaces; an empty text MUST suggest nothing.

_From 230-brand-search._

### 230-FR-003 — The field MUST show at most eight suggestions, ordered by popularity rank (1 first), unranked brands after ranked ones, then by name.

_From 230-brand-search._

### 230-FR-004 — Choosing a suggestion MUST select that brand exactly as choosing a tile does: everything on Home that follows the selected brand follows it (today the hero, the count — one Home read for that brand, per 225-FR-006 — and the main button's target; the dial, preview and cards when their stories land); choosing the brand already selected MUST change nothing. After a choice the field MUST be cleared and the suggestions closed.

_From 230-brand-search._

### 230-FR-005 — Reaching for the search field (focus, a key press or a pointer press in it) MUST count as the visitor's first touch of the picker, so the automatic brand change stops while the visitor stays on Home (as 225-FR-007 does for a tile) and the count area starts announcing.

_From 230-brand-search._

### 230-FR-006 — A brand chosen by search that is not among the tiles MUST appear as the selected tile in the first place for as long as the visitor stays on Home (leaving Home and coming back shows the popular tiles again), the other tiles following in their order with the last one dropped, so the picker never shows more than eight tiles; a later search choice outside the tiles MUST replace the earlier searched tile; a brand chosen by search that is among the tiles MUST be selected in place, the order unchanged.

_From 230-brand-search._

### 230-FR-007 — When the typed text matches no active brand the suggestions MUST read "Nicio marcă găsită" / "No brand found"; no text typed in the field is ever selected except by choosing a suggestion.

_From 230-brand-search._

### 230-FR-008 — The field MUST follow the combobox pattern: the arrow keys move the active suggestion (wrapping), Enter chooses it, Escape closes the suggestions, a pointer tap chooses a suggestion, the active suggestion is exposed to assistive technology, the suggestions close when the field loses focus without changing the selection, and focus stays in the field after a choice; a polite announcement MUST give the number of suggestions shown (at most eight) whenever they change, through the message format's plural forms ("1 marcă găsită", "{n} mărci găsite"; "1 brand found", "{n} brands found"), or the no-match text.

_From 230-brand-search._

### 230-FR-009 — The brand list MUST be read from the catalogue's existing public brand read, in the browser, the first time the visitor reaches for the field on this Home view (every page of it, one full read), and filtered in the browser; it MUST NOT be read on the server or when the field is never used. While it loads the field stays usable and keeps the typed text; the suggestion area reads "Se încarcă mărcile…" / "Loading brands…" (announced politely) when text is typed, and suggestions replace it once the list has arrived.

_From 230-brand-search._

### 230-FR-010 — If any page of the brand list fails to load, the whole list counts as failed (nothing partial is suggested): the field MUST be disabled and read "Lista de mărci nu s-a încărcat" / "The brand list did not load" (the message tied to the disabled field for assistive technology) with a "Reîncearcă" / "Try again" button that reads it again, after which the field is enabled again and takes focus; a retry pressed while a read is running is ignored; the tiles, the hero, the count and the main button MUST keep working.

_From 230-brand-search._

### 230-FR-011 — Every text of this story MUST live in the shared i18n files in Romanian and English; switching the language MUST change them and keep the typed text and the selected brand.

_From 230-brand-search._

### 230-FR-012 — The field and its suggestions MUST hold at 320 px, 390 px, tablet and desktop, in light and dark, Romanian and English, with no sideways scroll, touch targets at least 44 px tall (the field, each suggestion and the retry button) and a visible focus ring in both themes; the suggestions open as a layer over the content below the field (they do not push the main button down) and show all eight without an inner scrollbar.

_From 230-brand-search._

### 230-FR-013 — The search field MUST be one self-contained component that loads the brand list itself (FR-009, FR-010, the retry included) and tells its host two things: that the visitor reached for it, and which brand was chosen; it holds no Home-specific behaviour, so the Results page can reuse it as it is.

_From 230-brand-search._

### 230-FR-014 — Choosing a brand on Home MUST write nothing: it is not counted as a search, and no event, audit entry or live update is produced.

_From 230-brand-search._

### 226-FR-001 — Home MUST show the large rating dial (`mf-rating-dial`, size large) under the count, pointing to the rating of the best garage that takes the selected brand in the area, with the rating as a number (one decimal in the language's format, 019-FR-003) and the small label "NOTĂ" / "RATING"; under the dial the garage's name, then one line with its city (when known) and, with a place set, its distance ("3,2 km" / "3.2 km", 229-FR-015), or "Mecanic mobil · vine la tine" / "Mobile mechanic · comes to you" for a mobile mechanic (from its kind, with or without a place), whose city and seat are never shown.

_From 226-best-rated-brand-dial._

### 226-FR-002 — Under the dial Home MUST show the preview: up to three rows, the two best garages that take the brand then the best garage that refuses it or has not marked it, in that order; each row holds a lamp (`mf-lamp`, green for `works_on`, red otherwise) whose label is "Lucrează pe {brand}" / "Works on {brand}" or "Nu primește {brand}" / "Doesn't take {brand}", the garage's name, its rating ("4,9", or "Fără recenzii" / "No reviews yet" with none) and its hourly rate "de la {rate} lei/oră" / "from {rate} lei/hour" from the garage's labour-from price in whole lei (left out when the garage has none). The slots are fixed (two takers, one refuser); with fewer garages than slots only the existing rows are shown, no empty row, and a missing taker is never replaced by a refuser (only FR-004's no-taker state shows up to three refusers).

_From 226-best-rated-brand-dial._

### 226-FR-003 — Each preview row MUST be one link to the garage's public profile in the current language with the brand carried (`?brand={slug}`, as the Results cards do), at least 44 px tall, and the whole row is the hit area.

_From 226-best-rated-brand-dial._

### 226-FR-004 — When the Home read's answer carries no best garage, the dial MUST rest at 0 ("—", empty arc, its accessible name the "nobody takes it" line below) and, in place of the garage's name, read "Niciun service din zonă nu primește încă {brand}" / "No garage nearby takes {brand} yet"; the preview shows the refusing rows that exist (up to three, same order). When the answer's `total` is 0 and a place is set, the line reads "Niciun service în 25 km" / "No garage within 25 km" followed by a button "Schimbă locul" / "Change place" that opens the place dialog; without a place and `total` 0, the "nobody takes it" line stands.

_From 226-best-rated-brand-dial._

### 226-FR-005 — While the Home read is loading, the dial MUST show 0 and a greyed (dimmed) state with a skeleton line in place of the name and three skeleton rows in the preview, the area marked busy; while it has failed, the count area's message and retry (225-FR-012) stand and the dial stays at 0 with no name and no rows. A retry refills the dial and the preview from the same read.

_From 226-best-rated-brand-dial._

### 226-FR-006 — On every brand or place change the dial and the preview MUST follow the one Home read of 225-FR-006 and 229-FR-007 (no second request), changing at the same moment the count does; the needle and arc move to the new value through the shared dial motion (053-FR-003) and jump with reduced motion. The dial's change is announced through the count area's existing live region (no second region, polite only after the picker was touched), adding "{rating} · {garage name}" or the "nobody takes it" line to what it reads.

_From 226-best-rated-brand-dial._

### 226-FR-007 — Every text of this story MUST live in the shared i18n files in Romanian and English; the dial, the rows and the formats re-render on a language switch without a new read.

_From 226-best-rated-brand-dial._

### 226-FR-008 — The dial and the preview MUST hold at 320 px, 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll; the dial is at most 240 px wide and centred on a phone; the lamp's label and rate text are at least 12 px and the lamp's dot colour comes from the tokens; the preview's rows are 44 px tall at least; a name or city longer than its line wraps inside the row and never widens it, and a row shows the shared focus ring of the Cockpit theme when focused by keyboard.

_From 226-best-rated-brand-dial._

### 226-FR-012 — The development seed MUST give the eight listed garages ratings, review counts and labour-from prices such that, near Bucharest with Dacia selected, the dial names one known garage, the preview holds two known takers and one known refuser, two takers share a rating and differ by reviews, and one taker has no reviews; the Cluj-Napoca mobile mechanic takes Dacia, so a place in Cluj-Napoca names it on the dial with "Mecanic mobil · vine la tine".

_From 226-best-rated-brand-dial._

### 226-FR-013 — This story writes nothing at run time (no audit entry, no event, no live update, no search log); the data is re-read on each brand or place change only. No new route: the Home read stays public and the public routes list is unchanged. No new service, queue or outside call: the PR's Observability section says so, and the existing Home read metrics (if any) cover it.

_From 226-best-rated-brand-dial._

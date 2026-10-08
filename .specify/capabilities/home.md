---
capability: home
updated: 2026-10-08
features:
  - 225-brand-picker
  - 230-brand-search
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

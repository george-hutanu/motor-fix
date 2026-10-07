---
capability: brand-verdict
updated: 2026-10-07
features:
  - 042-brand-verdict
---

# Capability: Brand verdict

The one shared part that tells a driver whether a garage takes their brand: a green or red lamp with its text label for the chosen brand, the lists of brands the garage works on and refuses (or the specialist phrase that stands in for the refusal names), and the garage's note, drawn from the garage data the API returns wherever a screen places it. Empty until its first feature is archived.

## Requirements

### 042-FR-001 — The web app MUST have one shared part, the brand verdict, that is given a garage's brand answer (the works-on list and the refusal list, each brand with id and name, the optional note and the optional phrase, the shape the public garage read and the results items return), an optional chosen brand (id and name), a mode (card or profile) and whether the data is still loading, and draws from them the lamp with its label, the two lists and the note; it holds no data of its own and makes no call, so every screen that places it shows the same thing.

_From 042-brand-verdict._

### 042-FR-002 — The verdict for the chosen brand MUST be `works_on` when the brand's id is in the garage's works-on list and `refused` otherwise; `refused` covers a brand in the refusal list and a brand in neither list alike. The rule MUST live in one place, used by the part wherever the verdict is shown.

_From 042-brand-verdict._

### 042-FR-003 — With a chosen brand the part MUST show a lamp and a text label: green with "Lucrează pe {brand}" ("Works on {brand}") for `works_on`, red with "Nu primește {brand}" ("Does not take {brand}") for `refused`, the brand's name as the catalogue holds it. The lamp MUST be decorative (hidden from assistive technology) and the label MUST carry the meaning, so the verdict never relies on colour alone; the label's text, the loading text, the list lines and the note have 4.5:1 contrast and the lamp 3:1 against its background in both themes.

_From 042-brand-verdict._

### 042-FR-004 — With no chosen brand the part MUST show no lamp and no label, only the lists and the note.

_From 042-brand-verdict._

### 042-FR-005 — While loading, whether or not a brand is chosen, the part MUST show a grey lamp placeholder with the text "Se încarcă…" ("Loading…") and no lists or note; when the data arrives the placeholder is replaced in place.

_From 042-brand-verdict._

### 042-FR-006 — The part MUST show the works-on list as "Lucrează pe: " ("Works on: ") followed by the brand names joined by ", " in the order given, and the refusal list as "Nu primește: " ("Does not take: ") likewise, holding only the brands the garage marked refused. A line with nothing to show (an empty works-on list; an empty refusal list with no phrase) MUST be hidden while the other line has content; when both lists are empty and there is no phrase, both lines MUST read "nimic ales încă" ("nothing picked yet").

_From 042-brand-verdict._

### 042-FR-007 — When the garage has a phrase (a text with at least one non-space character; an empty or blank one counts as none), the refusal line MUST read "Nu primește: {phrase}" in place of the refused brand names, whatever the refusal list holds.

_From 042-brand-verdict._

### 042-FR-008 — When the garage has a note, in profile mode the part MUST show it in full under the lists; in card mode it MUST show it on one line, cut with an ellipsis, with the full text available to assistive technology; with no note nothing is shown.

_From 042-brand-verdict._

### 042-FR-009 — Every text the part owns MUST be in the page's language, Romanian or English, through the app's translations; brand names, the note and the phrase MUST be shown as the garage wrote them.

_From 042-brand-verdict._

### 042-FR-010 — When the part is given a new answer, a new chosen brand or a new mode, it MUST redraw the lamp, the label, the lists and the note from the new values at once, without being re-created and without a page reload, so a screen that re-reads the garage on a live update needs only to hand it the new data. The redraw is silent: the part adds no live-region announcement of its own, the placing screen decides whether a change is announced.

_From 042-brand-verdict._

### 042-FR-011 — The part MUST obey the phone layout rules wherever it sits: no sideways scroll at 320 px, no text under 12 px, light and dark theme following the device, the lists wrapping onto as many lines as they need.

_From 042-brand-verdict._

## Retired

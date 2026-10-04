---
capability: cockpit-gauges
updated: 2026-10-04
features:
  - 051-cockpit-gauges
---

# Capability: cockpit-gauges

The shared Cockpit parts that show a status, a rating and a price the same way on every screen: the indicator lamp, the rating dial in two sizes and the odometer digits, in `libs/ui-cockpit`.

## Requirements

### 051-FR-001 — The indicator lamp MUST show a small glowing dot in one of four states — green, red, amber, grey — with a text label beside it.

_From 051-cockpit-gauges._

### 051-FR-002 — The lamp's label MUST be a required input, so a lamp without a label fails to compile.

_From 051-cockpit-gauges._

### 051-FR-003 — The lamp's dot MUST be hidden from assistive technology; the label is the text read.

_From 051-cockpit-gauges._

### 051-FR-004 — The lamp's state input MUST be typed as the four states; a value outside them arriving at run time (from data) MUST show grey and, when Angular runs in development mode, log one console warning per such value set.

_From 051-cockpit-gauges._

### 051-FR-005 — In both themes, every lamp dot MUST have at least 3:1 contrast with the page, panel and raised surfaces, and the label at least 4.5:1.

_From 051-cockpit-gauges._

### 051-FR-006 — The rating dial MUST draw a 0–5 gauge (a 240° track) whose amber arc fills value/5 of the track, with the rating in the centre written through the language's rating format (one decimal), rounded half up to one decimal and clamped to 0–5. The arc is drawn in the amber ink token, so it keeps 3:1 against the surfaces in both themes.

_From 051-cockpit-gauges._

### 051-FR-007 — A dial with no rating — no value, a value that is not a finite number, or a value that rounds to 0 or less — MUST show an empty arc and "—", never "0,0".

_From 051-cockpit-gauges._

### 051-FR-008 — The dial MUST exist in a large and a small size. The large one fills its container's width up to 240 px and carries a needle pointing at the value; the small one is 60 px square (at least 44 px) with its number at least 12 px and no needle.

_From 051-cockpit-gauges._

### 051-FR-009 — The dial MUST have one accessible name in the current language: "Rating {value} out of 5" with the formatted value, or "No reviews yet" (Romanian and English texts in the shared i18n files).

_From 051-cockpit-gauges._

### 051-FR-010 — The odometer MUST take an amount in integer bani, or a from–to range, round each amount to the nearest leu, and show it through the ST-19 price formats (whole lei, en dash for a range, equal ends collapsed, a missing end as "—") in the Michroma label face; with no amount it shows "—".

_From 051-cockpit-gauges._

### 051-FR-011 — The odometer MUST give assistive technology only the complete formatted value, in one polite, atomic live region, with the individual digits hidden from it.

_From 051-cockpit-gauges._

### 051-FR-012 — The three parts MUST NOT animate in this story, and MUST leave the hooks the motion story needs: the lamp takes an optional pulse marker that only marks the host; the dial exposes its fill (0–1) as a custom property on the host; the odometer renders each digit as its own element carrying its digit as a custom property.

_From 051-cockpit-gauges._

### 051-FR-013 — The three parts MUST take every colour, font, radius and spacing from the Cockpit `--mf-*` tokens, in dark and light (part-specific geometry — stroke widths, the dot size, the odometer digit cell's 8 px radius and 2 px gap from the mock, and the large dial's 40 px display numeral, none of which a token matches — stays in the part's own styles), and MUST fit a 320 px wide screen. In forced-colours mode the lamp dot keeps a visible outline.

_From 051-cockpit-gauges._

### 051-FR-014 — The component catalogue (the `/cockpit` sample page) MUST show every state of the three parts, with its texts through i18n keys in Romanian and English.

_From 051-cockpit-gauges._

### 051-FR-015 — The three parts MUST be exported from the `@motor-fix/ui-cockpit` library for later screens.

_From 051-cockpit-gauges._

## Retired

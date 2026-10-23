---
capability: cockpit-gauges
updated: 2026-10-23
features:
  - 051-cockpit-gauges
  - 053-motion
  - 466-odometer-digit-wrap
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

### 053-FR-012 — The lamp, the rating dial and the odometer MUST move only as 053-FR-003, 053-FR-004 and 053-FR-006 (cockpit-motion) describe, through the hooks ST-51 left (the pulse marker, the dial's fill and needle, the per-digit cells); they are still with reduced motion. This replaces ST-51's rule that the three parts do not animate.

_From 053-motion._

### 466-FR-002 — At 200 % text size, the range odometer on the `/cockpit` sample page MUST show each amount whole on one line at 320 px and 390 px wide, in light and dark, in Romanian and English; no screenshot shows a split amount such as "1,250–1,60" / "0 lei".

_From 466-odometer-digit-wrap._

### 051-FR-014 — The component catalogue (the `/cockpit` sample page) MUST show every state of the three parts, with its texts through i18n keys in Romanian and English.

_From 051-cockpit-gauges._

### 051-FR-015 — The three parts MUST be exported from the `@motor-fix/ui-cockpit` library for later screens.

_From 051-cockpit-gauges._

### 466-FR-001 — The odometer MUST render each amount, together with the unit that follows it, as one unbreakable group, so that a line can break only between the groups of a range (after the first amount's en dash), never between the digits of one amount or between an amount and its unit.

_From 466-odometer-digit-wrap._

### 466-FR-005 — A colocated spec in `libs/ui-cockpit/src/lib/odometer.spec.ts` MUST assert the grouping — a range renders exactly two amount groups and a single price exactly one, each digit inside its group — and MUST fail on today's one-item-per-character markup.

_From 466-odometer-digit-wrap._

## Retired

- `051-FR-012` — superseded by `053-FR-012` (2026-10-04)
- `051-FR-013` — superseded by `466-FR-002` (2026-10-23)

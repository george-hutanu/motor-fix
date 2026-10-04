---
capability: locale-formats
updated: 2026-10-04
features:
  - 019-locale-formats
---

# Capability: locale-formats

How the web app writes money, numbers, ratings, distances, percentages, dates and times in Romanian and English, in Bucharest time, and the calendar names standard controls use.

## Requirements

### 019-FR-001 — Money given as whole bani MUST show in lei with the language's thousands and decimal separators, followed by an ordinary space (U+0020) and "lei" in both languages; whole lei with no decimals, otherwise exactly two decimals.

_From 019-locale-formats._

### 019-FR-002 — A money range MUST show as "<from>–<to> lei" with an en dash and no spaces, both ends formatted as in FR-001; equal ends show one amount, and both ends take two decimals when either end is not whole lei.

_From 019-locale-formats._

### 019-FR-003 — A rating MUST show with exactly one decimal in the language's decimal separator.

_From 019-locale-formats._

### 019-FR-004 — A plain number MUST show with the language's thousands and decimal separators; a distance in km MUST show with at most one decimal followed by " km"; a percentage MUST show as a whole number followed by "%" with no space, in both languages.

_From 019-locale-formats._

### 019-FR-005 — A date MUST show as day, abbreviated month and year — "9 mart. 2026" in Romanian, "9 Mar 2026" in English — with Romanian abbreviations ian., feb., mart., apr., mai, iun., iul., aug., sept., oct., nov., dec. and English abbreviations Jan … Dec (three letters).

_From 019-locale-formats._

### 019-FR-006 — A time MUST show as hours and minutes on a 24-hour clock with two digits each ("14:30", "09:05") in both languages.

_From 019-locale-formats._

### 019-FR-007 — Every date and time MUST be shown in the Europe/Bucharest time zone, independent of the device's time zone.

_From 019-locale-formats._

### 019-FR-008 — A missing or invalid value given to any format MUST show "—": for numbers anything that is not a finite `number`; for dates and times anything other than a `Date`, an ISO-8601 string or epoch milliseconds that gives a valid date.

_From 019-locale-formats._

### 019-FR-009 — Month names (full and short) and day names (full and short, starting on Monday), together with Monday as the first day of the week, MUST be available per language as one plain object for date pickers and other standard controls, using the same short month names as FR-005.

_From 019-locale-formats._

### 019-FR-010 — Every format MUST follow the current language, and MUST change on screen as soon as the language changes, without a reload.

_From 019-locale-formats._

### 019-FR-011 — A server-rendered page MUST show the Romanian formats, matching the page's Romanian text and the browser's first render.

_From 019-locale-formats._

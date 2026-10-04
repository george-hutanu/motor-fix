# Feature Specification: Prices, numbers and dates in the format of my language

**Feature Branch**: `019-locale-formats`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-19 — See prices, numbers and dates in the format of my language (Romanian and English): number, price (RON) and date formats per active language, built on the ST-16 i18n runtime in libs/i18n. Notion story: https://app.notion.com/p/3ee607bff0d28180a6a4e24b1d161a9b. Spec folder and branch: 019-locale-formats."

**Sources**: Notion story ST-19 https://app.notion.com/p/3ee607bff0d28180a6a4e24b1d161a9b (read 2026-10-04, page edited 2026-10-03; no discussions) · epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 · feature https://app.notion.com/p/3ee607bff0d281618e30f8787e2c3dd3 · depends on ST-16 https://app.notion.com/p/3ee607bff0d281c3927ec1b8e980be00 (merged, `libs/i18n`). The story's Build brief wins over the story body.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prices and numbers read the way my language writes them (Priority: P1)

A visitor reading MotorFix in Romanian sees "1.400 lei" and a rating of "4,9";
the same visitor in English sees "1,400 lei" and "4.9". Price ranges,
distances and percentages follow the same rules.

**Why this priority**: A price read wrong (1,400 vs 1.400) is the mistake the
story exists to prevent; prices and ratings appear on Home, Results, the
garage profile and every dashboard.

**Independent Test**: Format each example amount, rating, range, distance and
percentage in both languages and compare with the expected text.

**Acceptance Scenarios**:

1. **Given** 140 000 bani, **then** it reads "1.400 lei" in Romanian and "1,400 lei" in English.
2. **Given** 140 050 bani, **then** it reads "1.400,50 lei" in Romanian and "1,400.50 lei" in English.
3. **Given** a rating of 4.9, **then** it reads "4,9" in Romanian and "4.9" in English; a rating of 5 reads "5,0" / "5.0".
4. **Given** a range of 80 000 to 120 000 bani, **then** it reads "800–1.200 lei" in Romanian and "800–1,200 lei" in English, with an en dash.
5. **Given** a distance of 2.5 km, **then** it reads "2,5 km" in Romanian and "2.5 km" in English.
6. **Given** a percentage of 92, **then** it reads "92%" in both languages.
7. **Given** a plain number 12 345.6, **then** it reads "12.345,6" in Romanian and "12,345.6" in English.

---

### User Story 2 - Dates and times read the way my language writes them, in Bucharest time (Priority: P1)

A visitor sees "9 mart. 2026" in Romanian and "9 Mar 2026" in English, and
times as "14:30" on a 24-hour clock in Bucharest time, whatever time zone the
device is set to.

**Why this priority**: Booking dates and opening hours are read on every
appointment screen; a time shifted by the device's zone is a missed
appointment.

**Independent Test**: Format 9 March 2026 and 14:30 Bucharest time in both
languages, once with the process set to another time zone.

**Acceptance Scenarios**:

1. **Given** 9 March 2026, **then** it reads "9 mart. 2026" in Romanian and "9 Mar 2026" in English.
2. **Given** the instant 14:30 Bucharest time, **then** it reads "14:30" in both languages.
3. **Given** a device set to another time zone (for example America/New_York), **when** the same instant is shown, **then** the date and time still read in Bucharest time.
4. **Given** the instant 23:30 UTC on 8 March 2026 (01:30 on 9 March in Bucharest), **then** the date reads "9 mart. 2026" / "9 Mar 2026".

---

### User Story 3 - Standard controls name months and days in my language (Priority: P2)

A date picker or any other standard control shows month and day names in the
chosen language, and its weeks start on Monday.

**Why this priority**: Needed by the first screen that shows a date picker
(booking); no such control exists yet, so this story provides the names and
the first day of the week for it to use.

**Independent Test**: Read the calendar names for each language and compare
the month names, the day names in order from Monday, and the first day.

**Acceptance Scenarios**:

1. **Given** Romanian, **then** the months read "ianuarie" … "decembrie" (short "ian." … "dec.", with "mart." for March), the days read from "luni" to "duminică" (short "lun." … "dum."), and the week starts on Monday.
2. **Given** English, **then** the months read "January" … "December" (short "Jan" … "Dec"), the days read from "Monday" to "Sunday" (short "Mon" … "Sun"), and the week starts on Monday.

---

### User Story 4 - Switching language changes every format at once (Priority: P1)

A visitor looking at a screen with prices and dates switches the language: every
price, number and date on the screen changes format at once, without a
reload.

**Why this priority**: The acceptance criterion "with no reload" and the
mock's RO / EN switch on every board depend on it.

**Independent Test**: Render a screen showing a price, a rating and a date in
Romanian, switch the language to English, and observe the same screen
instance showing the English formats.

**Acceptance Scenarios**:

1. **Given** a screen showing "1.400 lei", "4,9" and "9 mart. 2026", **when** the language is set to English, **then** the same screen shows "1,400 lei", "4.9" and "9 Mar 2026" without reloading.
2. **Given** English, **when** the language is set back to Romanian, **then** the Romanian formats return.

### Edge Cases

- A missing value (`null`, `undefined`, a non-number, a non-finite number, or
  a date input that gives an invalid date) shows "—"; a numeric string is
  not a number, and a date string that is not ISO-8601 (a date, or a date
  and time with its offset) is not a date.
- An inverted range (from above to) is shown as given.
- A range with one end missing shows "—"; a range whose ends are equal shows a
  single amount ("800 lei").
- A range where either end is not whole lei shows both ends with two decimals.
- A negative amount shows a hyphen-minus before the number ("-1.400 lei" /
  "-1,400 lei").
- Amounts are whole bani; a fractional bani value is rounded to the nearest
  ban before formatting.
- A rating is rounded to one decimal (4.96 reads "5,0" / "5.0").
- A distance shows at most one decimal (12 km reads "12 km", 0.25 km reads
  "0,3 km" / "0.3 km").
- A percentage is rounded to a whole number.
- A rating outside 0–5 or a percentage outside 0–100 is shown as given; the
  format does not validate the data.
- A date-only ISO string ("2026-03-09") is read as midnight UTC, which is the
  same calendar day in Bucharest.
- Server-rendered pages show the Romanian formats, with the same text the
  browser shows on hydration, before any language switch.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Money given as whole bani MUST show in lei with the language's
  thousands and decimal separators, followed by an ordinary space (U+0020) and "lei" in
  both languages; whole lei with no decimals, otherwise exactly two decimals.
- **FR-002**: A money range MUST show as "<from>–<to> lei" with an en dash and
  no spaces, both ends formatted as in FR-001; equal ends show one amount, and
  both ends take two decimals when either end is not whole lei.
- **FR-003**: A rating MUST show with exactly one decimal in the language's
  decimal separator.
- **FR-004**: A plain number MUST show with the language's thousands and
  decimal separators; a distance in km MUST show with at most one decimal
  followed by " km"; a percentage MUST show as a whole number followed by "%"
  with no space, in both languages.
- **FR-005**: A date MUST show as day, abbreviated month and year — "9 mart.
  2026" in Romanian, "9 Mar 2026" in English — with Romanian abbreviations
  ian., feb., mart., apr., mai, iun., iul., aug., sept., oct., nov., dec. and
  English abbreviations Jan … Dec (three letters).
- **FR-006**: A time MUST show as hours and minutes on a 24-hour clock with two
  digits each ("14:30", "09:05") in both languages.
- **FR-007**: Every date and time MUST be shown in the Europe/Bucharest time
  zone, independent of the device's time zone.
- **FR-008**: A missing or invalid value given to any format MUST show "—":
  for numbers anything that is not a finite `number`; for dates and times
  anything other than a `Date`, an ISO-8601 string or epoch milliseconds that
  gives a valid date.
- **FR-009**: Month names (full and short) and day names (full and short,
  starting on Monday), together with Monday as the first day of the week,
  MUST be available per language as one plain object for date pickers and
  other standard controls, using the same short month names as FR-005.
- **FR-010**: Every format MUST follow the current language, and MUST change
  on screen as soon as the language changes, without a reload.
- **FR-011**: A server-rendered page MUST show the Romanian formats, matching
  the page's Romanian text and the browser's first render.

### Key Entities

- **Amount**: money as a whole number of bani (1 leu = 100 bani).
- **Instant**: a point in time, shown in Bucharest time.
- **Calendar names**: per language, the month names, day names and first day of the week.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every example in the story's acceptance scenarios (prices,
  ratings, ranges, distances, percentages, dates, times) reads exactly as
  written, in both languages.
- **SC-002**: After a language change, 100% of the formatted values on the
  screen are in the new language's format, and the page was not reloaded.
- **SC-003**: The same instant shows the same date and time on a device in
  any time zone.
- **SC-004**: Zero blank or "NaN"/"Invalid Date" texts are shown for missing
  values.

## Clarifications

### Session 2026-10-04

- Q: Do formats use the platform's Intl (ro-RO, en-GB) or Angular's
  registered locale data? → A: Intl. The Build brief fixes ro-RO / en-GB
  Intl; the Technology stack row naming the Angular locale is Proposed, its
  `getLocale*` helpers are deprecated since Angular 18
  (`@angular/common/types/common.d.ts`), its `formatDate` takes only fixed
  offsets (no Europe/Bucharest daylight saving), and both routes need the
  same hand-fixed month table ("mart.", "Sep"). No dependency added
  (Principle I).
- Q: What inputs do the formats accept, and which show "—"? → A: Numbers take
  a `number`; `null`, `undefined`, a non-number or a non-finite number shows
  "—". Dates and times take a `Date`, an ISO-8601 string or epoch
  milliseconds; anything that gives an invalid date shows "—". An inverted
  range is shown as given.
- Q: In what shape are the calendar names exposed, and does the future
  Spartan picker read them? → A: One plain per-language object (full and
  short months, full and short days from Monday, first day Monday) in the
  i18n library, no provider or adapter; the Spartan picker (Technology stack,
  decided 2026-10-04) reads these names so its header agrees with the date
  format ("mart.").
- Q: Must the server render formats in the visitor's language? → A: No. The
  server renders Romanian, as it does for text; the browser shows the same
  text on hydration, before any language switch, and reformats when the
  language changes.
- Q: Which characters are the unit space and the minus sign? → A: An ordinary
  space (U+0020) before "lei" and "km", and the hyphen-minus (U+002D) before
  the number, in both languages ("-1.400 lei" / "-1,400 lei"). Keeping a
  value on one line is a screen style, not the format's job.

## Assumptions

- The Build brief's *(proposed)* defaults are taken as written: whole lei
  shown without decimals and other amounts with two, "lei" in both languages,
  en dash for ranges, 24-hour clock, weeks starting on Monday, "92%" in both
  languages, "—" for a missing value, locales ro-RO and en-GB.
- Romanian short month names are fixed by this story (DEX style, "mart." for
  March, as the acceptance criteria write it) rather than taken from the
  browser, whose current data writes "mar."; English short names are the
  three-letter forms ("Sep", not "Sept"). Fixed names also keep the server
  and the browser in agreement. (autonomous default)
- A percentage is given as the number shown (92 → "92%"), not as a fraction.
  (autonomous default)
- A distance is given in kilometres. (autonomous default)
- No date picker exists in the app yet; this story provides the names and
  first day it needs (FR-009), and the story that first shows a picker wires
  them in. The picker is Spartan's (Technology stack, decided 2026-10-04,
  superseding the Build brief's PrimeNG locale); Spartan is not installed on
  `main`, so nothing library-specific is added here. (autonomous default)
- The end-to-end test "on Results, switch language" waits for the Results
  screen and the RO / EN switch (ST-17), neither of which exists on `main`;
  the instant change is proven by a component test that switches the language
  on a rendered screen. (autonomous default)
- Formats inside e-mails and messages are out of scope (Build brief).

## Spec Delta

### Capability: `locale-formats`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011

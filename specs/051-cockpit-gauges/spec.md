# Feature Specification: The shared indicator lamp, rating dial and odometer digits

**Feature Branch**: `051-cockpit-gauges`

**Created**: 2026-10-04

**Status**: Archived (2026-10-04)

**Input**: User description: "ST-51 — Build the shared indicator lamp, rating dial and odometer digits in libs/ui-cockpit, on the merged Cockpit theme (ST-50) and showing numbers through the ST-19 locale formats in libs/i18n. Notion story: https://app.notion.com/p/3ee607bff0d281e4a0d7e24116a9b9fc. Spec folder and branch: 051-cockpit-gauges."

**Sources**: Notion story ST-51 https://app.notion.com/p/3ee607bff0d281e4a0d7e24116a9b9fc (read 2026-10-04, page edited 2026-10-03; no discussions) · epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (Build plan, slice 2) · feature https://app.notion.com/p/3ee607bff0d2817aa8bdc2f304d558b2 · depends on ST-50 (Cockpit theme, merged, `libs/ui-cockpit`) and ST-19 (locale formats, merged, `libs/i18n`). The story's Build brief wins over the story body. Motion (ST-53) is out of scope by the orchestrator's instruction for this run.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A status reads the same way on every screen (Priority: P1)

A driver looking at a garage sees small lamps such as a green "Lucrează pe
Dacia" (works on Dacia) or a red "Nu ia Dacia". The colour and the words always
come together, so the meaning never rests on colour alone.

**Why this priority**: lamps are on every board of the mock; every later
screen that shows a status uses this part.

**Independent Test**: render a lamp in each of the four states with a label,
in dark and light, and check the dot, the label, what a screen reader reads,
and the contrast of each.

**Acceptance Scenarios**:

1. **Given** a lamp with state green and label "Lucrează pe Dacia", **when** it renders, **then** a small glowing green dot shows with the label beside it; screen readers read the label and the dot is hidden from them.
2. **Given** a lamp written without a label, **when** the app is built, **then** compilation fails.
3. **Given** the four states green, red, amber and grey, **when** they render in dark and in light, **then** each dot has at least 3:1 contrast with the page, panel and raised surfaces, and each label at least 4.5:1.
4. **Given** a lamp given a state that is not one of the four, **when** it renders, **then** it shows grey, and a development build logs a warning.

---

### User Story 2 - A rating reads as a gauge in my language (Priority: P1)

A driver sees a garage's rating as a dial from 0 to 5: an amber arc filled to
the rating, with the number in the middle written the way their language
writes it — "4,8" in Romanian, "4.8" in English. A garage with no reviews
shows an empty arc and "—", never "0,0".

**Why this priority**: the large dial is the centre of Home and the garage
profile; small dials sit on every result card and row.

**Independent Test**: render the dial with 4.8, with no rating, and in both
sizes, in both languages, and check the arc fill, the centre text and the
accessible name.

**Acceptance Scenarios**:

1. **Given** a rating of 4.8, **when** the large dial renders in Romanian, **then** the amber arc fills 4.8/5 of the gauge and the centre reads "4,8"; in English it reads "4.8".
2. **Given** no rating (no reviews yet), **when** the dial renders, **then** the arc is empty and the centre reads "—".
3. **Given** a rating of 0, **when** the dial renders, **then** it reads "—" with an empty arc, as with no reviews.
4. **Given** a rating of 4.85 or 4.75, **when** the dial renders, **then** it is rounded half up to one decimal: "4,9" and "4,8".
5. **Given** a small dial on a result card, **when** it renders, **then** it is at least 44 px square and its number is at least 12 px.
6. **Given** a dial, **when** a screen reader reaches it, **then** it hears one phrase in the current language, such as "Rating 4.8 out of 5", or "No reviews yet".

---

### User Story 3 - A price reads in odometer digits (Priority: P2)

A driver sees an estimate such as "1.250–1.600 lei" in the Cockpit's
odometer digits (Michroma numerals), in their language's format, as whole lei.
When the estimate changes, the new value shows, and a screen reader hears the
new value once.

**Why this priority**: the odometer is placed on the garage profile later
(Discovery and garage profile); this story delivers the part.

**Independent Test**: render the odometer from bani with a single value, a
range, and nothing, in both languages; change the value and check the text
and what a screen reader is told.

**Acceptance Scenarios**:

1. **Given** an estimate of 125000 to 160000 bani, **when** the odometer renders in Romanian, **then** it shows "1.250–1.600 lei" in Michroma numerals; in English "1,250–1,600 lei".
2. **Given** the estimate changes to 140000–180000 bani, **when** the value updates, **then** it shows "1.400–1.800 lei", and the text a screen reader is given is only the final value, once.
3. **Given** a single price of 140050 bani, **when** it renders, **then** it shows whole lei, "1.401 lei", with no decimals.
4. **Given** no price, **when** it renders, **then** it shows "—".
5. **Given** reduced motion on the device, **when** the value changes, **then** the digits change without rolling.

---

### User Story 4 - The parts can be reviewed in one place (Priority: P3)

The owner and later stories open the component catalogue and see every state of
the three parts, in both themes and both languages, at phone and desktop widths.

**Why this priority**: it is how the owner reviews the parts and how later
stories find them; nothing in the product depends on it.

**Independent Test**: open the catalogue at 375 px and 1280 px, in dark and
light, and see each part in each state with no horizontal scrolling.

**Acceptance Scenarios**:

1. **Given** the catalogue page, **when** it opens, **then** it shows the four lamps, a large and a small dial with a rating and with none, and the odometer with a single value, a range and nothing.
2. **Given** a 320 px wide screen, **when** the catalogue opens, **then** none of the three parts overflows its container.

### Edge Cases

- A rating outside 0–5 (bad data) is clamped to 0 or 5 for the arc and the number.
- A rating that is not a finite number (NaN, a string) reads as no rating.
- An odometer range whose two ends round to the same lei shows one value.
- An odometer value with a missing end shows "—" (ST-19's range rule).
- An odometer amount in bani that does not round to whole lei is rounded to the nearest leu before formatting.
- A language switch re-renders the dial and the odometer in place.

## Clarifications

### Session 2026-10-04

- Q: Does a rating of 0 show "—"? → A: Yes; anything that rounds to 0 or less, a missing value and a non-number all read as no rating (MF-3 edge case; a 1–5 review scale gives no real 0). (autonomous, recommended)
- Q: Which motion hooks does this story leave? → A: The lamp's pulse marker (ST-51 Rules "Lamp pulse: optional"; ST-53 "a lamp marked as pulsing"), a static needle on the large dial (ST-51 "The swing of the needle is ST-53"; mock Home), the dial's fill custom property and per-digit odometer cells. Nothing animates. (autonomous; the Build brief wins over the challenger's Principle I reading)
- Q: Is the odometer a live region or a labelled image? → A: A polite, atomic live region holding the full value as hidden text; the digits are hidden. (autonomous, recommended)
- Q: Is the large dial fixed or fluid? → A: Fluid up to 240 px; the small one fixed at 60 px as in the mock. (autonomous, recommended)
- Q: Tokens for geometry, and which amber draws the arc? → A: Colours, fonts, radii, spacing from existing tokens; geometry local to each part; the arc uses the amber ink token like the amber lamp (no cockpit.css edit while ST-52 works there). (autonomous, recommended)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The indicator lamp MUST show a small glowing dot in one of four states — green, red, amber, grey — with a text label beside it.
- **FR-002**: The lamp's label MUST be a required input, so a lamp without a label fails to compile.
- **FR-003**: The lamp's dot MUST be hidden from assistive technology; the label is the text read.
- **FR-004**: The lamp's state input MUST be typed as the four states; a value outside them arriving at run time (from data) MUST show grey and, when Angular runs in development mode, log one console warning per such value set.
- **FR-005**: In both themes, every lamp dot MUST have at least 3:1 contrast with the page, panel and raised surfaces, and the label at least 4.5:1.
- **FR-006**: The rating dial MUST draw a 0–5 gauge (a 240° track) whose amber arc fills value/5 of the track, with the rating in the centre written through the language's rating format (one decimal), rounded half up to one decimal and clamped to 0–5. The arc is drawn in the amber ink token, so it keeps 3:1 against the surfaces in both themes.
- **FR-007**: A dial with no rating — no value, a value that is not a finite number, or a value that rounds to 0 or less — MUST show an empty arc and "—", never "0,0".
- **FR-008**: The dial MUST exist in a large and a small size. The large one fills its container's width up to 240 px and carries a needle pointing at the value; the small one is 60 px square (at least 44 px) with its number at least 12 px and no needle.
- **FR-009**: The dial MUST have one accessible name in the current language: "Rating {value} out of 5" with the formatted value, or "No reviews yet" (Romanian and English texts in the shared i18n files).
- **FR-010**: The odometer MUST take an amount in integer bani, or a from–to range, round each amount to the nearest leu, and show it through the ST-19 price formats (whole lei, en dash for a range, equal ends collapsed, a missing end as "—") in the Michroma label face; with no amount it shows "—".
- **FR-011**: The odometer MUST give assistive technology only the complete formatted value, in one polite, atomic live region, with the individual digits hidden from it.
- **FR-012**: The three parts MUST NOT animate in this story, and MUST leave the hooks the motion story needs: the lamp takes an optional pulse marker that only marks the host; the dial exposes its fill (0–1) as a custom property on the host; the odometer renders each digit as its own element carrying its digit as a custom property.
- **FR-013**: The three parts MUST take every colour, font, radius and spacing from the Cockpit `--mf-*` tokens, in dark and light (part-specific geometry — stroke widths, the dot size, the odometer digit cell's 8 px radius and 2 px gap from the mock, and the large dial's 40 px display numeral, none of which a token matches — stays in the part's own styles), and MUST fit a 320 px wide screen. In forced-colours mode the lamp dot keeps a visible outline.
- **FR-014**: The component catalogue (the `/cockpit` sample page) MUST show every state of the three parts, with its texts through i18n keys in Romanian and English.
- **FR-015**: The three parts MUST be exported from the `@motor-fix/ui-cockpit` library for later screens.

### Key Entities

- **Lamp state**: one of green (works on this brand, in order, on time), red (does not take this brand, or a problem), amber (needs attention), grey (neutral or off).
- **Rating**: a number from 0 to 5, or nothing when there are no reviews.
- **Price**: an amount in integer bani, VAT included, or a from–to range of two amounts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All four lamp states and the dial arc pass the contrast floors (3:1 dot and arc, 4.5:1 label) against all three surfaces in both themes — 30 graphic pairs and 6 label pairs.
- **SC-002**: The scenario values read exactly as the Build brief writes them in both languages: "4,8" / "4.8", "—", "1.250–1.600 lei", "1.400–1.800 lei".
- **SC-003**: At 320 px, 375 px and 1280 px wide, none of the parts overflows its container in either theme.
- **SC-004**: A screen reader is given one text per part: the lamp's label, the dial's one phrase, the odometer's final value.

## Assumptions

- The catalogue is the existing `/cockpit` sample page from ST-50, extended with a section for these parts, rather than a new `/dev/ui` route: the Build brief marks the route *(proposed)*, the sample page is already the theme's catalogue, and a new route would edit the web app's routes while the shell and phone-layout stories work there. (autonomous default)
- Motion is out of scope by the orchestrator's instruction: the odometer does not roll, the needle does not swing and the lamp does not pulse in this story. Scenario 5 of User Story 3 holds because nothing rolls; ST-53 adds the motion with its reduced-motion rule on the hooks of FR-012. (autonomous default)
- Rounding half up is applied to the decimal value as written (4.85 → 4.9), not to its binary approximation. (autonomous default)
- The grey lamp uses the secondary text token and the amber lamp the amber ink token, which pass the contrast floors in both themes; no new colour token is added. (autonomous default)
- The small dial is always at least 44 px square, whether or not a screen makes it tappable. (autonomous default)
- The dial's accessible texts live in the shell i18n area, which every area loads, because the dial appears on every screen. (autonomous default)
- The Build brief's end-to-end screenshot comparison and axe scan are replaced by assertions on the rendered parts (computed colours, sizes, overflow, accessible names): ST-50 set the same precedent while the light theme awaits the owner's approval, and axe would add a dependency the repo does not have. Both are listed as follow-ups. (autonomous default)
- An odometer range whose ends are equal after rounding shows one value, as ST-19's range format already does. (autonomous default)

## Spec Delta

### Capability: `cockpit-gauges`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015
- **Modifies**: none
- **Removes**: none

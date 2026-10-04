# Feature Specification: The shared indicator lamp, rating dial and odometer digits

**Feature Branch**: `051-cockpit-gauges`

**Created**: 2026-10-04

**Status**: Draft

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
3. **Given** a rating of 4.85 or 4.75, **when** the dial renders, **then** it is rounded half up to one decimal: "4,9" and "4,8".
4. **Given** a small dial on a result card, **when** it renders, **then** it is at least 44 px square and its number is at least 12 px.
5. **Given** a dial, **when** a screen reader reaches it, **then** it hears one phrase in the current language, such as "Rating 4.8 out of 5", or "No reviews yet".

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

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The indicator lamp MUST show a small glowing dot in one of four states — green, red, amber, grey — with a text label beside it.
- **FR-002**: The lamp's label MUST be a required input, so a lamp without a label fails to compile.
- **FR-003**: The lamp's dot MUST be hidden from assistive technology; the label is the text read.
- **FR-004**: A lamp given an unknown state MUST show grey and, in a development build only, log a warning.
- **FR-005**: In both themes, every lamp dot MUST have at least 3:1 contrast with the page, panel and raised surfaces, and the label at least 4.5:1.
- **FR-006**: The rating dial MUST draw a 0–5 gauge whose amber arc fills value/5 of the track, with the rating in the centre written through the language's rating format (one decimal), rounded half up to one decimal and clamped to 0–5.
- **FR-007**: A dial with no rating (no value, or a value that is not a finite number) MUST show an empty arc and "—".
- **FR-008**: The dial MUST exist in a large and a small size; the small one is at least 44 px square with its number at least 12 px.
- **FR-009**: The dial MUST have one accessible name in the current language: "Rating {value} out of 5" with the formatted value, or "No reviews yet" (Romanian and English texts in the shared i18n files).
- **FR-010**: The odometer MUST take an amount in integer bani, or a from–to range, and show whole lei in the language's price format with an en dash for a range, in the Michroma label face; with no amount it shows "—".
- **FR-011**: The odometer MUST give assistive technology only the complete formatted value as one polite announcement, with the individual digits hidden from it.
- **FR-012**: The three parts MUST NOT animate in this story; the dial MUST expose its fill as a custom property and the odometer MUST render each digit as its own element carrying its digit, so the motion story can animate them without changing their markup.
- **FR-013**: The three parts MUST be styled only by the Cockpit `--mf-*` tokens, in dark and light, and MUST fit a 320 px wide screen.
- **FR-014**: The component catalogue (the `/cockpit` sample page) MUST show every state of the three parts, with its texts through i18n keys in Romanian and English.
- **FR-015**: The three parts MUST be exported from the `@motor-fix/ui-cockpit` library for later screens.

### Key Entities

- **Lamp state**: one of green (works on this brand, in order, on time), red (does not take this brand, or a problem), amber (needs attention), grey (neutral or off).
- **Rating**: a number from 0 to 5, or nothing when there are no reviews.
- **Price**: an amount in integer bani, VAT included, or a from–to range of two amounts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All four lamp states pass the contrast floors (3:1 dot, 4.5:1 label) against all three surfaces in both themes — 24 dot pairs and 6 label pairs.
- **SC-002**: The scenario values read exactly as the Build brief writes them in both languages: "4,8" / "4.8", "—", "1.250–1.600 lei", "1.400–1.800 lei".
- **SC-003**: At 320 px, 375 px and 1280 px wide, none of the parts overflows its container in either theme.
- **SC-004**: A screen reader is given one text per part: the lamp's label, the dial's one phrase, the odometer's final value.

## Assumptions

- The catalogue is the existing `/cockpit` sample page from ST-50, extended with a section for these parts, rather than a new `/dev/ui` route: the Build brief marks the route *(proposed)*, the sample page is already the theme's catalogue, and a new route would edit the web app's routes while the shell and phone-layout stories work there. (autonomous default)
- Motion is out of scope by the orchestrator's instruction: the odometer does not roll and the lamp does not pulse in this story. Scenario 5 of User Story 3 holds because nothing rolls; ST-53 adds rolling with its reduced-motion rule on the hooks of FR-012. The optional lamp pulse is left to ST-53 entirely, including any input that switches it on. (autonomous default)
- Rounding half up is applied to the decimal value as written (4.85 → 4.9), not to its binary approximation. (autonomous default)
- The grey lamp uses the secondary text token and the amber lamp the amber ink token, which pass the contrast floors in both themes; no new colour token is added. (autonomous default)
- The small dial is always at least 44 px square, whether or not a screen makes it tappable. (autonomous default)
- The dial's accessible texts live in the shell i18n area, which every area loads, because the dial appears on every screen. (autonomous default)
- The Build brief's end-to-end screenshot comparison and axe scan are replaced by assertions on the rendered parts (computed colours, sizes, overflow, accessible names): ST-50 set the same precedent while the light theme awaits the owner's approval, and axe would add a dependency the repo does not have. Both are listed as follow-ups. (autonomous default)
- An odometer range whose ends are equal after rounding shows one value, as ST-19's range format already does. (autonomous default)

## Spec Delta

### Adds

- **cockpit-gauges** (new capability): FR-001 to FR-015 above — the indicator lamp, the rating dial in two sizes, the odometer digits, their catalogue section and their export.

### Modifies

- None.

### Removes

- None.

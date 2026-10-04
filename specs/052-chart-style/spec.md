# Feature Specification: The shared chart style

**Feature Branch**: `052-chart-style`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-52 — Build the shared chart style in libs/ui-cockpit, on the merged Cockpit theme (ST-50, --mf-* tokens, dark and light) with axis and value labels through the ST-19 locale formats in libs/i18n. The charts that use it come in later epics (Driver insights, Garage workspace). Notion story: https://app.notion.com/p/3ee607bff0d28176aa7efb7b909ee35b. Spec folder and branch: 052-chart-style."

**Sources**: the Notion story [ST-52 Build the shared chart style](https://app.notion.com/p/3ee607bff0d28176aa7efb7b909ee35b) (acceptance criteria and Build brief "current as of 2026-10-03", with the 2026-10-04 supersession of PrimeNG Chart by Chart.js directly, decision A1; read 2026-10-04 with discussions: none), its feature page [MF-3 Cockpit design system and motion](https://app.notion.com/p/3ee607bff0d2817aa8bdc2f304d558b2), the epic [Foundations (EP-1)](https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), the merged ST-50 theme (`libs/ui-cockpit/src/styles/cockpit.css`) and ST-19 formats (`libs/i18n/src/formats.ts`), and `.specify/memory/constitution.md`. Where the Build brief and the acceptance criteria above it differ, the Build brief wins.

Every dashboard chart in MotorFix (a driver's spend over 12 months, a garage's requests, the admin's growth) will be drawn by the two components this story adds. The people who see them are drivers, garage staff and admins on phones and desktops, in Romanian or English, in dark or light mode; the people who use them directly are the developers of the later dashboard stories, who pass in values and a unit and get the Cockpit look with no styling of their own.

## Clarifications

### Session 2026-10-04 (autonomous, from the spec-challenger's findings)

- Q: One label per point, or a short axis label and a long tooltip label? → A: One label per point, written by the host; the axis thins it and the tooltip repeats it (Principle I: no second field without a caller).
- Q: What do values look like per unit? → A: Only the shared formatters write them: lei → `formatLei` ("1.250 lei" / "1,250 lei"), km → `formatKm` ("1.250 km"), count → `formatNum` ("1.250" / "1,250").
- Q: Which labels survive at 320 px? → A: The axis skips labels that would overlap, never rotates them, and keeps them at 12 px or more; no fixed label count is promised.
- Q: How do colours "come from the tokens" on a canvas? → A: The chart reads the `--mf-*` custom properties from the page when it draws and again when the device switches theme; no colour is written in the component's code.
- Q: Exact entry animation? → A: 1000 ms with a quartic ease-out; none with reduced motion. Also settled from the same review: state precedence is loading, then error, then empty, then the chart; the chart is one image (`role="img"`) whose accessible name is the summary, rendered on the server too; a point reacts to a hover or tap within 22 px of it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A dashboard shows a bar chart in the Cockpit look (Priority: P1)

A driver opens a dashboard panel titled, for example, "Cheltuieli pe 12 luni". The values appear as thin amber bars with rounded tops over one value axis whose labels read in their language ("1.250 lei"), with hairline grid lines, and no legend.

**Why this priority**: the bar chart is the most common dashboard chart in the mock, and the options shared with the line chart are built and proven here.

**Independent Test**: render the bar chart with 12 monthly values in lei and read its configuration and the drawn canvas: bar colour, thickness, top radius, a single visible value axis with formatted labels, grid colour and no legend.

**Acceptance Scenarios**:

1. **Given** 12 monthly values, **When** the bar chart renders, **Then** the bars are amber, 8 px thin, with rounded tops, and there is one value axis with hairline grid lines in the theme's hairline colour.
2. **Given** values in lei (as bani), **When** the value axis renders in Romanian, **Then** its labels read like "1.250 lei"; in English, "1,250 lei".

---

### User Story 2 - A dashboard shows a line chart in the Cockpit look (Priority: P1)

A garage owner looks at growth over 12 months: one amber line, 2 px, with a soft amber fill that fades downwards.

**Why this priority**: the second chart type the dashboards need; same options factory as the bar chart.

**Independent Test**: render the line chart and read its dataset styling: line colour and width, and a fill that runs from 25% amber at the top to transparent at the bottom.

**Acceptance Scenarios**:

1. **Given** a series of values, **When** the line chart renders, **Then** the line is amber, 2 px, with a soft amber fill fading downwards from 25% to 0% opacity.

---

### User Story 3 - The value of a bar or point shows on hover and on tap (Priority: P1)

On a desktop, the pointer over a bar or a point shows a tooltip with the label and the value, formatted for the language: "Martie 2027 · 1.250 lei". On a phone, tapping a bar or point shows the same tooltip, and tapping elsewhere hides it.

**Why this priority**: a chart without readable values is decoration; this is the story's fourth acceptance criterion.

**Independent Test**: render a chart in Romanian and in English and read the tooltip text for a point; in a mobile viewport, tap a bar and see the tooltip, tap outside and see it gone.

**Acceptance Scenarios**:

1. **Given** a desktop, **When** the pointer is over a bar or point, **Then** a tooltip shows "label · value", e.g. "Martie 2027 · 1.250 lei" in Romanian and "March 2027 · 1,250 lei" in English.
2. **Given** a phone, **When** the person taps a bar or point, **Then** the same tooltip shows; **When** they tap elsewhere, **Then** it hides.

---

### User Story 4 - Charts follow the device's dark or light mode and its motion setting (Priority: P2)

A person with a light-mode phone sees the chart in the light tokens (amber 8A5E00 for lines, bars and amber text), at least 3:1 against the panel; switching the device to dark redraws it in the dark tokens without a reload. A person who asked the device for reduced motion sees bars and lines appear at once, without growing.

**Why this priority**: follows from the theme (ST-50) and the device settings; without it charts are unreadable in light mode.

**Independent Test**: build the options for each theme and compare the colours to the tokens; compute the contrast of the chart amber against the panel in both themes; build the options with reduced motion and check animation is off.

**Acceptance Scenarios**:

1. **Given** light mode, **When** a chart renders, **Then** it uses the light tokens (amber 8A5E00 for lines and text) and the amber stays at least 3:1 against the background.
2. **Given** reduced motion, **When** a chart renders, **Then** bars and lines appear without growing.
3. **Given** a chart on screen, **When** its data change, **Then** it redraws in place without replaying the entry animation.

---

### User Story 5 - Charts say when there is nothing to show, are loading, or failed (Priority: P2)

A new driver with no history sees "Încă nu sunt date" in the panel instead of an empty axis. While data load, the panel shows a skeleton of the chart's height. If loading failed, the panel shows "Reîncearcă", and pressing it asks the dashboard to load again; the rest of the dashboard keeps working.

**Why this priority**: every dashboard reaches these states; the Build brief's States and errors section.

**Independent Test**: render the chart with no values, with loading set, and with an error set; check the text, the skeleton height and that the retry action is announced to the host.

**Acceptance Scenarios**:

1. **Given** no data, **When** the chart renders, **Then** it shows "Încă nu sunt date" ("No data yet") in the panel and no axis.
2. **Given** loading, **When** the chart renders, **Then** the panel shows a skeleton with the chart's height.
3. **Given** an error, **When** the person presses "Reîncearcă" ("Retry"), **Then** the host is told to load again.

---

### User Story 6 - A screen-reader user gets the chart as words and as a table (Priority: P2)

A screen reader reaching a chart reads one line: the title, the period, and the highest and lowest values. A "Vezi ca tabel" ("View as table") control shows the values as a table, and hides it again.

**Why this priority**: the chart is a picture; without this it carries no information for a blind person.

**Independent Test**: render a chart and read the accessible name of the chart image; press the table control and read the table rows.

**Acceptance Scenarios**:

1. **Given** a screen reader, **When** it reaches a chart, **Then** it reads the title, the period (first to last label), and the highest and lowest values with their labels, formatted for the language.
2. **Given** the chart, **When** the person presses "Vezi ca tabel", **Then** a table of label and value rows shows; pressing it again hides it.

---

### User Story 7 - Charts fit a 320 px phone (Priority: P2)

On a 320 px wide phone, a 12-month chart fits without sideways scroll; axis labels are at least 12 px and thin out when they would overlap.

**Why this priority**: most drivers are on phones (the mock's mobile boards).

**Independent Test**: open the catalogue page at 320 px and 1280 px in dark and light; the page does not scroll sideways, every chart's axis font is 12 px or more; compare screenshots.

**Acceptance Scenarios**:

1. **Given** a phone 320 px wide, **When** a 12-month chart renders, **Then** it fits without sideways scroll, axis labels are at least 12 px, and labels thin out as needed.

### Edge Cases

- A single value: one bar, or one point; the period is that one label; highest and lowest are the same value.
- All values zero or equal: the axis still shows a range starting at zero; highest and lowest are the same.
- Negative values (a count going down is not expected, but a host may pass one): drawn below zero, formatted with the minus sign by the shared formatter.
- A value that is not a finite number: shown as the formatter's missing-value dash in tooltip and table, and left out of highest/lowest.
- Labels and values of different lengths: only the pairs present are drawn; the component takes one list of label-value points, so this cannot arise.
- The language switches while a chart is on screen: axis, tooltip, summary and table re-format in the new language without a reload.
- Server-side rendering: the page renders on the server with the panel, title and summary, and the chart is drawn once in the browser.
- Loading or error set together with data, or with no data: loading wins over error, error over the empty text, and the empty text over the chart.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The bar chart MUST draw its values as amber bars 8 px thick with rounded tops and square bottoms, in the theme's amber for lines and text.
- **FR-002**: The line chart MUST draw its values as one amber line 2 px wide with a fill under it that fades from 25% amber at the top of the chart to 0% at the bottom, and no point markers until a point is hovered or tapped; a hover or tap within 22 px of a point picks it.
- **FR-003**: Both charts MUST show one value axis only, with hairline grid lines in the theme's hairline colour, no category grid lines, no axis border lines and no legend; the panel title says what is shown.
- **FR-004**: Both charts MUST take their values as numbers with one unit — lei (given in bani), km, or a count — and MUST format value-axis labels, tooltip values, the summary and the table through the shared locale formatters for the current language (in Romanian: lei "1.250 lei", km "1.250 km", count "1.250"), re-formatting when the language changes.
- **FR-005**: Hovering a bar or point on a pointer device MUST show a tooltip of one line, "label · value"; tapping a bar or point on a touch device MUST show the same tooltip, and tapping anywhere else MUST hide it.
- **FR-006**: Every chart colour (bars, line, fill, grid, axis text, tooltip surface and text) MUST come from the Cockpit tokens of the current theme, and a chart on screen MUST redraw in the other theme's tokens when the device switches between dark and light, without a reload.
- **FR-007**: The chart amber MUST have a contrast ratio of at least 3:1 against the panel and the page background in both the dark and the light theme.
- **FR-008**: Bars and lines MUST grow in on first draw over 1000 ms with a quartic ease-out, and MUST appear at once, without growing, when the device asks for reduced motion.
- **FR-009**: When its values change, a chart MUST redraw in place without replaying the entry animation.
- **FR-010**: With no values, a chart MUST show the text "Încă nu sunt date" / "No data yet" in its panel instead of the chart and its axis.
- **FR-011**: While its host says it is loading, a chart MUST show a skeleton block of the chart's height in its panel instead of the chart.
- **FR-012**: When its host says loading failed, a chart MUST show a "Reîncearcă" / "Retry" button in its panel instead of the chart, and pressing it MUST notify the host.
- **FR-013**: The drawn chart MUST be exposed to assistive technology as one image whose name is a one-line summary: the title, the period from the first to the last label, and the highest and lowest values with their labels, formatted for the language.
- **FR-014**: A chart MUST offer a "Vezi ca tabel" / "View as table" toggle that shows its values as a table of label and formatted value, and hides it again; the toggle states whether the table is shown.
- **FR-015**: On a 320 px wide viewport, a 12-month chart MUST fit its panel without sideways scroll, with axis labels at least 12 px that skip labels instead of overlapping or rotating.
- **FR-016**: Both charts MUST be configured by one shared options builder, so that a change of style applies to every chart in the product.
- **FR-017**: Every piece of interface text the charts show or announce MUST come from translation keys present in Romanian and English.
- **FR-018**: A chart MUST render on the server without error, with its panel, title and summary, and draw the chart only in the browser.
- **FR-019**: The Cockpit sample page MUST show a bar chart and a line chart of 12 monthly values, so the style can be approved in both themes and on phone and desktop widths.

### Key Entities

- **Chart point**: one label (text the host has already written for the language, e.g. a month name and year) and one numeric value.
- **Unit**: lei (values in bani), km, or count; decides how every value is written.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A later dashboard story adds a chart in the Cockpit look by passing a title, points and a unit — with zero lines of chart styling in the dashboard's own code.
- **SC-002**: In both themes the chart amber measures at least 3:1 against the panel and the background (computed from the token values).
- **SC-003**: The catalogue page at 320 px shows both charts with no horizontal scroll and no chart axis text under 12 px, in both themes.
- **SC-004**: Every one of the Build brief's nine acceptance scenarios is covered by at least one automated test (unit or end to end).

## Assumptions

- The charts are drawn with Chart.js used directly, as the Build brief's 2026-10-04 supersession names (decision A1); it is MIT-licensed and free, and is added as a new dependency because none of the installed packages draws charts.
- Labels are written by the host (for example from the shared month names), because a dashboard knows whether a label is a month, a week or a day; the chart formats values only. *(autonomous default — Build brief "Values come in as numbers with a unit")*
- The chart plot is 200 px tall on every width, and the skeleton uses the same height. *(autonomous default; the mock's plots are 190 and 210 px — see design.md)*
- "Tap elsewhere" means anywhere on the page outside a bar or point, including outside the chart. *(autonomous default)*
- The entry animation uses the closest built-in easing to `cubic-bezier(.32,.72,0,1)` (a quartic ease-out) over 1 s, inside the brief's 0.9–1.2 s. *(autonomous default)*
- The chart's interface texts (no data, retry, view as table, summary) live in the always-loaded shell translations, because a chart can appear in any area; the sample charts' titles and labels live in the cockpit area with the rest of the sample page. *(autonomous default)*
- The tooltip is the mock's inverted chip: the text colour as its surface and the page colour as its text, 12 px semibold. *(from the mock, design.md)*
- Charts are read-only: they read and write no data and have no audit history (Build brief › Data).

## Spec Delta

### Capability: `cockpit-charts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019
- **Modifies**: none
- **Removes**: none

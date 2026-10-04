# Feature Specification: Screens build up with motion, or stay still with reduced motion

**Feature Branch**: `053-motion`

**Created**: 2026-10-04

**Status**: Archived (2026-10-04)

**Input**: User description: "ST-53 — See screens build up with motion, or still with reduced motion: the shared motion for the Cockpit UI kit in libs/ui-cockpit, with prefers-reduced-motion giving a still version. Animate ST-51's gauges through the hooks it left (the lamp's `pulse` marker, `--mf-dial-fill`, the large dial's static needle, and odometer digit cells carrying `--mf-digit`), and add the dialog pop animation that ST-157 will use. Notion story: https://app.notion.com/p/3ee607bff0d281e6a52dd360e3cf1cda. Spec folder and branch: 053-motion."

**Sources**: Notion story ST-53 https://app.notion.com/p/3ee607bff0d281e6a52dd360e3cf1cda (read 2026-10-04, page edited 2026-10-03; no discussions) · epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (Build plan, slice 3) · feature MF-3 https://app.notion.com/p/3ee607bff0d2817aa8bdc2f304d558b2 · mock v22 https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (`design.md`). Depends on ST-50 (theme) and ST-51 (lamp, dial, odometer), both merged. The story's Build brief wins over the story body and the mock.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A screen builds up calmly (Priority: P1)

A visitor opens a screen made of Cockpit panels: the panels rise a little and fade in, one after another, and the screen is complete in well under two seconds. Controls already on screen work during the build-up.

**Why this priority**: it is the motion every screen shares, and the first thing the story's acceptance criteria name.

**Independent Test**: open `/cockpit` with full motion; each panel runs one rise-and-fade of 700 ms from 14 px below, later panels start 60 ms after the one before, every build-up animation has finished within 1.5 s, and a button can be pressed while it runs.

**Acceptance Scenarios**:

1. **Given** a screen with panels opens, **When** its panels appear, **Then** each rises 14 px and fades in over 700 ms with `cubic-bezier(.32,.72,0,1)`, and panels start 60 ms apart.
2. **Given** a screen is building up, **When** the person taps a control that is already visible, **Then** the tap works.
3. **Given** a value changes on an open screen, **When** it arrives, **Then** the build-up does not replay.

---

### User Story 2 - Gauges move when their values move (Priority: P1)

A rating dial swings its needle and arc to a new value, odometer digits roll to a new price, and a lamp marked as pulsing breathes slowly.

**Why this priority**: the gauges are the Cockpit look; ST-51 left them still on purpose for this story.

**Independent Test**: on `/cockpit`, change the values: the large dial's arc and needle run a 1.1 s transition to the new value, each changed odometer digit rolls its 0–9 column, and the pulsing lamp's dot runs an infinite opacity animation between 1 and 0.45 with a period between 1.2 and 1.8 s.

**Acceptance Scenarios**:

1. **Given** a rating dial shows 4.2, **When** its value changes to 4.8, **Then** the arc and the needle swing to 4.8 over 1.1 seconds.
2. **Given** a lamp marked as pulsing, **When** it shows, **Then** its dot's opacity goes 1 → 0.45 → 1 every 1.6 seconds; a lamp not marked stays still.
3. **Given** an odometer shows 1.250–1.600 lei, **When** the price changes to 1.400–1.800 lei, **Then** each digit cell rolls to its new digit, and the text read out is only the new value.
4. **Given** a live badge, **When** it shows, **Then** it blinks once a second.

---

### User Story 3 - Dialogs and sheets pop in (Priority: P2)

A dialog or sheet opens with a short pop from slightly smaller and transparent.

**Why this priority**: ST-157 (the shared dialog that sign-in needs) builds on it.

**Independent Test**: open the sample dialog and drawer on `/cockpit`; the content runs one 420 ms animation from 94% scale and opacity 0.

**Acceptance Scenarios**:

1. **Given** a dialog or sheet opens, **When** it appears, **Then** it pops in from 94% scale and transparent over 420 ms.
2. **Given** a dialog is open, **When** it is closed, **Then** it closes at once, as before.

---

### User Story 4 - Reduced motion means still (Priority: P1)

A person whose device asks for reduced motion gets exactly the same screens with nothing moving.

**Why this priority**: an accessibility requirement and an acceptance criterion of both the story and the feature.

**Independent Test**: with `reducedMotion: 'reduce'`, open `/`, `/cockpit` and a dashboard, change the gauge values, open the dialog: no element has a running animation or transition at any point, and the screens show their final state.

**Acceptance Scenarios**:

1. **Given** the device asks for reduced motion, **When** any screen opens or changes, **Then** nothing animates: no rise, swing, pulse, blink, pop or odometer roll. The screens are otherwise the same.
2. **Given** reduced motion is switched on while a screen is building up, **When** the setting changes, **Then** every running animation jumps to its end state at once.
3. **Given** code that drives its own motion, **When** it asks whether motion is reduced, **Then** one shared signal answers, read at start from the device and following it live.

### Edge Cases

- A page rendered on the server is still on its first paint for a reduced-motion device: the still version needs no script.
- A dial or odometer created with a value does not animate into it; only a change of value moves.
- More panels than the stagger can carry within 1.5 s: the delay stops growing after the twelfth panel.
- Forced-colours mode: the odometer shows its plain digits instead of the rolling column.
- A dialog closed while its pop is still running closes at once (the pop is an opening animation only).

## Clarifications

### Session 2026-10-04

- Q: Which values when the mock and the Build brief differ (mock rise 900 ms from 18 px with a blur, lamp 2.4 s / 0.55, pop 460 ms from 60%, needle with an overshoot curve)? → A: The Build brief's: 700 ms, 14 px, no blur; 1 → 0.45 → 1 at 1.6 s (inside 1.2–1.8 s, and the mock's `mf-lamp` period); 420 ms from 94%; one curve `cubic-bezier(.32,.72,0,1)` for rise, dial, roll and pop. (autonomous; the Build brief wins, it is newer)
- Q: Where does the reduced-motion switch live — the CSS media query or the shared signal? → A: Both read the same device setting. CSS motion is switched off by one `prefers-reduced-motion: reduce` rule in `cockpit.css` that stops every animation and transition, so a server-rendered first paint is already still; the shared signal is for code that drives motion itself (later charts, Home's brand swap). (autonomous; Build brief "one switch", edge case "no script on first paint")
- Q: How long is the odometer roll? → A: 900 ms, the mock's `.mf-odo` transition, as a token *(proposed)*; the Build brief names no value. (autonomous default)
- Q: What is the live badge in this story? → A: A shared `.mf-blink` class that blinks an element once a second; the badge itself is built with Live from the workshop. The catalogue shows it on the dot of a sample label; the text stays still (QA lap 1: blinking text failed axe colour contrast). (autonomous; Build brief scope and Out of scope)
- Q: Does the large dial's needle for "no rating" change? → A: No. It stays at the low end; the owner decides (deferred decision from ST-51). (orchestrator)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Cockpit theme MUST hold the motion values as shared tokens: the curve `cubic-bezier(.32,.72,0,1)`, rise 700 ms, stagger 60 ms, dial 1100 ms, pop 420 ms, odometer roll 900 ms, pulse 1.6 s and blink 1 s. Every animation and transition this story adds MUST take its duration from them, and the one-shot ones (rise, dial, roll, pop) the shared curve; the repeating pulse eases in and out and the blink steps. Motion already in the kit (the switch's 0.15 s slide) is unchanged.
- **FR-002**: A panel MUST build up once when it appears: it rises 14 px and fades in over the rise duration with the shared curve; each later panel among the same container's panels (other children do not count) starts one stagger after the one before, up to the twelfth (11 steps, 660 ms), so a screen finishes building within 1.5 s; panels in different containers start together. Changing a panel's content MUST NOT replay it.
- **FR-003**: When a rating dial's value changes, its arc and its needle MUST move to the new value together over the dial duration with the shared curve; a dial that appears with a value shows it without moving.
- **FR-004**: A lamp marked as pulsing MUST pulse its dot's opacity 1 → 0.45 → 1 once per pulse period, forever; its label MUST NOT fade, and an unmarked lamp MUST NOT move.
- **FR-005**: The kit MUST offer one blink, for the live badge, that cuts a decorative element (the badge's dot) to 0.35 opacity and back once per blink period, never text, so text keeps its contrast; no motion this story adds repeats faster than once a second (the brief's limit is 3 flashes a second).
- **FR-006**: Each odometer digit cell MUST show a 0–9 column that rolls to the cell's digit over the roll duration when the digit changes; the digit itself stays the cell's text, hidden from assistive technology as before, and forced-colours mode shows the plain digit.
- **FR-007**: A dialog's or sheet's content MUST pop in once when it opens, from 94% scale and opacity 0, over the pop duration with the shared curve, a dialog from its centre and a sheet from the edge it is anchored to; closing is not animated.
- **FR-008**: When the device asks for reduced motion, no element or pseudo-element in the app MUST animate or transition, with no script needed; switching the setting on while something moves MUST put it in its end state at once.
- **FR-009**: The kit MUST provide one shared signal, true when the device asks for reduced motion, read once at start and following the setting live; false where there is no device (server rendering).
- **FR-010**: Motion MUST NOT block input: no animation hides a control from pointer or keyboard, or delays its response.
- **FR-011**: The component catalogue (`/cockpit`) MUST show the motion: a button that changes the dial ratings (4.8 ↔ 4.2) and the odometer range together, the pulsing lamp, a sample live label whose dot blinks, and a line saying whether motion is full or reduced, read from the shared signal, with its texts through i18n keys in Romanian and English.
- **FR-012**: The lamp, the rating dial and the odometer MUST move only as FR-003, FR-004 and FR-006 describe, through the hooks ST-51 left (the pulse marker, the dial's fill and needle, the per-digit cells); they are still with reduced motion. This replaces ST-51's rule that the three parts do not animate.
- **FR-013**: The shared reduced-motion signal MUST be exported from `@motor-fix/ui-cockpit` (the `REDUCED_MOTION` injection token) for later screens.

### Key Entities

- **Motion**: `full` or `reduced`, from the device; not stored.

## Spec Delta

### Capability: `cockpit-motion`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-013
- **Modifies**: none
- **Removes**: none

### Capability: `cockpit-gauges`

- **Adds**: none
- **Modifies**: `051-FR-012` → `FR-012`
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With reduced motion, `/`, `/cockpit` and a dashboard have zero running animations or transitions, before and after the gauge values change and the dialog opens.
- **SC-002**: With full motion, every build-up animation on `/cockpit` has finished within 1.5 s of the first one starting (the longest delay plus the rise duration).
- **SC-003**: The token values equal the Build brief's numbers exactly (700, 60, 1100, 420 ms and the curve), checked by a unit test.
- **SC-004**: No repeating animation this story adds has a period shorter than one second.

## Assumptions

- The odometer roll lasts 900 ms, the mock's value; the Build brief gives none. (autonomous default)
- The pulse period is 1.6 s, inside the brief's 1.2–1.8 s and equal to the mock's `mf-lamp`. (autonomous default)
- The blink cuts to 0.35 rather than to nothing, once a second *(proposed)*; the badge itself and its texts come with Live from the workshop. (autonomous default)
- The stagger counts panels among their container's panels with `:nth-child(n of mf-panel)` (pure CSS, so it holds on the server-rendered first paint); a document-wide order would need a script and a counter. (autonomous default; spec-challenger 2)
- A dial or odometer that first shows nothing ("—") and then receives a value moves to it: that is a value change. A digit cell that replaces a separator is a new cell and shows its digit without rolling; 9 → 0 rolls back through the column. (autonomous default; spec-challenger 4, 6)
- The shared signal and the blink have one consumer each in this story, the catalogue; the Build brief asks for both (Complexity Tracking in plan.md). (autonomous default; spec-challenger 5)
- The catalogue's change button keeps its i18n key and now reads "Schimbă valorile" / "Change the values", since it changes the ratings too. (autonomous default)
- Chromium transitions the dial's SVG presentation attributes (`stroke-dasharray`, `transform`) directly, so the arc and needle keep ST-51's attributes and only gain a transition (checked with Playwright 1.63 Chromium on 2026-10-04). (autonomous default)
- Highlights for live updates (ST-256) and chart growth (ST-52) are not built here; both are still under the reduced-motion rule of FR-008 because it applies to every element. (autonomous default)

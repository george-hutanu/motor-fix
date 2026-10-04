---
capability: cockpit-motion
updated: 2026-10-04
features:
  - 053-motion
---

# Capability: cockpit-motion

The shared motion of the Cockpit kit in `libs/ui-cockpit`: screens that build up, the dial's swing, the lamps' pulse, the odometer's roll, the pop of dialogs and sheets, the live badge's blink, and the still version when the device asks for reduced motion.

## Requirements

### 053-FR-001 — The Cockpit theme MUST hold the motion values as shared tokens: the curve `cubic-bezier(.32,.72,0,1)`, rise 700 ms, stagger 60 ms, dial 1100 ms, pop 420 ms, odometer roll 900 ms, pulse 1.6 s and blink 1 s. Every animation and transition this story adds MUST take its duration from them, and the one-shot ones (rise, dial, roll, pop) the shared curve; the repeating pulse eases in and out and the blink steps. Motion already in the kit (the switch's 0.15 s slide) is unchanged.

_From 053-motion._

### 053-FR-002 — A panel MUST build up once when it appears: it rises 14 px and fades in over the rise duration with the shared curve; each later panel among the same container's panels (other children do not count) starts one stagger after the one before, up to the twelfth (11 steps, 660 ms), so a screen finishes building within 1.5 s; panels in different containers start together. Changing a panel's content MUST NOT replay it.

_From 053-motion._

### 053-FR-003 — When a rating dial's value changes, its arc and its needle MUST move to the new value together over the dial duration with the shared curve; a dial that appears with a value shows it without moving.

_From 053-motion._

### 053-FR-004 — A lamp marked as pulsing MUST pulse its dot's opacity 1 → 0.45 → 1 once per pulse period, forever; its label MUST NOT fade, and an unmarked lamp MUST NOT move.

_From 053-motion._

### 053-FR-005 — The kit MUST offer one blink, for the live badge, that cuts a decorative element (the badge's dot) to 0.35 opacity and back once per blink period, never text, so text keeps its contrast; no motion this story adds repeats faster than once a second (the brief's limit is 3 flashes a second).

_From 053-motion._

### 053-FR-006 — Each odometer digit cell MUST show a 0–9 column that rolls to the cell's digit over the roll duration when the digit changes; the digit itself stays the cell's text, hidden from assistive technology as before, and forced-colours mode shows the plain digit.

_From 053-motion._

### 053-FR-007 — A dialog's or sheet's content MUST pop in once when it opens, from 94% scale and opacity 0, over the pop duration with the shared curve, a dialog from its centre and a sheet from the edge it is anchored to; closing is not animated.

_From 053-motion._

### 053-FR-008 — When the device asks for reduced motion, no element or pseudo-element in the app MUST animate or transition, with no script needed; switching the setting on while something moves MUST put it in its end state at once.

_From 053-motion._

### 053-FR-009 — The kit MUST provide one shared signal, true when the device asks for reduced motion, read once at start and following the setting live; false where there is no device (server rendering).

_From 053-motion._

### 053-FR-010 — Motion MUST NOT block input: no animation hides a control from pointer or keyboard, or delays its response.

_From 053-motion._

### 053-FR-011 — The component catalogue (`/cockpit`) MUST show the motion: a button that changes the dial ratings (4.8 ↔ 4.2) and the odometer range together, the pulsing lamp, a sample live label whose dot blinks, and a line saying whether motion is full or reduced, read from the shared signal, with its texts through i18n keys in Romanian and English.

_From 053-motion._

### 053-FR-013 — The shared reduced-motion signal MUST be exported from `@motor-fix/ui-cockpit` (the `REDUCED_MOTION` injection token) for later screens.

_From 053-motion._

## Retired

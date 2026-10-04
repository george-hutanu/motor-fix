# Feature Specification: The charts follow reduced motion live

**Feature Branch**: `470-chart-reduced-motion`
**Created**: 2026-10-04
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-470 — https://app.notion.com/p/3ef607bff0d281beb7fef25a5d0d7cb7
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**From**: code-reviewer deferral in ST-53 (`specs/053-motion/deferred.md`), PR #31

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switching reduced motion on stills an open chart at once (Priority: P1)

A driver who gets dizzy from motion turns on "reduce motion" on the device
while a dashboard is open. Chart.js animates in script, so the stylesheet's
reduced-motion rule does not reach it: today a chart that is growing keeps
growing, and its options keep the animation until something redraws it. The
charts read the shared `REDUCED_MOTION` signal instead, and react the moment it
changes.

**Independent Test**: render a chart, flip the reduced-motion signal while it
exists, and read the chart's animation options and whether it is still
animating.

**Acceptance Scenarios**:

1. **Given** an open chart that is still growing in, **When** reduced motion turns on, **Then** the growth stops and the chart shows its final drawing at once, and its options carry no animation.
2. **Given** a chart drawn with reduced motion on, **When** its points change or it redraws, **Then** nothing animates.
3. **Given** a chart drawn with reduced motion on, **When** reduced motion turns off, **Then** its options carry the animation again, and a chart drawn after that (the retry of a failed chart) grows in.
4. **Given** the `/cockpit` page loaded with reduced motion, **When** reduced motion is switched off, a failed chart is retried, and reduced motion is switched back on while it grows, **Then** the chart stops growing at once.

### Edge Cases

- A chart with no canvas yet (loading, empty, error): the signal change draws nothing; the next chart drawn takes the current value.
- The server render: the signal's factory has no `matchMedia` on the server and reads `false`; no chart is drawn there, so nothing changes.
- The colour-scheme redraw and the tap-outside tooltip reset keep working as before.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The bar and line charts MUST take reduced motion from the shared `REDUCED_MOTION` signal of `libs/ui-cockpit`, and MUST NOT query `prefers-reduced-motion` themselves.
- **FR-002**: When the signal turns on while a chart exists, the chart MUST stop any running animation, show its final drawing, and carry no animation in its options, so later updates do not animate.
- **FR-003**: When the signal turns off while a chart exists, the chart MUST carry its animation options again, and a chart drawn after that MUST animate.
- **FR-004**: The existing chart unit and end-to-end tests MUST stay green, and the "grows the bars in" end-to-end test MUST NOT gain any further injected style.

## Spec Delta

### Capability: `cockpit-charts`

- **Adds**: FR-001, FR-002, FR-003, FR-004
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: On `/cockpit`, switching reduced motion on while a chart grows leaves its pixels unchanged from the next frame on.
- **SC-002**: No `prefers-reduced-motion` query remains in `libs/ui-cockpit/src/lib/chart.ts`.

## Clarifications

### Session 2026-10-04

- Q: Must a running animation jump to its end, or freeze where it is? → A: jump to the end: the final drawing is what a still chart shows, and ST-53's design says reduced motion switched on mid-animation "jumps to the end" (`specs/053-motion/design.md`, States). (autonomous default)
- Q: Should switching reduced motion off replay the growth of charts already drawn? → A: no; it restores the animation options only. Replaying would move a settled screen for no new data. A chart drawn afterwards grows in. (autonomous default)
- Q: Unit test through the `/cockpit` page or the chart component? → A: the chart component, with `REDUCED_MOTION` provided as a writable signal; rendering the full page in jsdom is slow (owner instruction for this task). (autonomous default)

## Assumptions

- `Chart.stop()` followed by `update('none')` ends Chart.js's running animations and writes every element's final properties (Chart.js 4, `core.controller` / `core.animator`). (autonomous default)
- The e2e reads the canvas pixels (`toDataURL`) rather than an element screenshot, so the panels' CSS rise needs no injected style. (autonomous default)
- 052-FR-008 (no growth at first draw under reduced motion) still holds unchanged.

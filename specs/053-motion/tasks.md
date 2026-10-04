# Tasks: Screens build up with motion, or stay still with reduced motion

**Input**: plan.md, spec.md, design.md, context.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/ui-cockpit/src/styles/cockpit.css`, `libs/ui-cockpit/src/lib/{panel,lamp,rating-dial,odometer,gauges-sample}.ts`, `libs/ui-cockpit/src/lib/{odometer,gauges-sample}.spec.ts`, `libs/ui-cockpit/src/index.ts`, `libs/i18n/src/cockpit/{ro,en}.json`.

## Phase 1: US4 The still version and the tokens (P1)

**Independent test**: the reduced-motion rule removes every animation and transition from every element and pseudo-element; the tokens hold the Build brief's numbers; every animation and transition in the kit uses them; the signal follows the device live.

- [X] T001 [US4] Test: `libs/ui-cockpit/src/styles/motion.spec.ts` (new) — reads `cockpit.css` and the part sources: the `--mf-motion-*` tokens equal 700ms, 60ms, 1100ms, 420ms, 900ms, 1.6s, 1s and `cubic-bezier(0.32, 0.72, 0, 1)`; keyframes `mf-rise` (opacity 0, translateY(14px)), `mf-pop` (opacity 0, scale(0.94)), `mf-pulse` (0.45), `mf-blink` (0.35) exist; dialog and sheet content pop, sheets from their anchored edge; one `prefers-reduced-motion: reduce` block sets `animation: none !important` and `transition: none !important` on `*, *::before, *::after`; every `animation`/`transition` declaration in `cockpit.css` and in `panel.ts`, `lamp.ts`, `rating-dial.ts`, `odometer.ts` takes its duration from a `--mf-motion-*` token and none has a period under 1 s for an infinite animation (FR-001, FR-005, FR-008, SC-003, SC-004)
- [X] T002 [US4] Test: `libs/ui-cockpit/src/lib/reduced-motion.spec.ts` (new) — `injectReducedMotion()` is true when the device query matches and false when not, follows a `change` event live, is one shared instance per injector, stops listening when the root injector is destroyed, and is false with no window (FR-009, FR-013)
- [X] T003 [US4] `libs/ui-cockpit/src/styles/cockpit.css` — appended motion block: tokens, keyframes, `.mf-blink`, dialog and sheet pop, the reduced-motion rule (FR-001, FR-005, FR-007, FR-008)
- [X] T004 [US4] `libs/ui-cockpit/src/lib/reduced-motion.ts` (new) + export in `libs/ui-cockpit/src/index.ts` (FR-009, FR-013)

## Phase 2: US1 The build-up (P1)

**Independent test**: a panel's section carries the rise animation with a per-sibling delay capped at the twelfth.

- [X] T005 [US1] Test: in T001's `motion.spec.ts` — `panel.ts` animates `.mf-panel` with `mf-rise`, `backwards`, the rise token and a delay of `--mf-panel-step` × the stagger token, with steps 1…11 for siblings 2…12 and none beyond (FR-002, FR-010)
- [X] T006 [US1] `libs/ui-cockpit/src/lib/panel.ts` — build-up styles (FR-002, FR-010)

## Phase 3: US2 Gauges in motion (P1)

**Independent test**: the dial's arc and needle transition on the dial token; a pulsing lamp's dot pulses, its label does not; each odometer cell shows a rolling column moved by its digit; the catalogue swaps ratings and estimate together and shows a blinking label.

- [X] T007 [US2] Test: `libs/ui-cockpit/src/lib/odometer.spec.ts` — the ST-51 "none of the three parts animates" test replaced: the dial transitions `stroke-dasharray` on the arc and `transform` on the needle with the dial token; the lamp animates `.mf-lamp-dot` with `mf-pulse` only under `[data-pulse]`; the odometer cell's `::before` holds the ten digits and `translate`s by `--mf-digit` × 1.4em with the roll token, and forced colours drop it (FR-003, FR-004, FR-006, FR-012)
- [X] T008 [US2] Test: `libs/ui-cockpit/src/lib/gauges-sample.spec.ts` — the change button swaps the first large and first small dial between "4,8" and "4,2" together with the estimate; a `.mf-blink` label reads `cockpit.gauges.live` in both languages; a line reads `motionFull` and turns to `motionReduced` when the device query changes (FR-011, FR-009)
- [X] T009 [US2] `libs/ui-cockpit/src/lib/rating-dial.ts`, `lamp.ts`, `odometer.ts` — motion styles (FR-003, FR-004, FR-006, FR-012)
- [X] T010 [US2] `libs/ui-cockpit/src/lib/gauges-sample.ts` + `libs/i18n/src/cockpit/ro.json`, `en.json` (`gauges.swap` reworded, `gauges.live`, `gauges.motionFull`, `gauges.motionReduced`) (FR-011)

## Phase 4: End to end (US1–US4)

- [X] T011 Test: `apps/web-e2e/src/motion.spec.ts` (new) — with `reducedMotion: 'reduce'`: `/`, `/cockpit` and the driver dashboard have no running animation or transition (`document.getAnimations()` empty) on load, after the change button and with the dialog open, and the dialog and dial show their end state; with full motion on `/cockpit`: each panel runs `mf-rise`, all have finished within 1.5 s, the later panel starts 60 ms after the earlier; a button is pressable during the build-up; the change button starts a 1100 ms transition on the large dial's arc and needle and a roll on the odometer digits, and does not replay the build-up; the pulsing lamp's dot runs `mf-pulse` infinitely; the dialog content runs `mf-pop` 420 ms; switching to reduced motion while panels build cancels every animation at once (FR-002–FR-008, FR-010, SC-001, SC-002)

## Phase 5: Hardening

- [X] T012 [US4] `libs/ui-cockpit/src/motion.adversary.spec.ts` (test-adversary) + `lib/reduced-motion.ts` — a device whose media query has only `addListener`/`removeListener` still gets the signal, followed live and released on destroy (FR-009)

## Dependencies

T001, T002, T005, T007, T008, T011 before T003, T004, T006, T009, T010. Phase 1 before the rest (tokens and keyframes).

## FR → test

| FR | Test |
| --- | --- |
| FR-001 | T001 |
| FR-002 | T005, T011 |
| FR-003 | T007, T011 |
| FR-004 | T007, T011 |
| FR-005 | T001 |
| FR-006 | T007, T011 |
| FR-007 | T001, T011 |
| FR-008 | T001, T011 |
| FR-009 | T002 |
| FR-010 | T005, T011 |
| FR-011 | T008 |
| FR-012 | T007 |
| FR-013 | T002 |

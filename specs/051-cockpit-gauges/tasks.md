# Tasks: The shared indicator lamp, rating dial and odometer digits

**Input**: plan.md, spec.md, design.md, context.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/ui-cockpit/src/index.ts`, `libs/ui-cockpit/src/lib/sample-page.ts`, `libs/i18n/src/shell/{ro,en}.json`, `libs/i18n/src/cockpit/{ro,en}.json`.

## Phase 1: US1 The indicator lamp (P1)

**Independent test**: each of the four states renders a dot hidden from assistive technology and the label beside it; an unknown state shows grey with one development warning; the colours meet the floors in both themes.

- [X] T001 [US1] Test: `libs/ui-cockpit/src/lib/lamp.spec.ts` — host renders `<mf-lamp state="green" label="Lucrează pe Dacia">`: host `data-state="green"`, a `.mf-lamp-dot` with `aria-hidden="true"`, the label text beside it and nothing else read; the four states map to `data-state`; a state string outside them shows `grey` and calls `console.warn` once (dev mode); `pulse` sets `data-pulse` and its absence leaves none; a lamp rendered without a label throws Angular's required-input error (strict templates turn the same mistake into a compile error); contrast of each state's token against `--mf-bg`, `--mf-panel`, `--mf-panel-raised` ≥ 3:1 and `--mf-text` ≥ 4.5:1 in dark and light, read from `cockpit.css` (FR-001, FR-002, FR-003, FR-004, FR-005, FR-012, SC-001)
- [X] T002 [US1] `libs/ui-cockpit/src/lib/lamp.ts` — `Lamp` with `state` (transform to the four states, `isDevMode()` warning), `label` (required), `pulse` (`booleanAttribute`) and token-painted dot and glow; forced-colours outline (FR-001–FR-005, FR-012, FR-013)

## Phase 2: US2 The rating dial (P1)

**Independent test**: 4.8 reads "4,8" / "4.8" with the arc at 4.8/5; no rating, 0 and NaN read "—" with an empty arc; 4.85 → "4,9", 4.75 → "4,8"; small dial 60 px with a 13 px number; one accessible phrase per language.

- [X] T003 [US2] Test: `libs/ui-cockpit/src/lib/rating-dial.spec.ts` — centre text and `--mf-dial-fill` for 4.8 (RO "4,8", EN "4.8" after `I18n.use('en')`), 4.85 → "4,9", 4.75 → "4,8", 7 → "5,0" and fill 1, -1 / 0 / 0.04 / `null` / `undefined` / `NaN` / "4.8" (string) → "—" and fill 0; the value arc's `stroke-dasharray` is `fill × 240` of 360; host `role="img"` with `aria-label` "Rating 4,8 din 5" / "Rating 4.8 out of 5" and "Nicio recenzie încă" / "No reviews yet"; `size="small"` sets `data-size="small"`, has no needle, the large one has a needle rotated by the value (FR-006, FR-007, FR-008, FR-009, FR-012, SC-002)
- [X] T004 [US2] `libs/ui-cockpit/src/lib/rating-dial.ts` + `libs/i18n/src/shell/{ro,en}.json` `gauge.rating`, `gauge.none` — `RatingDial` with rounding, clamping, `formatRating`, SVG track, arc, ticks and needle, sizes (FR-006–FR-009, FR-012, FR-013)

## Phase 3: US3 The odometer digits (P2)

**Independent test**: 125000–160000 reads "1.250–1.600 lei" (RO) / "1,250–1,600 lei" (EN); a change to 140000–180000 updates the one live text; 140050 → "1.401 lei"; nothing → "—".

- [X] T005 [US3] Test: `libs/ui-cockpit/src/lib/odometer.spec.ts` — range and single values in both languages, rounding to whole lei per amount, equal ends after rounding → one value, a missing `to` (null) → "—", no `from` → "—"; each digit is a `.mf-odometer-digit` carrying `--mf-digit`, separators are not; the visible characters are `aria-hidden`; exactly one live region (`aria-live="polite"`, `aria-atomic="true"`) whose text equals the formatted value, and after an update equals only the new value; nothing in the part carries a transition or animation style (FR-010, FR-011, FR-012, SC-002, SC-004)
- [X] T006 [US3] `libs/ui-cockpit/src/lib/odometer.ts` — `Odometer` with `from`, `to`, rounding, `formatLei` / `formatLeiRange`, digit cells, live region (FR-010–FR-013)

## Phase 4: US4 The catalogue and the exports (P3)

**Independent test**: `/cockpit` shows every state; the parts fit 320 px; the library exports them.

- [X] T007 [US4] Test: `libs/ui-cockpit/src/lib/gauges-sample.spec.ts` — the section shows four lamps (labels from `cockpit.gauges.*`), two large and two small dials (4.8 and none), three odometers (single, range, none), and the swap button changes the range text from "1.250–1.600 lei" to "1.400–1.800 lei"; `libs/ui-cockpit/src/index.ts` exports `Lamp`, `RatingDial`, `Odometer`; the sample page holds the section (FR-014, FR-015)
- [X] T008 [US4] `libs/ui-cockpit/src/lib/gauges-sample.ts`, one element in `sample-page.ts`, `cockpit.gauges.*` in `libs/i18n/src/cockpit/{ro,en}.json`, exports in `index.ts` (FR-014, FR-015)
- [X] T009 [US4] Test: `apps/web-e2e/src/gauges.spec.ts` — `/cockpit` in dark and light at 375 and 1280 px: lamp dots painted by the state token, the dial's accessible name, the odometer swap updates its live text once, the small dial ≥ 44 px with a ≥ 12 px number, and at 320 px no part is wider than its container and the page has no horizontal scroll (FR-005, FR-008, FR-011, FR-013, FR-014, SC-003)

## Phase 5: Polish

- [X] T010 `npx nx run ui-cockpit:typecheck`, `npx nx run i18n:typecheck`, `npx biome check libs/ui-cockpit libs/i18n apps/web-e2e`, `npx jest -c libs/ui-cockpit/jest.config.cts --maxWorkers=2` green; e2e on port 4251

## FR → test

| FR | Test |
| --- | --- |
| FR-001, FR-002, FR-003, FR-004, FR-005 | lamp.spec.ts; gauges.spec.ts (dot colours) |
| FR-006, FR-007, FR-008, FR-009 | rating-dial.spec.ts; gauges.spec.ts (size, name) |
| FR-010, FR-011 | odometer.spec.ts; gauges.spec.ts (swap) |
| FR-012 | lamp.spec.ts (pulse), rating-dial.spec.ts (fill, needle), odometer.spec.ts (digits, no transition) |
| FR-013 | gauges.spec.ts (320 px, themes); colour-literals.spec.ts covers the rest of the front end |
| FR-014, FR-015 | gauges-sample.spec.ts; gauges.spec.ts |

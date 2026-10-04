# Tasks: The shared chart style

**Input**: plan.md, spec.md, design.md, context.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/ui-cockpit/src/index.ts`, `libs/ui-cockpit/src/lib/sample-page.ts`, `libs/i18n/src/shell/{ro,en}.json`, `libs/i18n/src/cockpit/{ro,en}.json`, `package.json`.

## Phase 1: Setup

- [X] T001 Add `chart.js` 4.5.1 (exact) to `package.json` and the lockfile (plan Technical Context)

## Phase 2: US1 + US2 + US4 The shared configuration (P1)

**Independent test**: the builder's bar and line configurations carry the brief's geometry, the theme's colours for dark and light, the formatted ticks and tooltip in both languages, and no animation with reduced motion; the amber passes 3:1 in both themes.

- [X] T002 [US1] Test: `libs/ui-cockpit/src/lib/chart-config.spec.ts` — bar dataset: amber from the theme, `barThickness` 8, `borderRadius` 4, `borderSkipped` `start`; line dataset: amber 2 px, round joins, `tension` 0, fill to origin, gradient stops 25% and 0% of the theme amber, `pointRadius` 0, `pointHitRadius` 22; one visible value axis (`y` grid in the line colour, `x` grid off, no borders), no legend plugin option, tick font 12 px, `maxRotation` 0 with `autoSkip`; tooltip surface `text` and text `bg`, one line "Martie 2027 · 1.250 lei" (ro) / "March 2027 · 1,250 lei" (en), title empty; y ticks through `formatLei` / `formatKm` / `formatNum`; animation 1000 ms `easeOutQuart`, `false` with reduced motion; the dark and light themes parsed from `cockpit.css` give their own colours; `--mf-amber-ink` ≥ 3:1 against `--mf-panel` and `--mf-bg` in both themes; `readTheme` reads the custom properties of an element (FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-015, FR-016, SC-002)
- [X] T003 [US1] `libs/ui-cockpit/src/lib/chart-config.ts` — `chartConfig`, `formatValue`, `readTheme`, `ChartTheme`, the Chart.js registration (FR-001–FR-008, FR-015, FR-016)

## Phase 3: US3 + US5 + US6 The components (P1/P2)

**Independent test**: a host renders each chart in its states; the canvas carries the summary; the table toggles; data changes redraw with `update('none')`; a tap outside hides the tooltip; nothing breaks on the server.

- [X] T004 [US5] Test: `libs/ui-cockpit/src/lib/chart.spec.ts` — `mf-bar-chart` and `mf-line-chart` render an `mf-panel` titled by `title`; with points a canvas `role="img"` whose `aria-label` reads "Cheltuieli, Ianuarie 2027 – Martie 2027. Cea mai mare valoare: 2.000 lei, Februarie 2027. Cea mai mică: 500 lei, Ianuarie 2027." and the English version after `I18n.use('en')`; a single point gives a one-label period; non-finite values are left out of the extremes; the live chart (`Chart.getChart`) is a bar / line chart of those points; new points redraw the same chart with `update('none')` and no new chart; empty points show "Încă nu sunt date" and no canvas; `loading` shows the skeleton and `aria-busy`, wins over `error`; `error` shows "Reîncearcă" whose click emits `retry`, wins over empty; "Vezi ca tabel" toggles `aria-expanded` and a table of label / formatted value rows; a `pointerdown` outside the canvas clears the tooltip's active elements; a device theme change redraws with the new token colours; the chart and its theme listener go with the component (FR-005, FR-006, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-017)
- [X] T005 [US5] `libs/ui-cockpit/src/lib/chart.ts` + `libs/i18n/src/shell/{ro,en}.json` `chart.*` — `CockpitChart`, `BarChart`, `LineChart`, states, summary, table, drawing effect, listeners; exports in `libs/ui-cockpit/src/index.ts` (FR-005, FR-006, FR-009–FR-014, FR-017, FR-018)

## Phase 4: US7 The catalogue (P2)

**Independent test**: the `/cockpit` page shows the bar and line charts and the three states in both languages; at 320 px nothing scrolls sideways and no chart text is under 12 px; tapping a bar on a phone shows the tooltip.

- [ ] T006 [US7] Test: `libs/ui-cockpit/src/lib/charts-sample.spec.ts` — the section renders a lei bar chart and a count line chart with 12 points labelled "Ianuarie 2027"… in Romanian and "January 2027"… in English, an empty chart, a loading chart, and an error chart whose retry shows its data (FR-019, FR-017)
- [ ] T007 [US7] `libs/ui-cockpit/src/lib/charts-sample.ts` + `libs/i18n/src/cockpit/{ro,en}.json` `charts.*` + one element in `libs/ui-cockpit/src/lib/sample-page.ts` (FR-019)
- [ ] T008 [US7] E2E: `apps/web-e2e/src/charts.spec.ts` — in dark and light at 320 px and 1280 px: both charts visible, no horizontal scroll, every chart text and canvas tick font ≥ 12 px; the dark chart's screenshot after light and back equals the first and the light one differs; at 375 px with touch, tapping a bar shows the tooltip and tapping the page heading hides it; with reduced motion the chart is drawn complete at once and without it the bars grow; the server-rendered HTML holds the chart element and the named canvas (FR-005, FR-006, FR-008, FR-015, FR-018, FR-019, SC-003)

## Phase 5: Polish

- [X] T009 Run `npm run typecheck`, `npm run lint`, `npm run test` through heavy.sh; fix what fails

## FR → test map

| FR | Test |
| --- | --- |
| FR-001, FR-002, FR-003, FR-007, FR-016 | `chart-config.spec.ts` |
| FR-004 | `chart-config.spec.ts` (ticks, tooltip), `chart.spec.ts` (summary, table) |
| FR-005 | `chart-config.spec.ts` (tooltip text), `chart.spec.ts` (tap elsewhere), `charts.spec.ts` (tap on phone) |
| FR-006 | `chart-config.spec.ts` (per theme), `chart.spec.ts` (redraw on theme change), `charts.spec.ts` (screenshots) |
| FR-008 | `chart-config.spec.ts`, `charts.spec.ts` |
| FR-009–FR-014, FR-017 | `chart.spec.ts` |
| FR-018 | `charts.spec.ts` (server HTML) |
| FR-015 | `chart-config.spec.ts` (ticks), `charts.spec.ts` (320 px) |
| FR-019 | `charts-sample.spec.ts`, `charts.spec.ts` |

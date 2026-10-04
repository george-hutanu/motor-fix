# Implementation Plan: The shared chart style

**Branch**: `052-chart-style` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/052-chart-style/spec.md`; design in [design.md](./design.md); Notion digest in [context.md](./context.md).

## Summary

Two standalone Angular components in `libs/ui-cockpit` — `mf-bar-chart` and `mf-line-chart` — drawing on a canvas with Chart.js 4 (new dependency, MIT, named by the Technology stack page and the Build brief), inside an `mf-panel`. One pure builder, `chartConfig()`, produces every Chart.js configuration from the points, the unit, the language, the theme colours read from the `--mf-*` tokens and the reduced-motion setting. Values are written only by `formatLei` / `formatKm` / `formatNum` from `@motor-fix/i18n`. The panel shows the skeleton, the retry button or the empty text instead of the chart; the canvas is one `role="img"` named by a summary, with a "view as table" toggle. A catalogue section joins the `/cockpit` sample page.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:70`), Angular 22.2.1 standalone + signals (`package.json:6`).

**Primary Dependencies**: `chart.js` 4.5.1 (new, `--save-exact` like the rest of `package.json`; MIT; its one dependency `@kurkle/color` is MIT), `@motor-fix/i18n` (format functions, `I18n`, `TranslatePipe`), the existing helm button and table and `Panel`.

**Storage**: N/A — data are inputs (Build brief › Data).

**Testing**: Jest 30.5.2, jest-preset-angular 17.0.1, zoneless (`libs/ui-cockpit/jest.config.cts`, `src/test-setup.ts`); jsdom has no canvas 2D context or `ResizeObserver`, so the component spec stubs both and reads the live chart with `Chart.getChart(canvas)`. Playwright 1.63.0 in `apps/web-e2e`, run against a local server on port 4252 through `BASE_URL`.

**Target Platform**: browsers via `apps/web` (Angular SSR). The chart is created in `afterRenderEffect`, which never runs on the server; the panel, title and summary render on both.

**Project Type**: front-end library (`libs/ui-cockpit`).

**Performance Goals**: N/A (12-point charts). Chart.js is tree-shaken: only the bar and line controllers, their elements, the category and linear scales, the tooltip and the filler are registered.

**Constraints**: colours only from tokens (`cockpit.css`); 12 px minimum text, 320 px width; both themes via `prefers-color-scheme`; RO/EN through `I18n`; shared files touched additively only (lib `index.ts`, shell and cockpit i18n JSON, one element in `sample-page.ts`); no edits to the web shell.

**Scale/Scope**: 2 components on one base class, 1 config builder, 1 catalogue section, 5 shell keys and ~6 cockpit keys per language.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat**: one dependency, required because nothing installed draws charts and the stack page names it; one builder shared by the two charts (two call sites); the base class has exactly two subclasses, which exist because the brief names two components; no service, no options knobs beyond what the brief lists (title, points, unit, loading, error, retry). The builder is not exported: no later caller exists yet.
- [x] **II. Test Discipline**: colocated `chart-config.spec.ts`, `chart.spec.ts`, `charts-sample.spec.ts` written red first; e2e `apps/web-e2e/src/charts.spec.ts`.
- [x] **III. The Given Stack**: Angular standalone + signals, Spartan helm button and table, Cockpit tokens; Chart.js is the stack page's Charts row, free and open source.
- [x] **IV. One Repository, One Toolchain**: `libs/ui-cockpit`; Biome root config; Jest root preset.
- [x] **V. Rules Live in One Place**: every number through `libs/i18n/src/formats.ts`.
- [x] **VI. PostgreSQL Is the Truth**: no state, no server.
- [x] **Notion choices**: the Technology stack's Proposed Charts row (Chart.js used directly, A1) is confirmed here.

## Design decisions

- **Config builder** (`lib/chart-config.ts`): `chartConfig(type, points, unit, language, theme, reducedMotion): ChartConfiguration` and `formatValue(unit, value, language)`. `ChartTheme` = `{ amber, line, text, textSecondary, bg, font }`, read by `readTheme(el)` from `getComputedStyle(el)` (`--mf-amber-ink`, `--mf-line`, `--mf-text`, `--mf-text-secondary`, `--mf-bg`, `--mf-font-body`).
  - Common: `maintainAspectRatio: false`; `animation: reducedMotion ? false : { duration: 1000, easing: 'easeOutQuart' }`; `interaction: { mode: 'nearest', axis: 'x', intersect: false }` so a tap anywhere over a column picks it.
  - Scales: `x` — no grid, no border, ticks `textSecondary`, 12 px body font, `autoSkip`, `maxRotation: 0`, `minRotation: 0`. `y` — `beginAtZero`, grid `line` at 1 px, no border, no tick marks, ticks `textSecondary` 12 px with `formatValue`, `maxTicksLimit: 5`.
  - Tooltip: `displayColors: false`, background `text`, body colour `bg`, body font 12 px weight 600, padding 5/8, `cornerRadius: 7`, `caretSize: 0`; `title` callback empty; `label` callback `"<label> · <formatValue>"`.
  - Bar dataset: `backgroundColor`/`hoverBackgroundColor` `amber`, `barThickness: 8`, `borderRadius: 4`, `borderSkipped: 'start'`.
  - Line dataset: `borderColor` `amber`, `borderWidth: 2`, `borderJoinStyle`/`borderCapStyle` `round`, `fill: 'origin'`, `backgroundColor` a scriptable gradient from `amber` at 25% (top of the chart area) to 0% (bottom), `pointRadius: 0`, `pointHoverRadius: 4`, point colour `amber`.
  - The 25%/0% stops come from Chart.js's own colour helper applied to the token value; no colour value is written here.
- **Components** (`lib/chart.ts`): abstract `CockpitChart` directive-less base with the inputs `title` (required), `points` (`readonly ChartPoint[]`, default `[]`), `unit` (required, `'lei' | 'km' | 'count'`), `loading`, `error` (`booleanAttribute`), the `retry` output, and the shared `template`/`styles` constants; `BarChart` (`mf-bar-chart`) and `LineChart` (`mf-line-chart`) set `type`. Exported: `BarChart`, `LineChart`, `type ChartPoint`, `type ChartUnit`.
  - Template: `<mf-panel [heading]="title()">`, then loading → `.mf-chart-skeleton` (200 px, `--mf-panel-raised`, `aria-hidden`) with the panel content marked `aria-busy`; error → secondary helm button "Reîncearcă" emitting `retry`; no points → `<p>` "Încă nu sunt date"; otherwise a 200 px relative box with `<canvas role="img" [attr.aria-label]="summary()">`, a ghost helm button "Vezi ca tabel" with `aria-expanded` and `aria-controls`, and the helm table of label / formatted value when open.
  - Drawing: `afterRenderEffect` reads the canvas `viewChild`, `points`, `unit`, `I18n.language()` and a `scheme` signal; it builds the config with `readTheme(canvas)` and `matchMedia('(prefers-reduced-motion: reduce)').matches`, creates the `Chart` the first time a canvas exists (or a new canvas replaced it), otherwise assigns `data` and `options` and calls `update('none')` — the in-place redraw without the entry animation. A destroyed or vanished canvas destroys its chart.
  - In the browser only (`afterNextRender`): a `prefers-color-scheme` change listener bumps `scheme`; a document `pointerdown` outside the canvas clears the active elements and the tooltip (tap elsewhere hides). Both removed on destroy.
  - Summary: `shell.chart.summary` with `title`, `period` (first label, or "first – last"), `high`, `highLabel`, `low`, `lowLabel` from the finite values; all non-finite → the formatter's dash.
- **Texts**: shell area (always loaded) `chart.empty` "Încă nu sunt date" / "No data yet", `chart.retry` "Reîncearcă" / "Retry", `chart.table` "Vezi ca tabel" / "View as table", `chart.label` "Perioadă" / "Period", `chart.value` "Valoare" / "Value" (table headers), `chart.summary`. Catalogue texts in the cockpit area under `charts.*`.
- **Catalogue** (`lib/charts-sample.ts`, `mf-cockpit-charts-sample`): a bar chart "Cheltuieli pe 12 luni" in lei and a line chart "Garaje noi pe 12 luni" as a count, 12 points labelled with the month names from `calendarNames(language)` and the year, capitalised; an empty bar chart, a loading line chart and an error bar chart whose retry shows its data. One import and one element in `sample-page.ts`, placed after the table panel.
- **E2E screenshot comparison**: baselines would be platform-specific (Playwright suffixes `-darwin` / `-linux`) and the suite runs in the release job on Linux, so a committed macOS baseline would fail there. The comparison is made inside the run instead: the chart's screenshot in dark, after switching to light and back, must equal its first screenshot, and the light one must differ.

## Project Structure

### Documentation (this feature)

```text
specs/052-chart-style/
├── spec.md, design.md, context.md, plan.md, tasks.md, auto-run.md, notion-sync.md
└── checklists/requirements.md, checklists/charts.md
```

### Source Code

```text
libs/ui-cockpit/src/
├── index.ts                      # + BarChart, LineChart, ChartPoint, ChartUnit
└── lib/
    ├── chart-config.ts / chart-config.spec.ts
    ├── chart.ts / chart.spec.ts
    ├── charts-sample.ts / charts-sample.spec.ts
    └── sample-page.ts            # + <mf-cockpit-charts-sample />
libs/i18n/src/shell/{ro,en}.json   # + chart.*
libs/i18n/src/cockpit/{ro,en}.json # + charts.*
apps/web-e2e/src/charts.spec.ts
package.json, package-lock.json    # + chart.js 4.5.1
```

**Structure Decision**: everything in the existing `ui-cockpit` library and sample page; no new project, no route.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New dependency `chart.js` | The brief and the stack page name it; drawing scaled axes, tick thinning, hit-testing and tooltips by hand is far more than 20 lines | Hand-written SVG duplicates a library the owner already chose |
| Abstract base class for two components | The brief names two components with identical inputs, states and template | Two copies of the template and inputs drift; one component with a `type` input drops the names the brief proposes |
| Separate `charts-sample.ts` | ST-51 edits the sample page in parallel | Inlining the catalogue into the shared page conflicts on every merge |

---
capability: cockpit-charts
updated: 2026-10-04
features:
  - 052-chart-style
---

# Capability: Cockpit charts

The shared bar and line charts of the dashboards: amber on one value axis in the Cockpit tokens of the device theme, values written by the shared locale formats, a tooltip on hover or tap, loading, empty and error states, and a summary and a table for assistive technology.

## Requirements

### 052-FR-001 — The bar chart MUST draw its values as amber bars 8 px thick with rounded tops and square bottoms, in the theme's amber for lines and text.

_From 052-chart-style._

### 052-FR-002 — The line chart MUST draw its values as one amber line 2 px wide with a fill under it that fades from 25% amber at the top of the chart to 0% at the bottom, and no point markers until a point is hovered or tapped; a hover or tap anywhere over a point’s column picks it.

_From 052-chart-style._

### 052-FR-003 — Both charts MUST show one value axis only, with hairline grid lines in the theme's hairline colour, no category grid lines, no axis border lines and no legend; the panel title says what is shown.

_From 052-chart-style._

### 052-FR-004 — Both charts MUST take their values as numbers with one unit — lei (given in bani), km, or a count — and MUST format value-axis labels, tooltip values, the summary and the table through the shared locale formatters for the current language (in Romanian: lei "1.250 lei", km "1.250 km", count "1.250"), re-formatting when the language changes.

_From 052-chart-style._

### 052-FR-005 — Hovering a bar or point on a pointer device MUST show a tooltip of one line, "label · value"; tapping a bar or point on a touch device MUST show the same tooltip, and tapping anywhere else MUST hide it.

_From 052-chart-style._

### 052-FR-006 — Every chart colour (bars, line, fill, grid, axis text, tooltip surface and text) MUST come from the Cockpit tokens of the current theme, and a chart on screen MUST redraw in the other theme's tokens when the device switches between dark and light, without a reload.

_From 052-chart-style._

### 052-FR-007 — The chart amber MUST have a contrast ratio of at least 3:1 against the panel and the page background in both the dark and the light theme.

_From 052-chart-style._

### 052-FR-008 — Bars and lines MUST grow in on first draw over 1000 ms with a quartic ease-out, and MUST appear at once, without growing, when the device asks for reduced motion.

_From 052-chart-style._

### 052-FR-009 — When its values change, a chart MUST redraw in place without replaying the entry animation.

_From 052-chart-style._

### 052-FR-010 — With no values, a chart MUST show the text "Încă nu sunt date" / "No data yet" in its panel instead of the chart and its axis.

_From 052-chart-style._

### 052-FR-011 — While its host says it is loading, a chart MUST show a skeleton block of the chart's height in its panel instead of the chart.

_From 052-chart-style._

### 052-FR-012 — When its host says loading failed, a chart MUST show a "Reîncearcă" / "Retry" button in its panel instead of the chart, and pressing it MUST notify the host.

_From 052-chart-style._

### 052-FR-013 — The drawn chart MUST be exposed to assistive technology as one image whose name is a one-line summary: the title, the period from the first to the last label, and the highest and lowest values with their labels, formatted for the language.

_From 052-chart-style._

### 052-FR-014 — A chart MUST offer a "Vezi ca tabel" / "View as table" toggle that shows its values as a table of label and formatted value, and hides it again; the toggle states whether the table is shown.

_From 052-chart-style._

### 052-FR-015 — On a 320 px wide viewport, a 12-month chart MUST fit its panel without sideways scroll, with axis labels at least 12 px that skip labels instead of overlapping or rotating.

_From 052-chart-style._

### 052-FR-016 — Both charts MUST be configured by one shared options builder, so that a change of style applies to every chart in the product.

_From 052-chart-style._

### 052-FR-017 — Every piece of interface text the charts show or announce MUST come from translation keys present in Romanian and English.

_From 052-chart-style._

### 052-FR-018 — A chart MUST render on the server without error, with its panel, title and summary, and draw the chart only in the browser.

_From 052-chart-style._

### 052-FR-019 — The Cockpit sample page MUST show a bar chart and a line chart of 12 monthly values, so the style can be approved in both themes and on phone and desktop widths.

_From 052-chart-style._

## Retired

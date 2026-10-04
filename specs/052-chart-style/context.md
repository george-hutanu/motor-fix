# Context: 052-chart-style

**Gathered**: 2026-10-04 · **Anchor**: story ST-52 https://app.notion.com/p/3ee607bff0d28176aa7efb7b909ee35b

The `org-researcher` subagent had no Notion tools in this session (its tool list names other connector ids), so it wrote an `[UNAVAILABLE: notion]` stub. This digest was gathered instead by the main run with read-only calls (`notion-fetch`, `notion-search`) on the session's Notion connector. `notion-query-data-sources` was over its workspace usage limit; rows were found by search instead.

## Sources
- Story ST-52, page last edited 2026-10-04T05:57Z; Build brief "current as of 2026-10-03" with a 2026-10-04 supersession; no discussions.
- Epic EP-1 Foundations, page last edited 2026-10-03T19:24Z (Build plan, Out of scope, Design table).
- Foundations (EP-1) build timeline row "Build the shared chart style" (ST-52, lane A · UI kit, wave W3, 3 points, blocked by the ST-50 and ST-19 rows).
- Architecture › Technology stack, last edited 2026-10-04T05:56Z.

## Findings
- **Chart library**: Technology stack › Front end › Charts — "Chart.js, used directly, for bars and lines; custom SVG for the dial, the mileage line and the lift timeline", status Proposed; superseded 2026-10-04 from "PrimeNG Chart (Chart.js)" (A1). The story's Build brief says the same (supersession dated 2026-10-04). Chart.js is MIT-licensed, so it meets the free-and-open-source rule of A1 / constitution III.
- **Scope**: bar and line components (proposed names `mf-bar-chart`, `mf-line-chart`), one options factory, empty and loading states, a text alternative for screen readers; 9 acceptance scenarios; rules (one colour amber, one axis, no legends; values as numbers with a unit formatted by ST-19; entry grow 0.9–1.2 s `cubic-bezier(.32,.72,0,1)`, off with reduced motion; live re-render without replaying the entry); states (loading skeleton, empty text, error "Reîncearcă"); data none; tests (unit: options per theme, tooltip formatting RO/EN, empty state, summary text, reduced motion; e2e: catalogue page with a bar and a line chart, dark and light, 320 and 1280 px, screenshot comparison, tap a bar on mobile).
- **Out of scope**: the dashboards' charts and their data (Driver insights spend, admin growth); epic Out of scope says the same.
- **Epic order**: Build plan slice 3 (shared components), "needs ST-50, ST-19"; both are merged on `main`.
- **Rendering**: Technology stack › Rendering — SSR for public pages, client-side for dashboards (Proposed). The `/cockpit` catalogue page is server-rendered today, so the chart must render on the server without drawing.

## Constraints
- Front-end dependencies free and open source (A1, constitution III): Chart.js (MIT) qualifies; no PrimeNG.
- The mileage line in the driver dashboard is custom SVG per the stack page, not this chart — the catalogue's line example should not be a mileage chart.
- Colours from `--mf-*` tokens only (ST-50); formatting through `libs/i18n` (ST-19).

## Contradictions
- The story's acceptance criteria (above the brief) say only "Lines have a soft fill" and "A tooltip shows on hover or tap"; the Build brief gives 25% → 0% and the tooltip text — no conflict, the brief is more precise and wins by its own rule.
- Mock vs Build brief: see design.md (bar width, axis, fill). The Build brief (2026-10-03/04) is newer than the mock v22 boards.

## Gaps
- The light theme is still marked "the owner approves the light set" in `cockpit.css` (ST-50 TODO); the chart uses whatever the light tokens are.

## Proposed Clarifications
- None that block the build: every *(proposed)* detail in the brief is taken as written.

# Design: Build the shared chart style
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d28176aa7efb7b909ee35b

## Boards
- Dashboards (Cockpit) › Dashboard · Driver (`DashClient.dc.html`): the 12-month spend bar chart — 12 bars in a 210 px plot, `max-width: 24px`, `border-radius: 4px 4px 0 0`, amber FFB000; a 1 px hairline baseline (2A2D31), no value axis, month initials under the bars in 12 px secondary grey (9A9DA3); the value printed above the highest bar only. Bars grow from the bottom over 900 ms `cubic-bezier(.32,.72,0,1)`, staggered 45 ms. The km chart on the same board is a line: 2 px amber polyline with round joins, a flat 8% amber fill under it, horizontal hairline grid lines with tick labels on the left (12 px grey), 190 px tall, 44 px tap targets on the points.
- Dashboard tooltip (`.mf-tip`, every dashboard): an inverted chip — background F2F2F0 (the text colour), text 0B0C0E (the page colour), 12 px 600, padding 5×8 px, radius 7 px, 6 px above the bar, fading in over 140 ms; text "label · value lei", e.g. "M · 1.250 lei".
- Dashboards (Cockpit) › DashGarage, DashAdmin: the same bar columns (`.mf-barcol`), the admin growth line (2 px amber, 10% fill, drawn in with a dash animation) and horizontal bars (`.mf-hbar`, 10 px high, radius on the right end) for rankings.
- Mobile boards (`MDash*.dc.html`) only embed the desktop boards at phone width; no separate chart design.

## What to build to match it
- `mf-bar-chart` and `mf-line-chart` in `libs/ui-cockpit`, each inside an `mf-panel` whose title says what is shown (the mock's panels carry a Michroma capital title).
- Bars amber, rounded 4 px at the top, square at the bottom, 8 px thick (Build brief; the mock's 24 px maximum is the older, wider look).
- Line amber 2 px with round joins and no point markers until hovered; fill amber fading 25% → 0% downwards (Build brief; the mock's fill is a flat 8–10%).
- One value axis on the left with hairline grid lines in the line token and 12 px secondary-text tick labels; category labels under the plot in 12 px secondary text; no legend.
- Tooltip as the mock's chip: text-colour surface, page-colour text, 12 px semibold, 7 px radius; one line "label · value".
- Colours from the `--mf-*` tokens only: amber ink (FFB000 dark, 8A5E00 light), line, text, text-secondary, bg.
- Catalogue: a section of the `/cockpit` sample page with a 12-month bar chart (lei) and a 12-month line chart (km), plus the empty, loading and error states.

## States
- Shown in the mock: a full 12-month bar chart and line chart; hover tooltip; months with a zero value (no bar).
- Not designed (build from the Build brief, flag in the PR): no data ("Încă nu sunt date"), loading skeleton, error with "Reîncearcă", the screen-reader summary and the "Vezi ca tabel" table, the light theme, reduced motion, phone tap behaviour, label thinning at 320 px.

## Mock vs Build brief
- Mock bars are up to 24 px wide → Build brief: thin, 8 px *(proposed)*. The Build brief wins.
- Mock bar chart has no value axis, only a baseline and a value on the highest bar → Build brief: one value axis with hairline grid lines. The Build brief wins; the value-on-the-max-bar label is not carried over (the axis and tooltip give the values).
- Mock line fill is flat 8–10% amber → Build brief: soft fill fading 25% → 0%. The Build brief wins.
- Mock entry: 900 ms (bars) and a 1200 ms dash draw (admin line) with `cubic-bezier(.32,.72,0,1)` → Build brief: grow over 0.9–1.2 s with that curve, off with reduced motion. Built as a 1 s grow with the closest built-in ease-out; the line grows from the axis rather than drawing along its length.
- Mock colours are dark-theme literals (FFB000, 9A9DA3, F2F2F0) → the tokens (amber ink, text-secondary, text) so the light theme follows; 9A9DA3 is not a token.
- Horizontal ranking bars (`.mf-hbar`) are in the mock but not in this story's scope (bar and line only); they stay with the dashboards that need them.

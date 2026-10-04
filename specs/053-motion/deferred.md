# Deferred findings: 053-motion

Findings a review verified but deliberately did not act on in this feature.

- [ ] `libs/ui-cockpit/src/lib/chart.ts:93` — **medium** — from ST-52 (#23): the charts read `matchMedia('(prefers-reduced-motion: reduce)')` once per redraw instead of the shared `REDUCED_MOTION` signal. Chart.js animates in script, so the CSS reduced-motion rule does not still it, and switching reduced motion on while a chart is open is not followed until it redraws; the charts should read `REDUCED_MOTION` (code-reviewer, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281beb7fef25a5d0d7cb7
- [ ] apps/web-e2e/src/charts.spec.ts — **low** — "grows the bars in" switches the panels' rise off with an injected style instead of waiting for mf-rise to finish (pr-tester lap 2, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d2819e9dc8d6d48ec9cf0f

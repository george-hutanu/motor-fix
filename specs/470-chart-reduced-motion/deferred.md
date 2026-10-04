# Deferred findings: 470-chart-reduced-motion

Findings a review verified but deliberately did not act on in this feature.

- [ ] `apps/web-e2e/src/charts.spec.ts:138` — **low** — "follows reduced motion switched while the charts are on screen" assumes the retried chart is still growing when reduced motion turns back on, without enforcing it (the switch must land inside the 1000 ms growth); the sibling "grows the bars in" test makes the same assumption. Accepted for now; a deterministic version would hold the animation (e.g. a longer duration under test, or Chart.js's `onProgress`) before switching (code-reviewer, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d2817aa0dec871ab9e2964

# Auto run — 052-chart-style

Description: ST-52 — Build the shared chart style in libs/ui-cockpit (Cockpit theme tokens, dark and light; labels through the ST-19 formats). Notion story https://app.notion.com/p/3ee607bff0d28176aa7efb7b909ee35b.
Start commit: 9a2753c (origin/main after rebase, coordinator resume 2026-10-04). Branch 052-chart-style.

## Preflight
- Tree clean; typecheck green, lint green, `npm run test` green (10 tasks); spec-drift: no active feature yet.
- Constitution v1.4.0 read (Principle I first; VII task lifecycle).
- Coordinator resume: merge freeze until PR #21 merges; heavy commands through heavy.sh.

## 0 Size
- Level 2 (feature): new dependency and design choices (component shape, SSR, theme reading). Evidence: level.mjs suggest → 2.

## 2 Specify
- Spec folder forced to specs/052-chart-style (brief). Branch already created; before_specify branch hook not re-run.
- Autonomous defaults (spec Assumptions): host writes labels; plot 200 px; tap elsewhere = anywhere outside a bar/point; quartic ease-out over 1 s for the brief's cubic-bezier; chart texts in the shell area; tooltip as the mock's inverted chip.
- after_specify: notion-sync start (story → In progress, timeline row → In progress, epic unchanged); design-check → design.md (mock files DashClient/DashGarage/DashAdmin read).

## 3 Context
- org-researcher had no Notion tools in its tool list (other connector ids) → stub; digest written by the main run with read-only fetch/search. query-data-sources over workspace limit; used search.
- Constraint: Chart.js used directly (Technology stack, Proposed, A1, 2026-10-04); MIT. Mileage line is custom SVG per the stack page → catalogue line example is a count, not km.

## 4 Clarify (5 autonomous answers, spec-challenger input)
- One label per point (Principle I) · per-unit formatters formatLei/formatKm/formatNum · autoSkip, no rotation, ≥12 px · tokens read from computed style at draw and on scheme change · 1000 ms easeOutQuart; precedence loading>error>empty>chart; role=img summary on server too; 22 px hit radius.

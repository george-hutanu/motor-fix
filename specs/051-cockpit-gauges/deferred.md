# Deferred — 051-cockpit-gauges

Findings that are real but not this change.

- libs/ui-cockpit/src/lib/sample-page.ts:1 — at 320 px the `/cockpit` sample page scrolls about 5 px sideways (the heading, intro, form field and tabs from the theme story reach 325 px). The gauges' own panel fits. Owner: the theme's sample page. (spec-reviewer, LOW, 2026-10-04)
- The Build brief's screenshot comparison and axe scan are not in the e2e suite (light theme awaiting approval; axe is not a dependency). (spec Assumptions, 2026-10-04)
- apps/web-e2e/src/gauges.spec.ts and cockpit.spec.ts each carry an `rgb()` hex helper; the gauges suite now reads its colours from the page's computed tokens, the theme suite still hard-codes its table. A shared e2e helper is the theme suite's change. (code-reviewer, LOW, 2026-10-04)

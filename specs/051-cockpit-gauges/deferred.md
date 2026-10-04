# Deferred findings: 051-cockpit-gauges

Findings a review verified but deliberately did not act on in this feature.

- [ ] `libs/ui-cockpit/src/lib/sample-page.ts:1` — **low** — pre-existing: at 320 px the `/cockpit` sample page scrolls about 5 px sideways (the theme story's heading, intro, form field and tabs reach 325 px); the gauges' own panel fits (spec-reviewer, 2026-10-04)
- [ ] `specs/051-cockpit-gauges/spec.md:164` — **low** — the Build brief's screenshot comparison and axe scan are not in the e2e suite: the light theme awaits the owner's approval, and axe is not a dependency (spec Assumptions, 2026-10-04)
- [ ] `apps/web-e2e/src/cockpit.spec.ts:17` — **low** — pre-existing: the theme suite hard-codes its token hex table and an `rgb()` helper that the gauges suite also has; a shared e2e helper, or reading computed tokens as `gauges.spec.ts` now does, belongs to the theme suite (code-reviewer, 2026-10-04)

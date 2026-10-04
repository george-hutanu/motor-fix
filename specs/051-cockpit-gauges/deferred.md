# Deferred findings: 051-cockpit-gauges

Findings a review verified but deliberately did not act on in this feature.

- [ ] `specs/051-cockpit-gauges/spec.md:164` — **low** — the Build brief's screenshot comparison and axe scan are not in the e2e suite: the light theme awaits the owner's approval, and axe is not a dependency (spec Assumptions, 2026-10-04)
- [ ] `apps/web-e2e/src/cockpit.spec.ts:17` — **low** — pre-existing: the theme suite hard-codes its token hex table and an `rgb()` helper that the gauges suite also has; a shared e2e helper, or reading computed tokens as `gauges.spec.ts` now does, belongs to the theme suite (code-reviewer, 2026-10-04)
- [ ] `libs/ui-cockpit/src/lib/gauges-sample.ts:53` — **low** — the catalogue's "no price" odometer is a bare "—" right after the range and reads as part of it; a caption per sample would separate them (pr-tester lap 1, 2026-10-04)
- [ ] `apps/web/src/app/home/home.ts:1` — **medium** — pre-existing: axe on `/` reports no main landmark and content outside landmarks; this PR does not touch `/` (pr-tester lap 1, 2026-10-04)

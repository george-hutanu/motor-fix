# Deferred findings: 051-cockpit-gauges

Findings a review verified but deliberately did not act on in this feature.

- [ ] `specs/051-cockpit-gauges/spec.md:164` — **low** — the Build brief's screenshot comparison and axe scan are not in the e2e suite: the light theme awaits the owner's approval, and axe is not a dependency (spec Assumptions, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281cba0d1ebafe724eda8
- [ ] `apps/web-e2e/src/cockpit.spec.ts:17` — **low** — pre-existing: the theme suite hard-codes its token hex table and an `rgb()` helper that the gauges suite also has; a shared e2e helper, or reading computed tokens as `gauges.spec.ts` now does, belongs to the theme suite (code-reviewer, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d2814d96fddfd69ecf0865
- [ ] `libs/ui-cockpit/src/lib/gauges-sample.ts:53` — **low** — the catalogue's "no price" odometer is a bare "—" right after the range and reads as part of it; a caption per sample would separate them (pr-tester lap 1, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281e6870bd1dddb917ab5
- [ ] `apps/web/src/app/home/home.ts:1` — **medium** — pre-existing: axe on `/` reports no main landmark and content outside landmarks; this PR does not touch `/` (pr-tester lap 1, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d28150a4b9d50fbc0092b5
- [ ] `libs/ui-cockpit/src/lib/rating-dial.ts:85` — **low** — decision: on the large dial with no rating ("—") the static needle rests at 0, which can read as a poor rating; the mock does not draw the no-reviews state (design.md › Not designed), so hiding or centring the needle there is the owner's call (orchestrator visual pass, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d28109a9d2efa4604e37bc

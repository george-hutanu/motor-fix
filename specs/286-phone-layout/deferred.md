# Deferred findings: 286-phone-layout

Findings a review verified but deliberately did not act on in this feature.

- [ ] `libs/ui-cockpit/src/styles/cockpit.css` (phone media query) — **medium** — on a phone the list rows hide the header row and set the table, body and rows to block/flex, so screen readers lose the column names (the rating is read as a bare "4,9") and WebKit may drop the table semantics; give each list row its column names (e.g. `role` restore or visually hidden labels) when the first real list lands (pr-tester lap 1, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281bf8f19f86a7a0ca7ee
- [ ] `apps/web/src/app/home/home.ts` — **medium** — pre-existing: Home has no `main` landmark and content sits outside any landmark (axe `landmark-one-main`, `region`); add the landmarks when Home's real screen is built in Discovery (pr-tester lap 1, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281c89677c05d6df79f7e

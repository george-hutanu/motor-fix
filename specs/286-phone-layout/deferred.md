# Deferred findings: 286-phone-layout

Findings a review verified but deliberately did not act on in this feature.

- [ ] `libs/ui-cockpit/src/styles/cockpit.css` (phone media query) — **medium** — on a phone the list rows hide the header row and set the table, body and rows to block/flex, so screen readers lose the column names (the rating is read as a bare "4,9") and WebKit may drop the table semantics; give each list row its column names (e.g. `role` restore or visually hidden labels) when the first real list lands (pr-tester lap 1, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281bf8f19f86a7a0ca7ee
- [ ] `apps/web/src/app/home/home.ts` — **medium** — pre-existing: Home has no `main` landmark and content sits outside any landmark (axe `landmark-one-main`, `region`); add the landmarks when Home's real screen is built in Discovery (pr-tester lap 1, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281c89677c05d6df79f7e
- [ ] `libs/ui-cockpit/src/lib/odometer.ts` — **medium** — at 200 % text on a 375 px phone the range odometer wraps between digits ("1,250–1,60" / "0 lei"), because `.mf-odometer-value { flex-wrap: wrap }` makes every character its own flex item; group each amount and the "lei" unit in its own nowrap span so the line breaks at the dash (pr-tester lap 3 #4, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281e498e2db2f6e0e93c7

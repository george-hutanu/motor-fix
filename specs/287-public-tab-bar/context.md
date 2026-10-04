# Context: 287-public-tab-bar (ST-287)

**Gathered**: 2026-10-04 · **Source**: the Notion space "MotorFix — Product documentation", read in this session.
[UNAVAILABLE: org-researcher — its session loaded no Notion tools; the pages below were read by the run's own Notion connector instead.]

## Read
- Story ST-287 https://app.notion.com/p/3ee607bff0d281e1bf91cd25024ee64e (edited 2026-10-03; no comments): acceptance criteria, Notes, Build brief (wins over the body).
- Timeline row https://app.notion.com/p/3ee607bff0d281c2b8aac5ff4a90f456: Lane B · i18n & shell, W3, 3 points; blocked by ST-286 and ST-17; blocking one story; "Outside EP-1 / open": "build the bar against placeholder routes".
- Epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707: Build plan slice 9 ("bottom tab bars"); Out of scope: the public screens come in Discovery and garage profile (EP-4); decision 2026-10-03: smallest phone text 12 px everywhere.
- Sibling ST-288 https://app.notion.com/p/3ee607bff0d2816f83b1d10d181fc8f1: the dashboards' own bar, `mf-dashboard-tab-bar`, fed by each dashboard's view list; a separate component.
- ST-307 https://app.notion.com/p/3ee607bff0d281a097c8f64d3d995021 (EP-4): the garage profile's address is the garage slug under the language prefix, with the brand as the `brand` query parameter carried from the results; API `GET /api/v1/garages/:slug?brand=`.
- Search hit "Update open garage profiles and search results live" (EP-4): the mechanic's page is `/mechanics/:slug`.

## Decisions
- 12 px floor on a phone, the mock's 11 px tab labels fixed (story Notes, decided 2026-10-03).
- The bar shows below 768 px; from 768 px the desktop header (Build brief scenario 8).
- Nav landmark "Navigare principală"; the active tab amber with `aria-current="page"`; icons with labels, never icons alone (Build brief Rules).

## Constraints
- The sign-in sheet (ST-82, https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908) and the screens behind Caută and Service-uri are out of scope.
- "Cont" for a signed-in person opens the dashboard of the role used last (ST-394, proposed).

## Contradictions
- Mock nav label "Secțiuni" vs Build brief "Navigare principală" → the Build brief (design.md).
- Mock breakpoint 640 px vs Build brief 768 px → the Build brief.

## Open
- The exact results address is not named in Notion; the placeholders use `garages` (results), `garages/<slug>`, `mechanics/<slug>`, `account` (spec Clarifications).

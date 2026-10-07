# Feature Context: Brand-first garage list

- **Feature**: 043-brand-first-garage-list
- **Anchor**: ST-43 "List garages that take my brand before those that refuse" — https://app.notion.com/p/3ee607bff0d281e68b80d309875dec93 | terms: garage, brand, works_on, does_not_take, counts
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok (Architecture decisions only) | decisions ok (index page only; decision 15 reached through ST-41)
- **Overall confidence**: high

## Story

- **ST-43 List garages that take my brand before those that refuse** — status Planning, priority High, role Driver, epic EP-2 Garage onboarding and verification, feature MF-9 Brand compatibility, 3 points, labels backend + front end, PR #198 (page last edited 2026-10-07T10:03Z)
- Scope per the story: takers listed before refusers; refusers still listed after, with the red lamp; a count line above the list for both groups ("3 work on BMW, 3 do not take it"); order built from each garage's saved brand lists. The Build brief (2026-10-03) wins over the criteria above it: backend grouping in the `search` module plus two counts over everything found, not the page; scope stops at query and API fields.
- Comments that moved scope: none (the page carries no comments, resolved or open).

## Decisions

- An unmarked brand counts as a refusal: shown last for that brand with a red lamp, never hidden; group order is `works_on` first, then `does_not_take` and not-marked together — [ST-43 Notes and Build brief "Rules"; ST-41 Decide task (Done)] (2026-10-03, confidence: high)
  - superseded: feature page rule "A brand left unstated counts as not confirmed. It is not shown as a refusal" — superseded by the same page's 2026-10-03 note and by ST-41 (2026-10-03)
- Counts are worked out once per search over everything found (48 found, 20 loaded: counts cover 48); the line reads "N lucrează pe BRAND · M nu o primesc", and with no taker "0 lucrează pe Tesla · 5 nu o primesc" — [ST-43 Build brief, scenarios 2, 3, 6] (2026-10-03, confidence: high)
- Inside each group the results' sort applies; default is better rating first, then more reviews — [ST-43 Rules; MF-9 Build brief rule 7; ST-328 scenario 1] (2026-10-03, confidence: high)
- Only approved, non-suspended garages are listed or counted; a mobile mechanic is counted and grouped like any other garage — [ST-43 scenarios 7, 8; MF-9 Build brief rule 12] (2026-10-03, confidence: high)
- Lists use cursor pagination `{ items, nextCursor, total }`, 20 a page — [Architecture decisions A30] (2026-10-04, confidence: medium: status "Proposed")
- A garage that refuses or has not marked a brand never receives quote requests for it (routing runs in `quotes`, not here) — [ST-43 Rules; MF-9 rule 4] (2026-10-03, confidence: high)
- Search is brand-only at launch; model, year and fuel go into the quote request — [MF-9 Open questions, Decided] (2026-10-03, confidence: high)

## Constraints

- Reads GARAGE (status, location, service_radius_km, rating, review_count) and GARAGE_BRAND; writes SEARCH_LOG (one row per search, brand and area, no account) marked *(proposed: may already be written by MF-10)*; no audit history, emits nothing — [ST-43 Build brief, Data and Events] (2026-10-03, confidence: high)
- Paging cursor includes the group so later pages never mix groups *(proposed)* — [ST-43 Rules] (2026-10-03, confidence: medium)
- Depends on ST-39 (GARAGE_BRAND and read function), ST-41 (decided) and ST-207 (only approved garages visible) — [ST-43 Depends on; EP-2 slice 5 "needs ST-39, ST-207"] (2026-10-07, confidence: high)
- Public pages (search results) update live through server-sent events (A8): the results for a brand listen on `public:search:{brandId}` and re-read loaded garages and counts when a garage is approved, suspended, restored or changes brands — [ST-43 Live updates; Architecture decisions A8] (2026-10-03, confidence: medium)
- `garage.updated` with `brands` is live to `public:search` and drops the cache — [MF-9 Build brief, Data and events] (2026-10-03, confidence: medium)
- EP-4 (Discovery) starts 2027-01-18 and needs ST-43 and ST-207: keep slices 4 and 5 on time — [EP-2 Risks] (2026-10-07, confidence: high)

## Prior Art

- ST-41 Decide: unstated brand — Done, source of the refusal rule — [ST-41] (2026-10-03)
- ST-39 brand catalogue and garage brand tables (EP-2 slice 1) — built on this repo's branch history per spec.md; Notion page not re-read — [MF-9 Stories, build order 2] (2026-10-03)
- ST-328 Sort results — To do, will apply inside the two groups; its cursor must carry the sort; "sorting never places a refuser above a taker"; unknown sort answers 400 — [ST-328] (2026-10-03)
- Mock: Results with six sample garages, three BMW takers then three non-takers, with the count line — [ST-43 Notes; MF-9 "In the mock today"] (2026-10-07)

## Open Decisions

- Where a mobile mechanic ranks under Distanță (distance sort) — blocks: nothing in this story; belongs to ST-328 [ST-328 Open].
- Whether SEARCH_LOG is written here or by MF-10 — blocks: the Data "Writes" line of this story [ST-43 Data, *(proposed)*].
- No numbered open decision from Decisions and ideas depends on this story; the brief's "Open: None".

## Contradictions with spec.md

- **spec.md** (2026-10-07): "no distance or area filter ... this story lists every approved garage ... counted and grouped like any other approved garage without a service-area test" — **Notion**: scenarios 1 and 7 speak of "six approved garages near the driver" and a mobile mechanic "whose service area covers the driver's point"; Data reads `location` and `service_radius_km`; the brief's Out of scope hands "search distance and service areas" to MF-10 [ST-43 Build brief] (2026-10-03) — newer: spec.md on date alone; Notion's own text is ambiguous, so treated as a contradiction to confirm.
- **spec.md** (2026-10-07): live updates left to the results screen, "the live stream stays signed-in only" — **Notion**: A8 (2026-10-03) says public search results update live through server-sent events, and ST-43 lists `public:search:{brandId}` — newer: Notion (A8 amended 2026-10-04 on another point; page last edited 2026-10-04) vs spec.md 2026-10-07: spec.md newer, but the spec's choice defers the channel rather than refuting it.
- **spec.md** (2026-10-07): "No SEARCH_LOG row is written" — **Notion**: Data "Writes: SEARCH_LOG (one row per search, not per page)" *(proposed: may already be written by MF-10)* [ST-43] (2026-10-07 page edit) — newer: same date, contradiction.
- **spec.md** (2026-10-07): "No end-to-end (Playwright) test in this story" — **Notion**: Tests list an end-to-end scenario with six seeded garages [ST-43 Tests] (2026-10-07) — newer: same date, contradiction (the results screen it needs is another story's).

## Proposed Clarifications (this command's proposals, not requirements)

- Confirm that listing every approved garage with no area test is acceptable until MF-10, given scenarios 1 and 7 mention "near the driver" and a service area — from the first contradiction.
- Confirm whether this story writes SEARCH_LOG or leaves it to MF-10 — from the third contradiction.
- Confirm that the Playwright scenario is deferred to the results-screen story — from the fourth contradiction.
- Name which channel (`public:search:{brandId}`) a later story publishes, and who emits it on a garage's brand change — from A8 and `garage.updated`.

## Gaps

- [NEEDS CLARIFICATION: counts line wording and Romanian/English labels are the results screen's; this story returns numbers only, confirm no label field in the API]
- The ST-39 story page and the Results screen story (the one that "shows" the line) were not read; only their existence was cited.
- Garage rating and review_count are named in Data as existing fields; no page says which story creates them.

## Sources

- ST-43 List garages that take my brand before those that refuse — https://app.notion.com/p/3ee607bff0d281e68b80d309875dec93
- MF-9 Brand compatibility: works on and does not take — https://app.notion.com/p/3ee607bff0d281a88c5edf39beb72c04
- EP-2 Garage onboarding and verification — https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf
- ST-41 Decide: how an unstated brand is shown and ranked — https://app.notion.com/p/3ee607bff0d281e9b94def3c6beb6c89
- ST-328 Sort results by rating, distance or price — https://app.notion.com/p/3ee607bff0d2817091b3dd2472627c0d
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Decisions and ideas — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d
- Design mock (recorded, not opened) — https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr

## Refresh 2026-10-07

Baseline 2026-10-07 (same-day; the digest's story edit time was 10:03Z).

### New decisions

none found.

### New constraints

none found.

### New contradictions with spec.md

none found. The story's Build brief, Rules, Data, Tests and Live updates read as the digest recorded them; the four recorded contradictions stand.

### Story changes

- ST-43 page edited 2026-10-07T10:24Z (digest: 10:03Z). Status moved Planning to Implementing; PR #198 still linked; priority High, 3 points, Ready to work unticked. No scope text changed.
- Comments: none on ST-43 or on MF-9 (resolved included); no comment created after the baseline.
- MF-9 (last edited 2026-10-03T18:45Z) and Architecture decisions (2026-10-04T05:56Z) unchanged since the digest.

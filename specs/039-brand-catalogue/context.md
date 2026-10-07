# Feature Context: Brand catalogue and its upkeep

- **Feature**: 039-brand-catalogue
- **Anchor**: ST-39 Set up the brand catalogue and its upkeep — https://app.notion.com/p/3ee607bff0d2817494b2f51c09ad7cf7 | terms: brand, catalogue, garage brand, stance
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture partial (Architecture decisions ok; Data model page returned 83k characters and could not be sliced without a shell, so it was not read) | decisions partial (Decisions and ideas index only; the sub-pages were not opened, nothing in the story points at one)
- **Overall confidence**: high

## Story

- **ST-39 Set up the brand catalogue and its upkeep** — status Planning, priority Highest, role System, epic EP-2 Garage onboarding and verification, Task, 3 points, labels backend and data, PR #193 (page edited 2026-10-07T08:04Z)
- Scope per the story: "one brand list kept by MotorFix and, for each garage, what it takes and what it refuses." The Build brief (current as of 2026-10-03) wins over the criteria above it. Scope: the `catalogue` module's BRAND list, its loader and brand search; the `garages` tables GARAGE_BRAND (stance and fuel ticks) and GARAGE_BRAND_JOB; two garage text fields; one read function for a garage's answer for a brand. No screens, no events, no Playwright test.
- Comments that moved scope: none. The page has no comments, and the page's own dated notes (2026-10-03, edited in place) carry the scope changes.

## Decisions

- The list holds every car brand sold in Romania, with search everywhere, not the twelve of the mock; brands are never added because drivers asked, and MotorFix still corrects and adds brands that go on sale — [ST-39, Acceptance criteria and Notes; feature page MF-9, Final rules 1] (2026-10-07, confidence: high)
  - superseded by this: the twelve-brand criterion and the "brands drivers asked for shown to the admin" note (ST-39, 2026-10-03)
- This Task only creates the per-brand job and fuel tables; the job ticks are built in ST-412 and the fuel ticks in ST-397, so the 3-point estimate stands — [ST-39, Acceptance criteria] (2026-10-03, confidence: high)
- A brand not marked by the garage counts as a refusal for drivers (red lamp, shown last, no requests); no row means not marked — [ST-39, Rules; MF-9, Final rules 3] (2026-10-03, confidence: high)
  - superseded by this: "an unstated brand counts as not confirmed, not as a refusal" (MF-9, Rules, older line)
- `GARAGE_BRAND.stance` is `works_on` or `does_not_take`; the three drivers' values are `works_on`, `does_not_take`, `unstated` — [ST-39, Rules and validation] (2026-10-03, confidence: high)
- All four fuel ticks are true when a brand becomes `works_on` [X20d]; fuel ticks and `GARAGE_BRAND_JOB` rows exist only for a `works_on` brand — [ST-39, Rules and validation] (2026-10-03, confidence: high)
- Search is brand-only at launch; model, year and fuel go into the quote request — [ST-39, Notes; MF-9, Final rules 10] (2026-10-03, confidence: high)

## Constraints

- Build it first in EP-2: EP-3's ST-89 (add a car) needs the brand list and its search and cannot start before this Task is done — [ST-39, Build brief "Depends on"; MF-9, Stories in build order] (2026-10-03, confidence: high)
- This Task ships a development list of at least the twelve mock brands; ST-245 loads the full list (every brand with registrations in Romania, official spelling, slug, starting popularity) before pilot garages list, about March 2027, and loads it through this loader, twice-run idempotent — [ST-39; ST-245 scenarios 1, 2, 4] (2026-10-03, confidence: high)
- `GARAGE_BRAND_JOB` holds (garage_id, brand_id, job_type_id, ticked); `job_type_id` points at JOB_TYPE, which ST-354 creates later in the same epic — [MF-9, Data and events; EP-2 Build plan slice 1] (2026-10-03, confidence: medium)
- Architecture rules that bind new routes: REST with a generated client (A4), Prisma schema per module (A6), lists as `{ items, nextCursor, total }`, 20 a page (A30), errors as RFC 9457 with a lower-snake `code` (A28, A42), audit history of every change (A27) — [Architecture decisions] (2026-10-04, confidence: high; A28, A30, A42 are Proposed, not Given)

## Prior Art

- ST-39's own proposals sit in the brief: `GET /api/v1/brands?q=` public, 20 a page, cached for an hour; popularity then name when the search is empty; retired brands hidden but kept; audit actor `system` — [ST-39, Build brief] (2026-10-03)
- Admin screen to correct or add a brand: "Correct or add a brand in the brand list", a later story that calls this loader — [story page, via search] (2026-10-03; not fetched, title and highlight only)
- Sibling stories of MF-9 in build order: the "unmarked brand" decision (Done), mark brands (ST-114 area), job ticks ST-412, shared lamp, takers-first results; none built yet — [MF-9, Stories in build order] (2026-10-03)

## Open Decisions

- Fuel ticks and jobs when a brand stops being taken: the feature page says they are "kept hidden and come back if it is taken again (proposed)"; the story says they exist only on a `works_on` row — blocks: whether `does_not_take` may keep dormant tick data (FR-014, FR-015).
- Page size mechanics: the brief says "20 results a page" (proposed); A30 (Proposed) says cursor pagination returning `{ items, nextCursor, total }` — blocks: the response shape of brand search (FR-012).
- The launch job catalogue is still `[NEEDS CLARIFICATION]` (ST-245); it does not block this Task, which only creates tables.

## Contradictions with spec.md

- **spec.md** (2026-10-07): "a `does_not_take` row MUST carry no fuel ticks" (FR-014) and "A brand the garage does not take carries neither fuel ticks nor jobs" — **Notion**: when a brand stops being taken, "its ticks are kept hidden and come back if it is taken again (proposed)" [MF-9, States and lifecycle] (2026-10-03) — newer: spec.md. The ST-39 brief ("only on a `works_on` row") agrees with the spec; the feature page line is marked proposed, so this is a flagged tension, not a defeat of the spec.
- **spec.md** (2026-10-07): "Garage brand job: one job a garage does for a brand … one row per garage, brand and job" with no job-type reference or `ticked` column — **Notion**: GARAGE_BRAND_JOB (garage_id, brand_id, job_type_id, ticked) [MF-9, Data and events] (2026-10-03) — newer: spec.md; the spec is thinner, not opposed.

## Proposed Clarifications (this command's proposals, not requirements)

- Does brand search return `{ items, nextCursor, total }` as A30 says, or a bare page of 20? — from A30 vs FR-012.
- Is `GARAGE_BRAND_JOB.job_type_id` a foreign key created now, or a plain column until ST-354's JOB_TYPE exists? Does the row carry a `ticked` flag? — from MF-9 Data and ST-354 ordering.
- When a brand moves from `works_on` to `does_not_take`, are fuel ticks and job rows deleted, or kept hidden? — from MF-9 States and lifecycle.
- Should the brand loader's data file hold a stable key per brand, and should ST-245's full list reuse the same file format? — from ST-39 scenario 4 and ST-245 scenario 4.
- Should the public brand route's error codes follow A28 and A42 (RFC 9457, lower snake)? — from Architecture decisions.

## Gaps

- [NEEDS CLARIFICATION: Data model page (Architecture) was not read; BRAND and GARAGE_BRAND column types and indexes there are unchecked.]
- Whether the search cache lives in Redis or in memory is not stated in the space; the brief only says "cached for an hour".

## Sources

- Set up the brand catalogue and its upkeep (ST-39) — https://app.notion.com/p/3ee607bff0d2817494b2f51c09ad7cf7
- Brand compatibility: works on and does not take (MF-9) — https://app.notion.com/p/3ee607bff0d281a88c5edf39beb72c04
- Garage onboarding and verification (EP-2) — https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Decisions and ideas (index) — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d
- Seed the brand catalogue and the job catalogue (ST-245) — https://app.notion.com/p/3ee607bff0d281a88645ff204accf788
- Design mock (recorded, not opened) — https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr

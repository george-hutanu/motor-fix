# Feature Specification: Brand-first garage list

**Feature Branch**: `043-brand-first-garage-list`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "ST-43 "List garages that take my brand before those that refuse" (EP-2). Feature dir specs/043-brand-first-garage-list on the existing branch 043-brand-first-garage-list."

**Sources**: the Notion story [ST-43](https://app.notion.com/p/3ee607bff0d281e68b80d309875dec93) (EP-2, High, Story, labels backend and front end, 3 points, Role Driver; fetched 2026-10-07 with its page content; it carries no comments). Its **Build brief** (current as of 2026-10-03) is authoritative over the acceptance criteria above it; the ✅ Decided note of 2026-10-03 holds: a brand the garage has not marked counts as a refusal, shown last with the red lamp, never hidden. Sibling stories read for the rules they own: [ST-328 Sort results by rating, distance or price](https://app.notion.com/p/3ee607bff0d2817091b3dd2472627c0d) (the default order inside a group) and the epic [EP-2 Garage onboarding and verification](https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf) (Design table; slice 5 names this story). This repo: ST-39's brand catalogue and garage brands (`.specify/capabilities/catalogue.md`, `garage-brands.md`; `libs/domain/src/catalogue/`, `libs/domain/src/garages/garage-brands.service.ts`), the public garage scope `publicGarages()` in `libs/domain/src/garages/public-garages.ts` (approved garages only), the paged list shape `{ items, nextCursor, total }` of `libs/contracts/src/brands.dto.ts`, and `apps/api/src/public-routes.integration.spec.ts`, which lists every route open to visitors. The clickable mock could not be opened (see `design.md`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Garages that take my brand come first (Priority: P1)

A driver, signed in or not, asks for garages for one brand. Every approved garage comes back in two groups: first the garages that have said they work on the brand, then every other garage, those that refuse it and those that have not said anything about it, which the product treats alike as a refusal. Nothing is hidden: a driver gets a yes or a no for every garage. Only approved garages are listed; a suspended or never-approved garage is in neither group. The answer also says, for every garage, what the garage said about the brand, so the screen can show the red lamp on the second group.

**Why this priority**: It is the story's promise and the data the results screen, Home and the lamp story consume. Nothing else here is testable without the order.

**Independent Test**: Seed six approved garages, three with a `works_on` row for BMW, two with `does_not_take` and one with no row, plus one suspended garage that works on BMW; ask for BMW and check the order and the stances of the six, and that the suspended one is absent.

**Acceptance Scenarios**:

1. **Given** six approved garages, three taking BMW, two refusing it and one that has not marked it, **When** a driver asks for garages for BMW, **Then** the three takers come first and the other three after them, each of those three carrying a refusing answer.
2. **Given** that list, **When** a visitor without a session asks the same, **Then** they get the same answer, not a sign-in demand.
3. **Given** a garage that is suspended or was never approved, **When** garages are asked for any brand, **Then** it is in neither group.
4. **Given** no garage takes Tesla, **When** garages are asked for Tesla, **Then** the first group is empty and every approved garage is in the second group.
5. **Given** a garage changes its answer for BMW from refused to works on, **When** garages are asked for BMW again, **Then** it is now in the first group.

---

### User Story 2 - The count line covers everything found (Priority: P2)

Above the list the driver reads how many garages work on the brand and how many do not take it, "3 lucrează pe BMW · 3 nu o primesc" (3 work on BMW · 3 don't take it). The two counts cover every garage found, not only the page loaded, so a list of 48 garages with 20 loaded still counts all 48. With no garage at all, both counts are zero.

**Why this priority**: The brief's second criterion; it needs the groups of story 1 and nothing else.

**Independent Test**: Seed 48 approved garages, 30 taking BMW and 18 not, ask for the first page and check the counts read 30 and 18 while the page holds 20 garages.

**Acceptance Scenarios**:

1. **Given** six garages, three taking BMW, two refusing it and one unmarked, **When** garages are asked for BMW, **Then** the counts are 3 that work on it and 3 that do not take it.
2. **Given** 48 garages found and only 20 in the first page, **Then** the counts cover all 48.
3. **Given** no garage takes Tesla and five are approved, **Then** the counts are 0 and 5 and the five are listed.
4. **Given** no approved garage at all, **Then** the counts are 0 and 0 and the list is empty, with no error.
5. **Given** a suspended garage that works on BMW, **Then** it is counted in neither number.

---

### User Story 3 - Pages never mix the groups, and ties are settled (Priority: P3)

A long list is read 20 garages a page. Whatever page the driver is on, no taker ever appears after a refuser: the paging carries the group, so a later page continues the group where the earlier one stopped. Inside each group the garages come by name, A to Z, and two garages with the same name by their id, so every page has one answer. No garage carries a rating yet (the reviews epic writes it); the rating-first default and the sort choices of ST-328 come with it and apply inside the same groups.

**Why this priority**: It makes the order hold across pages and makes the order inside a group deterministic, so the results screen and its tests see one answer.

**Independent Test**: Seed 25 takers and 25 refusers; read all three pages and check that the 25 takers fill the first page and the first five of the second, in name order, and the refusers follow, in name order.

**Acceptance Scenarios**:

1. **Given** 48 garages, 30 taking BMW, **When** the pages are read one after the other, **Then** the 30 takers fill page one and the first ten places of page two, the refusers fill the rest of page two and the pages after it, and no page holds a refuser before a taker.
2. **Given** takers named "Auto Delta", "Auto Alfa" and "Auto Beta", **Then** they come Alfa, Beta, Delta.
3. **Given** two takers with the same name, **Then** they come by id, and the page boundary between them neither repeats nor skips either.
4. **Given** a refuser whose name sorts before every taker's, **Then** it still comes after the last taker.
5. **Given** a page is read with the cursor of the previous page, **Then** no garage is repeated or skipped between the two pages.

---

### Edge Cases

- A brand id nobody holds: the answer is "not found"; a malformed brand id is refused as a bad request; a retired brand that is still stored answers like any other (hiding retired brands is the pickers' job).
- A garage with a `does_not_take` row and one with no row are in the same group and counted together, but each carries its own answer (`does_not_take` or `unstated`), so the lamp story can tell them apart if it ever needs to.
- A garage whose stance changes between two pages of one read: the cursor names the group and the position, so the garage may be missing or repeated across the two pages, which is accepted; the counts are read once per page and may differ between pages after such a change.
- A mobile mechanic is an approved garage like any other: counted and grouped the same way. The driver's area and service radii are MF-10's; this story lists every approved garage.
- A cursor that does not belong to this brand or was not issued by this search is refused as a bad request, not answered with a wrong page.
- No rating or review count exists on a garage yet and this story adds none; the order inside a group is name, then id.

## Clarifications

### Session 2026-10-07 (autonomous run)

The spec-kit clarification gate was answered from the Build brief, the constitution card and this repo. Each answer is an Assumptions line marked *(autonomous default)*; none was asked of the owner.

### Session 2026-10-07 (clarify, autonomous)

- Q: Should this story add rating and review-count columns that nothing writes, so the order inside a group can be rating first? → A: No. Inside a group the order is name, then id; the rating-first order comes with the reviews epic and ST-328 (Principle I; `Garage` has no rating, `libs/domain/prisma/schema/garages.prisma`). Open decision for the owner.
- Q: Does the list test the driver's area or a mobile mechanic's service radius? → A: No; every approved garage is listed and counted until MF-10 (search distance and service areas) lands (Build brief "Out of scope"; context.md contradiction 1).
- Q: Is the brand named by its id or its slug, and when is it "not found"? → A: By the brand's uuid (the garage brand rows reference it); not found only when no brand row has that id; a retired (inactive) brand still answers; a value that is not a uuid is a bad request.
- Q: What does the cursor hold, and is it signed? → A: A keyset: the brand id, the group, and the last garage's name and id, base64url-encoded JSON, unsigned; a cursor that does not decode, names another brand or names no group is a bad request (as `invalid_cursor` in the brand search, `libs/domain/src/catalogue/brands.service.ts`).
- Q: What breaks a tie between two garages with the same name, and which collation is "name order"? → A: The garage id breaks it; names compare under the database's default collation, and the tests use names that differ in their first ASCII letter.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST answer a request for the garages for one brand with every approved garage, in two groups: first the garages whose answer for the brand is `works_on`, then every other garage (`does_not_take` and `unstated` together); no garage of the first group ever comes after one of the second, on any page.
- **FR-002**: A suspended or never-approved garage MUST be in neither group and in neither count: only garages visible to the public (the one public scope) are read.
- **FR-003**: The request MUST be open to visitors without a session and listed with the public routes.
- **FR-004**: Each listed garage MUST carry its id, name, slug, and its answer for the brand, in a field named `stance`, one of `works_on`, `does_not_take` and `unstated`, so the screen can show the red lamp on every garage of the second group.
- **FR-005**: The answer MUST carry two counts worked out once over every garage found, not over the page: how many work on the brand (`counts.worksOn`) and how many do not take it (`counts.doesNotTake`, refusers and unmarked together), both whole numbers; with no approved garage both are zero and the list is empty, with no error.
- **FR-006**: The list MUST come 20 garages a page as `{ items, nextCursor, total, counts }`, with an opaque cursor for the next page that carries the brand, the group and the last garage's name and id (a keyset), so the next page continues the same group where the previous one stopped and no garage is repeated or skipped between two consecutive pages of an unchanged list; `total` is the sum of the two counts; `nextCursor` is null on the last page, that is when no garage follows the page.
- **FR-007**: Inside each group the garages MUST come by name under the database's default collation, then by id, so two garages of the same name have one order and a page boundary between them repeats or skips neither.
- **FR-008**: A listed garage MUST carry only the fields FR-004 names: no rating, review count, brand note or refusal phrase is added to the garage or the answer by this story.
- **FR-009**: The brand MUST be named by its uuid; a uuid no brand row holds MUST answer "not found", while a retired (inactive) brand still answers; a missing brand, a value that is not a uuid, an unknown query field, or a cursor that is longer than 200 characters, does not decode, names another brand or names no group, MUST be refused as a bad request, in the API's one error shape with a stable code (`validation_failed`, `invalid_cursor`, `not_found`).
- **FR-010**: The search MUST read a garage's answer for a brand from the garage brand rows ST-39 created (one row per garage and brand, no row is `unstated`), never from a second copy.
- **FR-011**: The search MUST write nothing: no audit entry, no event, no search log (MF-10 owns the search log).

### Key Entities

- **Brand garage list**: the answer for one brand: the garages found, in two groups, 20 a page with a cursor, and the two counts over everything found.
- **Listed garage**: an approved garage as the driver sees it in the list: id, name, slug, and its answer for the brand (`works_on`, `does_not_take`, `unstated`).
- **Brand counts**: two numbers for one brand over every approved garage: those that work on it and those that do not take it (refusing and unmarked together).

## Spec Delta

### Capability: `garage-search`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With six approved garages (three taking BMW, two refusing, one unmarked) and one suspended garage taking BMW, the BMW list holds exactly the six, the three takers first, the other three after them each with a refusing answer, and the counts read 3 and 3.
- **SC-002**: With 48 approved garages (30 taking BMW) read 20 a page, every page is read, the 30 takers occupy positions 1 to 30 across the pages, no garage is repeated or skipped, and every page's counts read 30 and 18.
- **SC-003**: Inside a group, garages named Alfa, Beta and Delta come in that order whatever order they were created in, two garages of the same name come by id, and no refuser comes before a taker whatever its name.
- **SC-004**: A visitor without a session gets the list; the route is in the public-routes list and every other new route is refused without a session, as the existing public-routes check enforces.
- **SC-005**: With no garage taking Tesla and five approved, the Tesla list holds the five in the second group and the counts read 0 and 5; with no approved garage, the counts read 0 and 0.
- **SC-006**: A request with no brand, a non-uuid brand, an unknown query field or a bad cursor (undecodable, another brand's, no group, over 200 characters) answers a bad request with the stable code of FR-009; an unknown brand uuid answers not found; a retired brand answers a list; and after any of these requests no audit, event or search-log row exists (FR-009, FR-011).

## Assumptions

- Search is by brand only, as the Build brief rules: no model, year or fuel filter, and no distance or area filter, which the brief leaves to MF-10 (search distance and service areas, not built yet); this story lists every approved garage, and when MF-10 lands the grouping applies within the area. A mobile mechanic is therefore counted and grouped like any other approved garage without a service-area test. *(autonomous default, Build brief "Rules and validation" and "Out of scope")*
- The garage carries no rating or review count today (`Garage` in `libs/domain/prisma/schema/garages.prisma`) and nothing writes one; this story adds neither, so the order inside a group is name, then id. The brief's scenario 5 ("equal rating: more reviews first") and ST-328's rating-first default wait for the reviews epic, which adds the figures with their writer. **Open decision for the owner**: add unwritten rating columns now instead. *(autonomous default, Principle I; clarify Q1)*
- The paging cursor carries the group and the position, as the brief proposes, with 20 garages a page and the `{ items, nextCursor, total }` shape the brand search already uses, plus the two counts. *(autonomous default, Build brief "The paging cursor includes the group", proposed)*
- `total` in the page is the number of garages found, the sum of the two counts; the counts are read with each page request, so a later page may read different counts if a garage changed in between, which is accepted. *(autonomous default)*
- Refused and unmarked garages are one group and one count, but each listed garage still carries its own answer (`does_not_take` or `unstated`); nothing in this story shows them differently. *(autonomous default, Decided 2026-10-03: "not marked counts as a refusal")*
- The search lives in a new `search` module of the domain library, as the brief names it, reading the public garage scope and the garage brand rows of ST-39; it never reads a second copy of a garage's answer. *(autonomous default, Build brief "Scope: the brand grouping in the `search` module"; Constitution V)*
- The brief's "Live updates: results listen on `public:search:{brandId}`" is the results screen's behaviour and emits nothing here ("Emits: none"); no event, channel or audience rule is added by this story, and the live stream stays signed-in only. The screen's story decides how a public results page follows changes. *(autonomous default, Build brief "Events and notifications")*
- No SEARCH_LOG row is written: the brief marks it proposed and possibly MF-10's, and MF-10 is not built; reads are not audited. *(autonomous default, Build brief "Data: Writes", proposed)*
- A retired brand that is still stored answers like any other brand; an unknown brand id is "not found" and a malformed one a bad request, as the brand and garage routes already behave. *(autonomous default, ST-39 edge cases)*
- No end-to-end (Playwright) test in this story: the results screen that would be driven is another story's (See garages for my brand, those that take it first), so the brief's end-to-end scenario waits for it; Jest unit and API tests on real PostgreSQL cover the order, the counts, the paging, the ties and the exclusions. *(autonomous default, Build brief "Out of scope: the results screen"; Constitution II)*
- The success criteria's numbers (six garages, 48 found and 20 a page, 3 and 3, 0 and 5) come from the Build brief; the names in SC-003 are test values, not a metric.

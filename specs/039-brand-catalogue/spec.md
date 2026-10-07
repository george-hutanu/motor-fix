# Feature Specification: Brand catalogue and its upkeep

**Feature Branch**: `039-brand-catalogue`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "ST-39 "Set up the brand catalogue and its upkeep" — Notion story https://app.notion.com/p/3ee607bff0d2817494b2f51c09ad7cf7 (epic https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf, feature https://app.notion.com/p/3ee607bff0d281a88c5edf39beb72c04)"

**Sources**: the Notion story [ST-39](https://app.notion.com/p/3ee607bff0d2817494b2f51c09ad7cf7) (EP-2, Highest, Task, labels backend and data, 3 points; fetched 2026-10-07 with its page content; it carries no comments). Its **Build brief** (current as of 2026-10-03) is authoritative over the acceptance criteria above it, and the ✅ Superseded / Decided notes of 2026-10-03 override the original criteria: the list holds every car brand sold in Romania rather than twelve; the per-brand job ticks (ST-412) and fuel ticks (ST-397) are built by their own stories, this task only creates their tables; brands are never added because drivers asked for them. This repo: `libs/domain/prisma/schema/*.prisma` (a schema file per module; `garages.prisma` holds `Garage`), `libs/domain/src/<module>`, the audit module's `ActivityLog` with its `system` actor role, and `apps/api/src/public-routes.integration.spec.ts`, which lists every route open to visitors.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One brand list, kept by MotorFix (Priority: P1)

MotorFix keeps one list of car brands for the whole product. The build team changes it through a versioned data file; a loader reads the file and stores every brand once, with its name written one way ("Škoda", "Mercedes-Benz"), a slug ("skoda", "mercedes-benz"), a popularity rank and whether it is active. Running the loader again with the same file changes nothing. A correction to a name keeps the brand's identity and everything garages have said about it; a brand removed from the file is hidden from pickers but kept, with its garage rows, for history. A file with two brands sharing a name or a slug is refused whole: nothing changes. Every change the loader makes is recorded in the audit history under the actor `system`, and a change drops the cached brand list so the next reader sees it.

**Why this priority**: Every other part of brand compatibility (the listing form's brand step, Home, Results, the quote request, EP-3's add-a-car) uses these brand ids. Nothing else in the story is testable without the list.

**Independent Test**: Run the loader against a small file, read the stored brands; run it again and confirm nothing changed; rename a brand, retire one, and load a file with a duplicate, checking the stored rows and the audit history after each run.

**Acceptance Scenarios**:

1. **Given** the brand data file, **When** the loader runs, **Then** every brand in it is stored exactly once, with its name as written in the file and its slug (for "Škoda" the slug is "skoda", for "Mercedes-Benz" it is "mercedes-benz").
2. **Given** a list already loaded from a file, **When** the loader runs again with the same file, **Then** no brand changes and no audit entry is written.
3. **Given** a stored brand "Mercedes" that a garage has marked, **When** the file corrects it to "Mercedes-Benz" and the loader runs, **Then** the brand keeps its id, the garage's mark for it is unchanged, and readers see the new name.
4. **Given** a stored brand that a garage has marked, **When** the brand is no longer in the file and the loader runs, **Then** the brand is kept with its garage rows but is no longer active, so brand search and pickers do not return it.
5. **Given** a file holding two brands with the same name, or two whose slugs are the same, **When** the loader runs, **Then** the load fails, names the duplicate, and the stored list is exactly what it was before.
6. **Given** a loader run that created, renamed or retired a brand, **Then** each change is in the audit history with the actor `system`, and the cached brand list is dropped so the next search reflects the change.
7. **Given** the development data file shipped with this task, **When** the loader runs, **Then** at least the twelve brands of the mock are present and active: BMW, Mini, Mercedes-Benz, Audi, Volkswagen, Škoda, Dacia, Renault, Ford, Toyota, Hyundai, Tesla.

---

### User Story 2 - Find a brand by typing part of its name (Priority: P2)

A driver or a garage owner types a few letters and gets the matching active brands, whatever the accents or case they typed. With nothing typed, the most popular brands come first, then the rest by name. Visitors can search without signing in, results come 20 a page, and the list is served from a cache kept for an hour.

**Why this priority**: It is what the listing form, Home, Results and add-a-car consume; it needs the list of story 1 and nothing else.

**Independent Test**: Load the development list, then search "sko", "Skoda", "ŠKODA" and "" through the public endpoint, as a visitor, and compare the results and their order with the stored brands.

**Acceptance Scenarios**:

1. **Given** the brand "Škoda" is active, **When** a visitor searches "sko", "Skoda" or "ŠKODA", **Then** "Škoda" is among the results.
2. **Given** an empty search, **When** brands are read, **Then** the active brands come back by popularity, the most popular first, and by name where popularity ties.
3. **Given** more than 20 active brands match, **When** a page is read, **Then** at most 20 brands come back and the next page can be asked for.
4. **Given** a retired brand, **When** brands are searched with its name, **Then** it is not returned.
5. **Given** a visitor with no session, **When** they search brands, **Then** they get results, not a sign-in demand.
6. **Given** a search was answered, **When** the same search is asked again within an hour and the list has not changed, **Then** the answer is served from the cache; **When** the loader changed the list in between, **Then** the next search reflects the change.

---

### User Story 3 - A garage's answer for a brand (Priority: P3)

For each garage and brand the product stores one of two stances, works on it or does not take it, and a garage that has said nothing counts as unstated, which drivers see as a refusal. A brand the garage works on also carries four fuel ticks (petrol, diesel, hybrid, electric), all ticked when the brand is first marked as worked on, and may carry one row per job the garage does for that brand. A brand the garage does not take carries neither fuel ticks nor jobs. Each garage can also keep a short note on other limits and a short phrase that replaces its refusal list. One read function gives a garage's answer for a brand. The screens and flows that write these rows belong to other stories (ST-397 fuel ticks, ST-412 job ticks, the listing form's brand step); this task creates the tables, the rules they enforce and the read function.

**Why this priority**: It is the storage the marking stories need; it depends on story 1 for the brand ids and is used by no screen in this task.

**Independent Test**: Create a garage, give it a works-on row for one brand and a does-not-take row for another, then read its answer for those two and for a third brand; try to tick a fuel or add a job on the does-not-take brand.

**Acceptance Scenarios**:

1. **Given** a garage with a works-on row for BMW, **When** its answer for BMW is read, **Then** it is `works_on`.
2. **Given** a garage with a does-not-take row for Tesla, **When** its answer for Tesla is read, **Then** it is `does_not_take`.
3. **Given** a garage with no row for Dacia, **When** its answer for Dacia is read, **Then** it is `unstated`.
4. **Given** a garage marks Dacia as worked on, **Then** its new row has all four fuel ticks true, and a job row for Dacia can be stored.
5. **Given** a garage with a does-not-take row for Tesla, **When** a fuel tick or a job row is attempted for Tesla, **Then** it is refused and nothing is stored.
6. **Given** a garage, **When** a brand note of up to 140 characters and a refusal phrase of up to 60 characters are stored, **Then** they are kept; a longer note or phrase is refused.

---

### Edge Cases

- A rename that changes the slug ("Skoda" to "Škoda" keeps the slug; "Mercedes" to "Mercedes-Benz" changes it): the brand is matched by its stable key in the file, not by name or slug, so the id and its garage rows survive.
- A brand retired then brought back by a later file: the same row becomes active again, id unchanged.
- A duplicate found only after some brands were already written in the same run: the whole run is undone, not just the duplicate.
- A search term that matches no brand returns an empty page, not an error.
- Two brands with the same popularity sort by name; a brand without a popularity rank sorts after every ranked one.
- The read function is asked for a retired brand: it answers from the row as usual (`works_on`, `does_not_take` or `unstated`); hiding retired brands is the pickers' job, not the garage's answer.
- A brand note or refusal phrase of exactly 140 or 60 characters is accepted; whitespace-only text is stored as absent.

## Clarifications

### Session 2026-10-07 (autonomous run)

The spec-kit clarification gate was answered from the Build brief, the constitution card (Principle I) and this repo. Each answer is an Assumptions line marked *(autonomous default)*; none was asked of the owner.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST keep one brand list for the whole product, maintained by MotorFix: garages cannot add, rename or remove a brand, and every part of the product that names a brand uses the same brand ids.
- **FR-002**: Each brand MUST carry a name written one way, a slug unique across brands, a popularity rank and an active flag.
- **FR-003**: The brand list MUST be loaded from a versioned data file kept in the repository by a loader that stores every brand of the file exactly once, and the repository MUST ship a development file holding at least the twelve brands of the mock (BMW, Mini, Mercedes-Benz, Audi, Volkswagen, Škoda, Dacia, Renault, Ford, Toyota, Hyundai, Tesla).
- **FR-004**: The loader MUST be idempotent: a second run with the same file changes no brand and writes no audit entry.
- **FR-005**: When a brand's name or slug is corrected in the file, the loader MUST keep the brand's id and every garage row that names it, and readers MUST see the new name.
- **FR-006**: When a brand is absent from the file, the loader MUST keep it with its garage rows and mark it inactive; inactive brands are not returned by brand search or pickers.
- **FR-007**: A file holding two brands with the same name or the same slug MUST fail the whole load, naming the duplicate, and the stored list MUST be exactly what it was before.
- **FR-008**: Every brand the loader creates, renames or retires MUST be recorded in the audit history with the actor `system`.
- **FR-009**: A change to the brand list MUST drop the cached brand list so the next search reflects it.
- **FR-010**: Brand search MUST match the typed text against brand names ignoring accents and case ("sko", "Skoda" and "ŠKODA" all find "Škoda"), and return only active brands.
- **FR-011**: An empty search MUST return the active brands by popularity, most popular first, then by name.
- **FR-012**: Brand search MUST be open to visitors without a session, return at most 20 brands a page with a way to ask for the next page, and be served from a cache kept for one hour.
- **FR-013**: For each garage and brand the system MUST store at most one row, whose stance is one of `works_on` and `does_not_take`; a garage with no row for a brand has the answer `unstated`.
- **FR-014**: A `works_on` row MUST carry four fuel ticks (petrol, diesel, hybrid, electric), all true when the row is created; a `does_not_take` row MUST carry no fuel ticks, and ticking one on it MUST be refused.
- **FR-015**: A garage MUST be able to hold one row per job it does for a brand, only for a brand with a `works_on` row; a job row for any other brand MUST be refused.
- **FR-016**: A garage MUST be able to hold an optional brand note of up to 140 characters and an optional refusal phrase of up to 60 characters; longer text MUST be refused.
- **FR-017**: One read function MUST give a garage's answer for a brand: `works_on`, `does_not_take` or `unstated`.

### Key Entities

- **Brand**: a car brand sold in Romania; id, name written one way, slug, popularity rank, active flag. Owned by MotorFix; the same id is used across the product.
- **Garage brand**: a garage's stance on one brand (`works_on` or `does_not_take`) with the four fuel ticks on a `works_on` row; at most one per garage and brand.
- **Garage brand job**: one job a garage does for a brand it works on; one row per garage, brand and job.
- **Garage limits**: two optional texts on the garage, a brand note (≤140 characters) and a refusal phrase (≤60 characters).
- **Brand list change**: an audit entry per brand created, renamed or retired by the loader, actor `system`.

## Spec Delta

### Capability: `catalogue`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012
- **Modifies**: none
- **Removes**: none

### Capability: `garage-brands`

- **Adds**: FR-013, FR-014, FR-015, FR-016, FR-017
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the loader runs on the development file, all twelve brands of the mock are stored, active, each once, with the slugs "skoda" and "mercedes-benz" for Škoda and Mercedes-Benz.
- **SC-002**: A second loader run on the same file writes zero changes and zero audit entries; a rename keeps 100% of the brand's garage rows and its id; a duplicate file leaves the stored list identical to before, row for row.
- **SC-003**: Each of the searches "sko", "Skoda" and "ŠKODA" returns Škoda; an empty search returns the brands in popularity-then-name order; a visitor without a session gets results.
- **SC-004**: For a garage with one `works_on` row, one `does_not_take` row and no row for a third brand, the read function answers `works_on`, `does_not_take` and `unstated` respectively; a fuel tick or job on the `does_not_take` brand is refused.
- **SC-005**: The brand search endpoint is in the public-routes list and every other new route is refused without a session, as the existing public-routes check enforces.

## Assumptions

- The brand data file is a versioned file in the repository, read by the loader at deploy or seed time; an admin screen for the list is another story's. *(autonomous default, Build brief "Who can do it")*
- Each brand in the file carries a stable key that survives renames (the slug is not it, since a correction may change the slug); renames and retirements are matched by that key. *(autonomous default: scenario 4 of the brief needs rename-safe identity)*
- Popularity is a number in the data file, set by the build team; ties sort by name, and a brand without a rank sorts last. *(autonomous default, brief scenario 3 marked proposed)*
- A retired brand stays out of search and pickers but is still answered by the read function and still shown on existing garage rows; bringing it back in a later file reactivates the same row. *(autonomous default, brief scenario 5 marked proposed)*
- "Ignores accents and case" means the typed text and the names are compared after folding diacritics and case; matching is on the start of any word of the name or anywhere in it, whichever the implementation chooses, as long as the three Škoda searches pass. *(autonomous default)*
- Public search returns 20 brands a page and is cached for an hour in the shared cache (Redis), with PostgreSQL holding the truth; a loader change drops the cache key. *(autonomous default, brief marked proposed; Constitution VI)*
- The audit entries reuse the existing audit history and its `system` actor role; no new audit table. *(autonomous default, Constitution I)*
- Fuel ticks and job rows are only stored by other stories (ST-397, ST-412); this task creates the tables, the default (all four ticks true on a new `works_on` row), the refusal rules and the read function, with no API route or screen for writing them. *(autonomous default, brief "Superseded 2026-10-03")*
- The brand note and refusal phrase are two optional columns on the garage, limited to 140 and 60 characters; nothing writes them in this task beyond the rules and tests. *(autonomous default, brief marked proposed)*
- No end-to-end (Playwright) test: the brief leaves screens to the stories that show brands. Jest unit and API tests cover the loader, the search and the read function. *(Build brief "Tests")*
- The success criteria's numbers (twelve brands, 20 a page, one hour, 140 and 60 characters) come from the Build brief; no other number is claimed.

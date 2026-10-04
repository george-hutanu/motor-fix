# Feature Specification: Audit history read API

**Feature Branch**: `391-audit-history-api`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-391 — See the audit history of my garage, or all of it as admin: the GET /api/v1/audit-history API over ST-390's activity_log, with the capability rules from ST-79's policy (404 for no right or another garage's entries), filters and paging per the Build brief; the screens come later with ST-97 and ST-160. Notion story: https://app.notion.com/p/3ee607bff0d281b7acf7cedaa984bb17. Spec folder and branch: 391-audit-history-api."

**Sources**: Notion story ST-391 (https://app.notion.com/p/3ee607bff0d281b7acf7cedaa984bb17), read 2026-10-04 with discussions (none); its Build brief wins over the criteria above it. Epic EP-1 Foundations Build plan, slice 9 and "Early starts and late items" (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707): the API is built in this epic; the admin view waits for ST-160 (EP-2) and the garage view for ST-97 (EP-5). Security page, "Capabilities by role" row "Audit history" (https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3). Depends on ST-390 (the entries, merged) and ST-79 (roles and policy, merged).

## Clarifications

### Session 2026-10-04

- Q: Do the garage view and the admin view share one endpoint, and how does a garage role's `garageId` behave? → A: One endpoint. A garage role always reads its own garage; passing its own id is allowed, any other id answers 404. An admin reads everything and may narrow by `garageId`.
- Q: Is the default period of the last 7 days applied by the API or by the view? → A: By the API, when `from` is absent, so the total and the pages mean the same thing for every caller; `to` has no default. Any period can be asked for with `from`.
- Q: Does the API format money, times and state labels? → A: No. It returns stored values (money in bani, times as UTC ISO strings); the view formats them in the reader's language with the locale formats library. Formatting is part of the late view work.
- Q: How are phone and plate values masked while the acceptance and job rules cannot be checked yet (no quotes or jobs exist)? → A: Conservatively: for the owner, the receptionist and the mechanic, a value under a field or key named `phone` or `plate` is replaced by a mask; the admin sees them. The relaxation (owner and receptionist after acceptance, mechanic on own jobs) is recorded as a late item for the quotes and jobs stories.
- Q: What does "admin actions" mean as a filter area, given every other area is a group of subjects? → A: Entries whose actor role is `admin`.
- Q: (spec-challenger) When is a cursor valid, and with which code is a bad one refused? → A: When it is an existing entry inside the caller's scope (own garage for staff, any entry for the admin) that also matches the current filters; otherwise 400 `invalid_cursor`. Paging continues from that entry's time and id. (Revised in review: a cursor outside the filters cannot mark a position in the filtered list, and the database paging would drop an entry; the view starts again from the first page when the filters change.)
- Q: (spec-challenger) Exact key or substring for the mask, and is `text` masked? → A: Exact key `phone` or `plate`, case-insensitive, through objects and arrays of the old and new values; `text` is not masked.
- Q: (spec-challenger) Does the start-after-end check apply to the default start? → A: No, only to a `from` and a `to` both given; a default start after `to` gives an empty page.
- Q: (spec-challenger) Are date-only values accepted? → A: No: `from` and `to` are full date-times with a zone (`Z` or an offset); a date alone answers 400. The view turns local days into instants.
- Q: (spec-challenger) Which role vocabulary does an entry's actor carry? → A: The stored one: `driver`, `owner`, `receptionist`, `mechanic`, `admin`, `system`; a system entry has no actor id.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Garage staff read their own garage's history (Priority: P1)

The owner, a receptionist or a mechanic of a garage asks for the audit history and gets their garage's entries, newest first, 20 at a time, each saying who changed what, when, and from what to what. They never get another garage's entries.

**Why this priority**: it is the story's main right [27]; the garage view (ST-97) reads it.

**Independent Test**: seed two garages with entries; call the API as each staff role of the first garage and of the second.

**Acceptance Scenarios**:

1. **Given** owner Ion of Service Auto Nord, **When** he asks for the history, **Then** he gets his garage's entries newest first, 20 per page, with a cursor to the next page and the total.
2. **Given** mechanic Elena of the same garage (no permissions ticked), **When** she asks, **Then** she gets the same garage's entries.
3. **Given** a receptionist of the same garage, **When** they ask, **Then** they get the same garage's entries.
4. **Given** the owner of another garage, **When** they ask with Service Auto Nord's id, **Then** the API answers 404.
5. **Given** an entry for an internal note, **When** garage staff read the history, **Then** it is included.
6. **Given** an entry made through an AI assistant, **When** it is returned, **Then** it carries `viaAssistant: true`, with the actor's first name and role, so the view can show "Ion, proprietar · prin asistentul AI".

---

### User Story 2 - The admin reads all of it, with filters (Priority: P1)

A MotorFix admin reads every garage's entries and the platform's own entries (those without a garage), and narrows them by garage, person, area, job and dates.

**Why this priority**: the admin view (ST-160) and the EP-1 demo ("open the audit history as the admin and find the sign-up and the invitation") read it.

**Independent Test**: seed entries across garages, without a garage, by different actors and areas and times; call with each filter.

**Acceptance Scenarios**:

1. **Given** a MotorFix admin, **When** they ask without filters, **Then** they get entries of every garage and entries without a garage.
2. **Given** the admin filters by garage, person, area or dates, **When** applied, **Then** only matching entries return, and filters combine.
3. **Given** filters for the last 7 days and the area "prices", **When** applied, **Then** only price-list entries of those days return.
4. **Given** no entries match, **When** asked, **Then** the answer is an empty list with total 0 and no next cursor.

---

### User Story 3 - Nobody else reads it (Priority: P1)

Anyone without the right gets 404, never 403 and never an empty list; someone not signed in gets 401.

**Why this priority**: what an actor may not reach does not exist for them (ST-79's policy, A31).

**Independent Test**: call as a driver, as a garage role without a garage, and without a token.

**Acceptance Scenarios**:

1. **Given** a driver, **When** they ask for the audit history, **Then** 404 (their short version is ST-407).
2. **Given** no token, **When** asked, **Then** 401 `sign_in_required`.

---

### Edge Cases

- Several entries with the same time keep a stable order by entry id, and paging with a fixed `from` neither skips nor repeats one of them (the default start moves with the clock, so a view pins `from` while it pages).
- A cursor that is not an entry inside the caller's scope and the current filters answers 400 `invalid_cursor`, the same for an id of another garage, an id that does not exist, and an entry the new filters leave out.
- `from` after `to`, an unknown area, an unknown parameter, a malformed id or date answers 400 `validation_failed`.
- An entry whose old or new value is an object holding a `phone` or `plate` key is masked inside the object for garage staff.
- An entry whose actor account was deleted still shows with the name it was written with.
- An id written in capitals is the same id: a staff member naming their own garage in capitals reads it, another garage's id in capitals still answers 404.
- An account holding both driver and garage roles reads as the role in use: as driver it gets 404.
- Reading the history writes no audit entry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST serve `GET /api/v1/audit-history` to signed-in callers; without a valid token it answers 401 `sign_in_required`.
- **FR-002**: The capabilities table MUST grant `garage.audit_history` to the garage owner, the receptionist and the mechanic (whatever their permissions), and `admin.audit_history` to the admin; no other role holds either, and `/me` lists them.
- **FR-003**: For the owner, a receptionist or a mechanic, the system MUST return only entries whose garage id is the caller's own garage; entries of another garage or without a garage are never returned.
- **FR-004**: For the admin, the system MUST return entries of every garage and entries without a garage.
- **FR-005**: A caller without either capability (a driver), or a garage role with no garage, MUST get 404; a garage role passing a `garageId` that is not its own MUST get 404.
- **FR-006**: The system MUST filter by `garageId`, `actorId`, `jobId`, `area`, `from` and `to` (both inclusive, ISO 8601 date-times with a zone), combined with AND.
- **FR-007**: When `from` is absent, the system MUST use 7 days before the time of the call; `to` has no default.
- **FR-008**: The `area` filter MUST be one of `requests`, `quotes`, `bookings`, `jobs`, `prices`, `repair_history`, `photos`, `garage_profile`, `team`, `settings`, `admin_actions`, each matching a fixed set of subject types (Data model table names), and `admin_actions` matching entries made by an admin.
- **FR-009**: The system MUST order entries newest first, equal times by entry id (descending), and return 20 per page with `nextCursor` (null on the last page) and `total`, the number of entries matching the filters.
- **FR-010**: A `cursor` MUST be the id of the last entry of the previous page; one that is not an existing entry inside the caller's scope and matching the current filters MUST answer 400 `invalid_cursor`.
- **FR-011**: Each entry MUST carry id, time (UTC), action, subject type and id, field, old and new value as stored, the actor (id, first name, stored role), `viaAssistant`, garage, car and job ids, `internal`, kind and text; absent values are null.
- **FR-012**: Internal entries MUST be returned to garage staff and the admin.
- **FR-013**: For the owner, the receptionist and the mechanic, a non-null value of a field named `phone` or `plate`, and the value of any `phone` or `plate` key inside an object or array value (names compared without case), MUST be returned masked; `text` is not masked; the admin gets them as stored.
- **FR-014**: Invalid parameters (unknown name, malformed id, a date without time or zone, unknown area, a given `from` after a given `to`) MUST answer 400 `validation_failed`.
- **FR-015**: Reading the history MUST NOT write an audit entry, and the endpoint offers no way to change an entry.
- **FR-016**: The OpenAPI document MUST describe the endpoint, its parameters and its answer, and the generated Angular client MUST include it.

### Key Entities

- **Audit entry (ACTIVITY_LOG)**: written by ST-390; read here, never changed.
- **Audit history page**: `{ items, nextCursor, total }`.

## Spec Delta

### Capability: `audit`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario of User Stories 1–3 and every Edge Case has a passing test against real PostgreSQL.
- **SC-002**: Every role × capability "may not" (driver, garage role without a garage, another garage's id, no token) has a test that gets 404 or 401, never data.
- **SC-003**: Paging through a garage's history with a fixed `from` returns every entry exactly once, including entries with equal times.
- **SC-004**: The generated client compiles with the new operation.

## Assumptions

- (autonomous default) The area → subject types table uses Data model table names in lower snake case, as ST-390 does: requests `quote_request`, `request_recipient`, `message`; quotes `quote`, `quote_job`; bookings `booking`, `booking_move`, `booking_segment`, `time_block`; jobs `job`, `job_stage_entry`, `job_step`, `job_part`, `odometer_reading`; prices `garage_price`, `garage_brand_job`; repair history `repair`, `car_transfer`, `car_transfer_repair`; photos `media_item`, `garage_photo`, `message_photo`; garage profile `garage`, `garage_brand`, `garage_facility`, `garage_closed_day`; team `garage_member`, `mechanic`, `staff_invite`, `mechanic_day_off`; settings `garage_feature`, `notification_preference`, `dashboard_layout`. The owning stories add a subject type here if they write a new one.
- (autonomous default) The page size is fixed at 20 (Build brief scenario 1); no `limit` parameter.
- (autonomous default) A mask is the string `•••`.
- (autonomous default) The AI assistant reads "as the user" through the same use case once EP-16 gives it an actor context; nothing assistant-specific is built here.
- (autonomous default) A suspended account gets 403 `account_suspended` from the existing guard, before any right is checked.
- Late part (not built here): the views "Istoric modificări" in the admin dashboard (ST-160, EP-2) and the garage dashboard (ST-97, EP-5) with their formatting (lei, Europe/Bucharest, labels), 120-character cut, empty and error states, filters in the address, and the Playwright flow; the receptionist's access through a real invite (EP-9); relaxing the phone and plate mask with the acceptance and own-job rules (quotes and jobs stories); a "platform" area or a "no garage" filter for the admin view, if ST-160 needs one (unfiltered is enough for the EP-1 demo).

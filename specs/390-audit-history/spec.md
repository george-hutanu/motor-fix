# Feature Specification: Audit history writer

**Feature Branch**: `390-audit-history`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-390 — Record every change in the audit history: the audit history writer every module uses inside its own transaction, implementing the AuditPort interface ST-79 introduced (currently a no-op) in libs/domain, with its own Prisma schema file for the audit module. Notion story: https://app.notion.com/p/3ee607bff0d28146adece5076470024d. Spec folder and branch: 390-audit-history."

**Sources**: Notion story ST-390 (https://app.notion.com/p/3ee607bff0d28146adece5076470024d), read 2026-10-04 with discussions (none open); its Build brief wins over the criteria above it. Epic EP-1 Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Depends on ST-79 (accounts and roles, https://app.notion.com/p/3ee607bff0d281778692cbdd267fb72f), whose `AuditPort` this story implements. The views over the history (ST-391 and the driver's short version) are later stories.

## Clarifications

### Session 2026-10-04

- Q: How does the coverage test find a write use case without an audit entry? → A: A static read of the domain library's `*.service.ts` classes: a method that calls a Prisma write (create, createMany, update, updateMany, upsert, delete, deleteMany, raw execute) and does not call the audit writer fails the test, named `File#method`. The audit writer is the only exemption.
- Q: Does the writer diff an update itself, and does "a create is one entry" bind ST-79's per-role entries? → A: Two methods: `record` for one entry (create, delete, open, or a single field) and a field-by-field helper that compares before and after by content and writes one `update` entry per changed field. ST-79's per-role create entries stay; FR-004 is the default for a whole-subject create or delete.
- Q: How is the first name derived, and does a caller-supplied name follow the same rule? → A: Trim, take the text before the first whitespace; the same rule for a caller's name and a looked-up one; empty when there is no name; `system` is always "MotorFix".
- Q: Who decides `is_key_change`, and which rows ship now? → A: The writer alone, from `subject_type.field`, with no caller override. Shipped: `quote.from_bani`, `quote.to_bani`, `job.final_price_bani`, `job.status`, `job.eta_at`, `booking.starts_at` (a move changes it), `booking.mechanic_id`. Cancellation has no column name in the Data model; the booking story adds its row when it names it.
- Q: Is FR-015 indexes only, and what orders entries written in one transaction? → A: Indexes only (ST-391 owns the reads). `at` is the database clock at the moment of the insert, not the transaction start, so entries of one change are ordered by the order they were written.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every change is written with its entry, in the same transaction (Priority: P1)

A module that changes something calls one writer inside its own database transaction. The writer stores who changed what, when, the old value and the new value. An update becomes one entry per changed field; a create is one entry holding the new values; a delete is one entry holding the old values. If the change rolls back, its entries roll back with it; if writing an entry fails, the change fails.

**Why this priority**: every later write use case (requests, quotes, bookings, jobs, prices, repair history, photos, the garage profile, the team, settings, admin actions) calls this writer; nothing can be traced until it exists.

**Independent Test**: inside one transaction, change a record and call the writer; read the history back. Repeat with a transaction that throws after the call and find no entry.

**Acceptance Scenarios**:

1. **Given** owner Ion changes the oil-change range from 1.200–1.500 lei to 1.300–1.600 lei, **When** the price list saves, **Then** two entries are written in the same transaction: subject `garage_price`, field `from_bani`, 120000 → 130000; subject `garage_price`, field `to_bani`, 150000 → 160000; each with actor Ion, role `owner`, and the garage id.
2. **Given** the save's transaction rolls back, **When** it fails, **Then** no audit entry exists.
3. **Given** a driver deletes a repair they added, **When** the deletion saves, **Then** one entry with action `delete` keeps the repair as it was (old value), with the car id.
4. **Given** writing the entry fails, **When** the change saves, **Then** the change is not saved either.
5. **Given** ST-79's account use cases (create an account, grant a role), **When** they run with the application's wiring, **Then** their entries are stored in the history instead of being dropped.

---

### User Story 2 - The actor, the scope and the flags are on every entry (Priority: P1)

Each entry names the actor as others see them (person, role, first name), says whether the change came through an AI assistant, and carries the scope ids (garage, car, job) the views filter on. Key changes and internal notes are marked.

**Why this priority**: the views (ST-391, the driver's short version) filter and label by these fields; without them the history cannot be shown to the right people.

**Independent Test**: write entries for each actor kind and each flag through the writer and read the stored columns.

**Acceptance Scenarios**:

1. **Given** a garage owner, through an AI assistant, changes a quote, **When** it saves, **Then** the entry has `via_assistant` = true and the `assistant_grant_id`.
2. **Given** the worker expires a request on day 7, **When** it saves, **Then** the entry's actor role is `system` and its name is "MotorFix".
3. **Given** a job moves from `in_work` to `done`, **When** it saves, **Then** the entry has the job id, the car id and the garage id, and `is_key_change` = true.
4. **Given** a mechanic adds an internal note to a job, **When** it saves, **Then** the entry has `internal` = true.
5. **Given** a MotorFix admin opens a driver's private logged repair, **When** it opens, **Then** an entry with action `open` is written.
6. **Given** the garage corrects a job's final price from 1.450 lei to 1.380 lei 20 hours after handover, **When** it saves, **Then** an entry is written with field `final_price_bani`, 145000 → 138000, the job id and `is_key_change` = true.
7. **Given** an actor who is a person, **When** the entry is written, **Then** its actor name is that person's first name (for example "Elena"), also for a mechanic hidden from customers.

---

### User Story 3 - Nobody can rewrite the history, and no write use case can skip it (Priority: P2)

The history is append-only: the database refuses an update or a delete of an entry. A write use case that does not call the writer fails a test in CI.

**Why this priority**: an audit trail that can be edited, or that a new module can forget, is not one.

**Independent Test**: try to update, delete and truncate an entry as the application's database user; run the coverage test against a write use case without an audit call.

**Acceptance Scenarios**:

1. **Given** the application's database user, **When** it tries to update or delete an entry, **Then** the database refuses.
2. **Given** a new write use case without an audit entry, **When** CI runs, **Then** a test fails.

---

### Edge Cases

- An update in which no field changed writes no entry.
- A field whose value is equal by content but a different object (same JSON) is unchanged.
- Values that are not plain JSON (dates) are stored as JSON, dates as UTC ISO strings; money stays in bani as integers.
- An actor id whose account does not exist (deleted later, or never stored): the entry is still written, with the name given by the caller or empty; the history never depends on the account row existing.
- An account is deleted later: its entries stay, with the name they were written with.
- Role `garage` from the account model is recorded as `owner`, the name the history uses.
- An `open` entry has no old or new value.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide one writer that every module calls inside its own database transaction; the entry is written through that transaction, so an entry exists only if its change commits, and a failed entry write fails the change.
- **FR-002**: Each entry MUST store: the action (`create`, `update`, `delete`, `open`), subject type, subject id, field (when one field), old value and new value as JSON, the actor id, actor role, actor name, and the time it was written (UTC).
- **FR-003**: The system MUST turn an update into one entry per changed field, comparing values by content; unchanged fields write nothing.
- **FR-004**: A whole-subject create MUST be one entry holding the new values, and a delete one entry holding the old values (a caller may instead record single fields, as ST-79's role entries do).
- **FR-005**: The actor role MUST be one of `driver`, `owner`, `receptionist`, `mechanic`, `admin`, `system`; the account model's `garage` role is stored as `owner`.
- **FR-006**: The actor name MUST be the name shown to others: for a person, their first name (the trimmed text before the first whitespace, whether the caller gave the name or the writer looked it up); for `system`, always "MotorFix". When the caller gives no name, the writer takes it from the account inside the same transaction; no account and no name gives an empty name.
- **FR-007**: An entry made through an AI assistant MUST store `via_assistant` = true and the assistant grant id.
- **FR-008**: Each entry MUST carry the scope ids it belongs to: garage id, car id and job id, each optional.
- **FR-009**: Each entry MUST carry `is_key_change` and `internal` flags. `internal` is given by the caller. `is_key_change` is decided by the writer alone, from `subject_type.field`: `quote.from_bani`, `quote.to_bani` (a quote's range), `job.final_price_bani` (the final price and its correction), `booking.starts_at` (the start, and a move), `job.eta_at` (the estimated finish), `job.status` (the stage), `booking.mechanic_id` (a change of mechanic). A cancellation is added when its column is named.
- **FR-010**: Each entry MAY carry a kind and a text (an optional reason or note); display text is not stored.
- **FR-011**: The history MUST be append-only: the database refuses any update, delete or truncate of an entry, whoever asks.
- **FR-012**: The history MUST be stored apart from the System status log; this writer never writes technical events or errors.
- **FR-013**: The account model's use cases (ST-79) MUST write through this writer in the running application, replacing the no-op.
- **FR-014**: A test MUST fail, naming the use case as `File#method`, when a method of a domain library service class writes through Prisma and does not call the writer; the writer itself is the only exemption.
- **FR-015**: The history MUST be indexed by garage, car, job and actor, each with the time (no read API in this story). The time is the database clock at the insert, so entries of one change keep the order they were written.

### Key Entities

- **Audit entry (ACTIVITY_LOG)**: one recorded change or sensitive read. Action, subject type and id, field, old and new value, actor id, role and name, via assistant and grant id, garage, car and job ids, key change and internal flags, kind, text, time. Written once, never changed. Not linked to the account by a foreign key, so it survives the account.

## Spec Delta

### Capability: `audit`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario of the Build brief that can be exercised without the later modules (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11) is covered by a passing test against a real PostgreSQL database.
- **SC-002**: A change whose transaction rolls back leaves zero entries, in 100% of the tested cases.
- **SC-003**: An update, delete or truncate of an entry is refused by the database in 100% of the tested attempts.
- **SC-004**: Adding a write use case without an audit call makes the test suite fail, with the use case named in the failure.
- **SC-005**: The migration applies cleanly to a fresh database after the existing account migration.

## Assumptions

- (autonomous default) Subject and field names follow the Data model's column names in lower snake case (`garage_price`, `from_bani`, `job`, `status`, `final_price_bani`); the modules that own those subjects are later stories and use these names.
- (autonomous default) Append-only is enforced by database triggers on the table rather than by grants: the application's database user is set per environment and is the table owner locally, so a trigger is the only refusal that holds for every user. Grants (insert and select only) can be tightened on top when the environments get a separate migration user. Shared database grants are not changed by this story.
- (autonomous default) Account deletion keeps names and values in the entries for the retention period (no anonymisation). The lawyer's question on anonymisation and retention length stays open; nothing is purged by this story.
- (autonomous default) The AI assistant marker is the presence of an assistant grant id given by the caller; the assistant grants themselves arrive with EP-16.
- (autonomous default) The coverage test finds write use cases by reading the domain library's service classes (any method that writes through Prisma) instead of a decorator, so nothing has to be marked by hand; the audit writer itself is the only exception.
- (autonomous default) The Data model's extra `request_id` and `assistant_tool` columns are not built: ST-390's newer Data list omits them. `kind` and `text` are optional text columns.
- (autonomous default) ST-79's create-account entries (one per role, field `role`) are kept as ST-79 specified them.
- No screens, no API endpoint and no events in this story (Build brief: Screens none, Emits none).

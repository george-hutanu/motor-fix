# Feature Specification: Store each file's checks and their results

**Feature Branch**: `300-verification-checks`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "ST-300 Store each file's checks and their results"

**Story**: ST-300, EP-2 — https://www.notion.so/3ee607bff0d281eb88ffff1135141301 (Build brief of 2026-10-03 wins over the story's earlier text; the only source of scope).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The checks exist as soon as a file is sent (Priority: P1)

When a garage sends its verification file, the file carries one check per kind — company, caen, rar, activities, representative, address, photos, documents — all not yet run, all manual. When the garage sends the same file again after a request for more, the checks already recorded keep their results and nothing is duplicated.

**Why this priority**: Every other story of the feature (the queue, the file drawer, the three record forms) reads these rows; without them nothing can be recorded or shown.

**Independent Test**: Send a file and count its checks; resend it and count again.

**Acceptance Scenarios**:

1. **Given** a garage with no file, **When** it sends its file, **Then** the file has exactly 8 checks, one per kind, each with result `not_run` and `automatic = false`.
2. **Given** a file on which `rar` was recorded `ok` and then more was requested, **When** the garage sends it again, **Then** the file still has 8 checks, `rar` still reads `ok` with its detail, and no duplicate exists.
3. **Given** the file's checks are created, **When** the audit history is read, **Then** there is no entry per check: the submission's entry covers them.

---

### User Story 2 - An admin records a result (Priority: P1)

A MotorFix admin records the result of one check on a file: the result, a detail line, and for the activities check also the list of activities the RAR authorisation covers. The file remembers who recorded it and when, the audit history keeps the old and new values, and the queue is told.

**Why this priority**: The record call is the one thing the three check-form stories call; it is the feature's write path.

**Independent Test**: Record `rar = ok` on a submitted file and read the check, the audit history and the outbox.

**Acceptance Scenarios**:

1. **Given** a submitted file, **When** an admin records `rar = ok` with the detail "Autorizație găsită în registru, aceeași firmă și adresă", **Then** the `rar` check has that result and detail, the admin as `recorded_by`, a `recorded_at` time, an audit entry with the old result `not_run` and the new result `ok`, and a `verification.check_recorded` event (fileId, kind, result) is in the outbox, all saved together or not at all.
2. **Given** a submitted file, **When** an admin records `activities = ok` with the codes `mechanics` and `brakes`, **Then** the garage's `rar_activities` reads `[mechanics, brakes]` in the same save as the check.
3. **Given** two admins record the same check, **When** the second save lands, **Then** it wins, and both saves are in the audit history.
4. **Given** a file that is approved, rejected or has more requested, **When** a record call arrives, **Then** it is refused with 409 "Dosarul e deja decis"; **Given** the same file reopened into review, **Then** the call is accepted.
5. **Given** a signed-in user who is not an admin, **When** they call the record route, **Then** they get 404.

---

### User Story 3 - The queue shows one line and a lamp per check (Priority: P2)

The queue line and the file drawer show each check as a green, amber, red or grey lamp, and the queue shows one short summary of the file's checks.

**Why this priority**: Read-only derivations of the rows; the screens that show them are other stories.

**Independent Test**: Record results and ask for the summary and the lamps.

**Acceptance Scenarios**:

1. **Given** `company = ok` and `rar = ok`, the rest `not_run`, **When** the summary is asked for, **Then** it reads "CUI și autorizație RAR verificate".
2. **Given** `rar = failed`, **When** the summary is asked for, **Then** it reads "Lipsește autorizația RAR".
3. **Given** `company = ok` and `photos = warning` with the detail "neclare", **When** the summary is asked for, **Then** it reads "CUI verificat · fotografii neclare".
4. **Given** nothing recorded, **When** the summary is asked for, **Then** it reads "Neverificat".
5. **Given** any check, **When** its lamp is asked for, **Then** `ok` is green, `warning` amber, `failed` red and `not_run` grey.

---

### Edge Cases

- A record call for a kind not in the list of 8 is refused with 422.
- A `warning` or `failed` without a detail, or any detail over 200 characters, is refused with 400 `validation_failed`.
- An activities list with a code not in the RAR activity catalogue is refused with 400 `validation_failed`.
- A record on a file that does not exist answers 404, like a non-admin's call.
- A file is resent while a check is `failed`: the row keeps `failed`; the admin re-checks what changed.
- Two problems of the same severity: `rar` names the summary's second part before any other kind; otherwise the first kind in the list order (company, caen, rar, activities, representative, address, photos, documents).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On a file's submission and on its resend after more was requested, the system MUST ensure the file has exactly one check per kind — company, caen, rar, activities, representative, address, photos, documents — created with result `not_run`, `automatic = false` and no detail, in the same transaction as the submission; a check that already exists is kept with its result.
- **FR-002**: A check MUST store its file, kind, whether it is automatic, result (`not_run`, `ok`, `warning`, `failed`), detail line, evidence (free-form, optional), who recorded it and when.
- **FR-003**: An admin MUST be able to record one check of a file by kind with a result and a detail; the save sets `recorded_by` and `recorded_at`, and the last save wins.
- **FR-004**: Recording the `activities` kind MUST also take the list of RAR activity codes on the garage's authorisation, validate each against the RAR activity catalogue, and store the list on the garage (`rar_activities`) in the same transaction as the check.
- **FR-005**: The RAR activity catalogue MUST exist with a code and a Romanian and English name per activity, seeded with mechanics, brakes, steering, suspension and air-con.
- **FR-006**: Every record MUST write one audit history entry carrying the old and new result and detail, in the same transaction; creating the rows at submission writes no entry of its own.
- **FR-007**: Every record MUST emit `verification.check_recorded` with fileId, kind and result through the outbox, in the same transaction, to the admin channel.
- **FR-008**: The system MUST map a result to a lamp colour: `ok` green, `warning` amber, `failed` red, `not_run` grey.
- **FR-009**: The system MUST build a summary line of at most two parts joined with " · ": the first names the register checks that are `ok` ("CUI", "autorizație RAR", joined with "și" and followed by "verificat"/"verificate"); the second names the most serious problem — `failed` before `warning`, `rar` before any other kind — as the kind's name and its detail, with `rar = failed` reading "Lipsește autorizația RAR"; with nothing recorded it reads "Neverificat". The record call returns the file's new summary.
- **FR-010**: A record MUST be refused with 422 for an unknown kind; 400 `validation_failed` for a missing detail on `warning` or `failed`, a detail over 200 characters, or an unknown activity code; 409 "Dosarul e deja decis" when the file is approved, rejected or has more requested, unless it was reopened into review.
- **FR-011**: Only a MotorFix admin may record a check; anyone else gets 404, as on the other admin routes.

### Key Entities

- **Verification check**: one row per (file, kind); result, detail, evidence, automatic flag, recorded_by, recorded_at. Unique on (file, kind).
- **RAR activity**: catalogue row — code, name_ro, name_en.
- **Garage.rar_activities**: the list of catalogue codes the garage's RAR authorisation covers, written by the activities check.
- **Verification file** (existing): owns the checks; "decided" means approved, rejected or more_requested; a reopened file is in review again.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any submission or resend, every file has exactly 8 checks, never more.
- **SC-002**: Every recorded result is readable with who recorded it and when, and its audit entry and outbox event are never present without the check's new value, nor the value without them.
- **SC-003**: Each of the four summary examples in the Build brief yields its exact text.
- **SC-004**: A non-admin cannot tell the record route exists (404), and a decided file refuses every record (409).

## Assumptions

- The 8 rows are created inside the submission's and the resend's own transaction rather than by a consumer of `verification.submitted`: the same outcome with no new queue, and the rows exist when the event is relayed (Principle VI). *(autonomous default)*
- Idempotency is a unique (file, kind) constraint; a resend keeps existing rows and their results. *(autonomous default)*
- The documents part of the summary ("Lipsește autorizația RAR" for a missing `rar_authorisation` document) needs a legal-document table that no story has built; only a `failed` rar check yields that text now. Deferred, to be recorded in `deferred.md`. *(autonomous default)*
- `verification.check_recorded` reaches the admin channel only (the `platform` audience); a per-file live channel `verification-file:{fileId}` belongs to the file story. *(autonomous default)*
- The summary is returned by the record call and computed by one function the queue story reuses; there is no separate summary endpoint. *(autonomous default)*
- Errors: detail over 200 characters or missing for `warning`/`failed` → 400 `validation_failed`; unknown kind → 422; decided file → 409 "Dosarul e deja decis"; unknown activity code → 400 `validation_failed`. *(autonomous default)*
- The RAR activity catalogue is seeded with codes `mechanics`, `brakes`, `steering`, `suspension`, `air_con` with Romanian and English names, until the lawyer confirms the list. *(autonomous default)*
- Route: `PUT /api/v1/admin/verification-files/:id/checks/:kind`, guarded like the other admin routes (`admin.garages`). *(autonomous default)*
- The kind names in the summary's second part are the Romanian names used by the Build brief's examples ("fotografii" for photos); the other kinds follow the same pattern and are fixed in the plan. *(autonomous default)*
- No screens of its own; the lamps and summary are shown by the queue and file stories. The unit and end-to-end suites of those stories cover the UI.
- Depends on the existing verification file service (submit, resend, decide, reopen), the outbox and the audit writer, all already in the code.

---
capability: garage-verification
updated: 2026-10-09
features:
  - 207-garage-approval-flow
  - 300-verification-checks
  - 307-public-garage-profile
  - 312-report-garage
  - 206-documents-declaration
---

# Capability: Garage verification

How MotorFix keeps a garage hidden from drivers until an admin approves it: the verification file and its allowed transitions, the garage's status, the one public scope every public read of garages goes through, the status label shown to the garage, and the test-only switch that approves at once.

## Requirements

### 207-FR-001 — The system MUST store a verification file per submission with garage, status (`submitted`, `in_review`, `approved`, `more_requested`, `rejected`), `opened_by`, `opened_at`, `decided_by`, `decided_at`, `reopened_by`, `reopened_at`, `previous_file_id` (the rejected file a re-submission follows), reason code and note of the last `more_requested` or `rejected` decision, and creation time; every timestamp is stored in UTC. A garage's status MUST be one of `draft`, `approved`, `suspended`, with `approved_at` set at each approval.

_From 207-garage-approval-flow._

### 207-FR-002 — The system MUST allow exactly these file transitions and refuse every other with 409 `verification_transition_refused`, whose detail names the current status and who set it ("already decided by {first name}"): `submitted` → `in_review` (an admin opens; sets `opened_by`, `opened_at`; an open of a file already `in_review` is not a transition: it succeeds unchanged, writes no history and no outbox row, and returns the current `opened_by` and `opened_at`); `submitted` or `in_review` → `approved`, `more_requested` or `rejected` (an admin decides; sets `decided_by`, `decided_at`, and the reason code and note, required for `more_requested` and `rejected`); `more_requested` → `submitted` (the garage sends again); `approved`, `rejected` or `more_requested` → `in_review` (an admin reopens the garage's newest file only; an older file, or any file while another file of the garage is `submitted`, `in_review` or `approved`, is refused with the same 409, so the one-live-file rule of FR-004 holds; sets `reopened_by`, `reopened_at`). Two concurrent transitions on one file MUST end with exactly one committed.

_From 207-garage-approval-flow._

### 207-FR-003 — The garage's status MUST move `draft` → `approved` only through a file approval, in the same transaction; an approval of a reopened file keeps `approved` and resets `approved_at`; no other transition of this story changes the garage's status (`approved` ↔ `suspended` belongs to MF-59). A rejection, a "more requested" or a reopening of an approved garage's file MUST leave the garage `approved`.

_From 207-garage-approval-flow._

### 207-FR-004 — Submitting MUST create a file `submitted` for a garage that has no `submitted`, `in_review` or `approved` file; when the garage's newest file is `rejected`, the new file's `previous_file_id` MUST point to it; when it is `submitted`, `in_review`, `more_requested` (the garage re-sends that file instead) or `approved` (a change goes through the change-flow stories), submitting MUST be refused with 409. This story exposes the submit transition for the submission story to call; it ships no submit endpoint.

_From 207-garage-approval-flow._

### 307-FR-001 — `GET /api/v1/garages/{slug}` MUST keep answering only through the one public scope: 200 for an `approved` garage, 404 `not_found` with no garage data for a `draft`, waiting or unknown slug, to everyone including the garage's own staff, and 410 `gone` with no garage data for a `suspended` garage (modifies 207-FR-005: the profile is now served from its cache, 307-FR-006).

_From 307-public-garage-profile._

### 207-FR-006 — The status shown to the garage MUST be derived, never stored, as one of: Ciornă (draft) when the garage is `draft` and has no file; Trimis (sent) when the newest file is `submitted`; În verificare (under review) when it is `in_review`; Cerute completări (more details requested) when it is `more_requested`; Respins (rejected), with the reason code and note, when it is `rejected`; Aprobat, pe hartă (approved, on the map) when the garage is `approved`, whatever its newest file; Suspendat (suspended) when the garage is `suspended`. The seven labels MUST exist in Romanian and English in the shared status labels, in the forms the mock uses: "Trimis", "În verificare", "Cerute completări", "Respins", "Aprobat, pe hartă" and, for the unpublished states, the suffix "· nepublicat" (English "· not published").

_From 207-garage-approval-flow._

### 207-FR-007 — The system MUST expose the list of fields whose change needs a new approval: `cui`, `address` or `seat_address` (a mobile mechanic's registered seat stands in for the workshop address), `business_kind`, and the kinds of work (the job types offered). A change of any of them on an approved garage MUST NOT change the garage's status or hide it: public reads keep showing the last approved values until an admin decides (the flow itself belongs to the change-flow stories, not to this one).

_From 207-garage-approval-flow._

### 207-FR-008 — Every transition MUST write, in its own transaction, one audit entry on subject `verification_file` (or `garage` for the garage's status) with actor, actor role, old and new status, and reason code and note when there is one, and one outbox row: `verification.submitted`, `verification.opened`, `verification.decided` (with the decision), `verification.reopened`, each carrying the garage id and file id and the audiences `admin`, `garage:{garageId}`; `verification.decided` on an approval also carries `public:garage:{garageId}` and `public:search:{brandId}` for each brand the garage serves (none until a brands story exists). A failed audit or outbox write MUST fail the transition.

_From 207-garage-approval-flow._

### 207-FR-009 — When `skip_manual_approval` is on (`SKIP_MANUAL_APPROVAL` read as `1` or `true`) and `APP_ENV` is `test`, submitting MUST approve the new file at once in the same transaction with actor `system` ("MotorFix"), writing the audit entries and outbox rows of both transitions; under any other `APP_ENV` (`development`, `staging`, `production`) the switch MUST be ignored and it MUST NOT be a required variable (A33).

_From 207-garage-approval-flow._

### 207-FR-010 — Nobody acts on the state machine directly: this story ships no endpoint beyond FR-005's public read. Each transition is a domain use case that takes the actor (id, role, first name) from server code, for the submitting (ST-116) and re-sending (ST-208), deciding (ST-302 to ST-305) and suspending (MF-59) stories to call; the opening, deciding and reopening use cases MUST refuse an actor whose role is not `admin` or `system` with 404, as the capabilities policy does.

_From 207-garage-approval-flow._

### 207-FR-011 — The DTOs of the public read and the shared status labels MUST live in the contracts library, the endpoint MUST be REST with OpenAPI, and the generated client MUST be regenerated.

_From 207-garage-approval-flow._

### 300-FR-001 — On a file's submission and on its resend after more was requested, the system MUST ensure the file has exactly one check per kind — company, caen, rar, activities, representative, address, photos, documents — created with result `not_run`, `automatic = false` and no detail, in the same transaction as the submission; a check that already exists is kept with its result.

_From 300-verification-checks._

### 300-FR-002 — A check MUST store its file, kind, whether it is automatic, result (`not_run`, `ok`, `warning`, `failed`), detail line, who recorded it and when; files sent before this change get their 8 checks when it is deployed.

_From 300-verification-checks._

### 300-FR-003 — An admin MUST be able to record one check of a file by kind with a result and a detail; the save sets `recorded_by` and `recorded_at`, replaces the stored detail with the one sent (none sent leaves it empty), and the last save wins; the audit entry's old values are those the save replaced, read under a row lock so two concurrent saves each record the other's value as old.

_From 300-verification-checks._

### 300-FR-004 — Recording the `activities` kind MUST also take the list of RAR activity codes on the garage's authorisation — required (possibly empty) when the result is `ok`, optional otherwise, an omitted list leaving the garage's list unchanged — validate each against the RAR activity catalogue, and store the list on the garage (`rar_activities`) in the same transaction as the check.

_From 300-verification-checks._

### 300-FR-005 — The RAR activity catalogue MUST exist with a code and a Romanian and English name per activity, seeded with mechanics, brakes, steering, suspension and air-con.

_From 300-verification-checks._

### 300-FR-006 — Every record MUST write one audit history entry carrying the old and new result and detail (and, for `activities`, the old and new list), in the same transaction; creating the rows at submission writes no entry of its own.

_From 300-verification-checks._

### 300-FR-007 — Every record MUST emit `verification.check_recorded` with fileId, kind and result through the outbox, in the same transaction, to the admin channel.

_From 300-verification-checks._

### 300-FR-008 — The system MUST map a result to a lamp colour: `ok` green, `warning` amber, `failed` red, `not_run` grey.

_From 300-verification-checks._

### 300-FR-009 — The system MUST build a summary line, in Romanian and English, of at most two parts joined with " · ": the first names the register checks that are `ok` — only `company` ("CUI") and `rar` ("autorizație RAR"): "CUI verificat", "Autorizație RAR verificată", "CUI și autorizație RAR verificate"; the second names the most serious problem — `failed` before `warning`, `rar` before any other kind, then the kinds' order — as `<kind name> <detail>`, with `rar = failed` reading "Lipsește autorizația RAR"; the line starts with a capital; with neither part it reads "Neverificat". The record call returns the file's new summary in both languages.

_From 300-verification-checks._

### 300-FR-010 — A record MUST be refused with 422 for an unknown kind; 400 `validation_failed` for a missing detail on `warning` or `failed`, a detail over 200 characters, an unknown activity code, or an activities list on any kind but `activities`; 409 "Dosarul e deja decis" when the file is approved, rejected or has more requested, unless it was reopened into review.

_From 300-verification-checks._

### 300-FR-011 — Only a MotorFix admin may record a check; anyone else gets 404, as on the other admin routes.

_From 300-verification-checks._

### 312-FR-005 — The system MUST expose `POST /api/v1/garages/{id}/reports` in the verification module, taking `{ text }` through a DTO in the contracts library validated at the edge (400 `validation_failed` outside 20–1,000 characters or when `text` is not a string), answering 201 with `{ id, createdAt }`; the OpenAPI document and the generated client MUST be regenerated.

_From 312-report-garage._

### 312-FR-006 — The endpoint MUST require a session (401 `sign_in_required` without one, as the app-wide guard answers) and MUST answer 404 with no garage data when: the actor does not hold the `driver` role; the account is staff of that garage, read by account id inside the request from both `garage_member` (owner, receptionist) and the mechanic card, whatever role the session holds (never from `actor.garageId`); or the garage is not `approved` (draft, waiting, suspended or unknown id). Trust is decided on the server, never from what the page shows.

_From 312-report-garage._

### 312-FR-007 — A report MUST be stored as a `garage_report` row with id, garage id, the verification file it attaches to, reporter id, the text as written, status `open` and the creation time in UTC; the text is never rendered as markup anywhere (escaped plain text for admins, as the review texts are) and never appears in any public answer (the public profile's allow-list test of 307-FR-005 stays unchanged).

_From 312-report-garage._

### 312-FR-008 — In the same transaction as the row, the system MUST take the garage's newest verification file and: when it is `approved`, reopen it through the existing reopen use case, extended with an optional `reason` that sets the column, the audit text and the event payload in one move, with the `system` actor ("MotorFix"), so it becomes `in_review` with `reopened_at` set, `reopened_by` naming no admin and a new `reopen_reason` column set to `garage_report`; when it is `submitted`, `in_review`, `more_requested` or `rejected`, attach the report to it with no transition. The garage's status, `approved_at`, its public profile and the status label shown to the garage MUST NOT change (207-FR-003, 207-FR-006); a refused reopening fails the whole request and stores nothing.

_From 312-report-garage._

### 312-FR-009 — The same reporter with an `open` report on the garage MUST be refused with 409 `garage_already_reported` and the detail "Ai raportat deja acest service."; the rule MUST hold under concurrent calls (one row at most per reporter and garage while `open`, enforced by the database).

_From 312-report-garage._

### 312-FR-010 — A reporter who already stored 5 reports in the 24 hours before the call, on any garages, MUST be refused with 429 `too_many_reports` and nothing stored; the count is read from PostgreSQL inside the request (Redis holds no copy of it, Principle VI).

_From 312-report-garage._

### 312-FR-011 — Every stored report MUST write, in the same transaction, one audit entry `create` on subject `garage_report` by the reporter (actor role `driver`, garage id set, the new values holding the row's fields); a reopening MUST write the entry the reopen use case already writes, with actor `system` (shown as "MotorFix") and the text `garage_report` as its reason; a failed audit write fails the report.

_From 312-report-garage._

### 312-FR-012 — Every stored report MUST write one outbox row `garage.reported` carrying `reportId`, `garageId` and `fileId` to the `admin` audience only; a reopening writes `verification.reopened` as 207-FR-008 defines, its payload carrying `reason: "garage_report"`. Both are written with the change, in its transaction; the garage's own channels receive nothing that names the report, the reporter or the text.

_From 312-report-garage._

### 312-FR-013 — When a report is the first `open` report attached to its file (whether or not it reopened it), the system MUST queue one ADMIN_GARAGE_REPORTED notification for every active admin account — e-mail and push, muteable, listed in the admin preferences' `admin` section (198-FR-005) — carrying the garage's name, the report's text as escaped plain text and a link to the admin dashboard, in Romanian and English, with an event id derived from the report so a retry never doubles it; a report attached to a file that already holds an `open` report queues none. A failure to queue it is logged and does not undo the report.

_From 312-report-garage._

### 312-FR-014 — Two concurrent reports on one approved garage MUST end with both rows stored, exactly one reopening and one alert; the reopening's refusal of a file that is no longer the newest or no longer `approved` is the existing 409 of 207-FR-002, turned into the whole request's failure.

_From 312-report-garage._

### 312-FR-015 — The admin overview's waiting count MUST include a file reopened by a report (it already counts `in_review` files and re-reads on `verification.reopened`); the "Raportat" marker and the report's text are shown by the queue (ST-301) and the file drawer (ST-302), which mark a file "Raportat" when it holds an `open` report (and read `reopen_reason` for why it was reopened) when they are built; this story adds no admin screen of its own.

_From 312-report-garage._

### 312-FR-016 — The new endpoint MUST be listed in `infra/observability/inventory.json` with the metric it feeds (reports created and refusals by code, in the API's metrics), its dashboard panel and its alert or the reason none is needed.

_From 312-report-garage._

### 206-FR-012 — This story MUST provide one domain operation the sending story (ST-116) calls inside its transaction with the draft's data, the new verification file and the actor: for each document present it creates one legal document row (file, kind, page keys in order, issue date when given, status `valid`), sets the file's `declared_at` and `declared_by_name` from the draft, writes one audit entry per row (action `create`, subject `legal_document`, the garage id) and one for the declaration (subject `verification_file`, field `declared_at`), and emits `document.uploaded` (documentId, garageId, kind) once per document through the outbox to the `admin` audience; a draft without the declaration is refused with a stable code and nothing is written; a missing document creates no row and is not an error (X20f); a failure fails the caller's transaction, and so does a second attach for the same file (one document per kind per file, FR-013). The files are not moved. Wiring this operation to the send button is ST-116.

_From 206-documents-declaration._

### 206-FR-013 — The system MUST store legal documents in a table with id, verification file, kind (text from FR-004's list, not an enum), page keys (ordered), issue date (nullable), status (`valid`), created at (the attach's time; no separate upload time); and the verification file MUST gain nullable `declared_at` and `declared_by_name`. A file's documents MUST be readable by kind so a missing kind can be shown as "lipsește" / "missing" by the admin's file story.

_From 206-documents-declaration._

### 206-FR-014 — `GET /api/v1/admin/verification-files/{id}/documents/{documentId}/pages/{n}/download-url` MUST answer a MotorFix admin an address signed for 5 minutes (422-FR-006, `DOWNLOAD_URL_MINUTES`), inline, for page `n` (a whole number from 1 to the number of pages the document holds) of that document, with a file name `<kind>-<n>.<ext>` and its expiry; a signed-in staff member (owner, receptionist, mechanic) of the file's garage MUST get 403 with a stable code; any other actor, an unknown file, document or page, MUST get 404 (no session: 401 `sign_in_required`, as every route); no address is issued on 403 or 404. Every issued address MUST write one audit entry with action `open`, subject `legal_document`, the document id, the page number, the actor and the garage id, in the same transaction as the read that resolved the document.

_From 206-documents-declaration._

## Retired

- `207-FR-005` — superseded by `307-FR-001` (2026-10-08)

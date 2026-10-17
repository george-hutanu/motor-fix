---
capability: garage-verification
updated: 2026-10-17
features:
  - 207-garage-approval-flow
  - 300-verification-checks
  - 307-public-garage-profile
  - 312-report-garage
  - 206-documents-declaration
  - 049-garage-suspension
  - 301-verification-queue
  - 066-suspended-garages
  - 302-garage-verification-file
  - 203-company-caen-check
---

# Capability: Garage verification

How MotorFix keeps a garage hidden from drivers until an admin approves it: the verification file and its allowed transitions, the garage's status, the one public scope every public read of garages goes through, the status label shown to the garage, and the test-only switch that approves at once.

## Requirements

### 207-FR-001 — The system MUST store a verification file per submission with garage, status (`submitted`, `in_review`, `approved`, `more_requested`, `rejected`), `opened_by`, `opened_at`, `decided_by`, `decided_at`, `reopened_by`, `reopened_at`, `previous_file_id` (the rejected file a re-submission follows), reason code and note of the last `more_requested` or `rejected` decision, and creation time; every timestamp is stored in UTC. A garage's status MUST be one of `draft`, `approved`, `suspended`, with `approved_at` set at each approval.

_From 207-garage-approval-flow._

### 302-FR-002 — The system MUST expose `POST /api/v1/admin/verification-files/{id}/open`, which runs the existing open use case (207-FR-002) for the signed-in admin and answers the same body as FR-001: a `submitted` file becomes `in_review` with `opened_by` and `opened_at`, one audit entry and one `verification.opened` outbox row in the same transaction; a file already `in_review` is answered unchanged with no entry and no row; every status other than `submitted` (`in_review`, decided, `more_requested`) is answered unchanged with no transition, no entry and no row, which changes the existing use case so it no longer refuses a decided file with 409 (modifies 207-FR-002), so the drawer opens read-only; an unknown id and every non-admin get 404.

_From 302-garage-verification-file._

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

### 203-FR-007 — Each of the two rows MUST offer a record form while the file is undecided: three buttons "OK" / "Atenție" / "Problemă" ("OK" / "Warning" / "Failure"), a detail field required for Atenție and Problemă (1 to 200 characters, hidden for OK since the server writes that detail), and a "Resetează" / "Clear" action that records `not_run` when the row has a result. The `company` form holds a "Denumirea firmei" / "Company name" field, required for OK. The `caen` form holds the ticks "4520 pe certificat" / "4520 on the certificate" (absent when the file holds no ONRC certificate), "4520 în ONRC" / "4520 in the ONRC record" and "la punctul de lucru" / "at the workshop address" with the garage's address shown beneath it, or "la sediul social" / "at the registered seat" with the seat address for a mobile mechanic; OK is refused in the form with the missing tick named before anything is sent, and the server's refusal (FR-003) is shown the same way when it arrives. Saving records the kind through the existing record call with the result, the detail and the evidence.

_From 203-company-caen-check._

### 300-FR-004 — Recording the `activities` kind MUST also take the list of RAR activity codes on the garage's authorisation — required (possibly empty) when the result is `ok`, optional otherwise, an omitted list leaving the garage's list unchanged — validate each against the RAR activity catalogue, and store the list on the garage (`rar_activities`) in the same transaction as the check.

_From 300-verification-checks._

### 300-FR-005 — The RAR activity catalogue MUST exist with a code and a Romanian and English name per activity, seeded with mechanics, brakes, steering, suspension and air-con.

_From 300-verification-checks._

### 203-FR-004 — Every `company` and `caen` record MUST keep what 300-FR-003, 300-FR-006, 300-FR-007, 300-FR-010 and 300-FR-011 already give the record call: `recorded_by` and `recorded_at` set, `automatic = false`, one audit entry whose old and new values now include the evidence, the `verification.check_recorded` event in the outbox in the same transaction, 409 "Dosarul e deja decis" on a decided file that was not reopened, and 404 for anyone but a MotorFix admin. This story adds no second write path.

_From 203-company-caen-check._

### 300-FR-007 — Every record MUST emit `verification.check_recorded` with fileId, kind and result through the outbox, in the same transaction, to the admin channel.

_From 300-verification-checks._

### 300-FR-008 — The system MUST map a result to a lamp colour: `ok` green, `warning` amber, `failed` red, `not_run` grey.

_From 300-verification-checks._

### 300-FR-009 — The system MUST build a summary line, in Romanian and English, of at most two parts joined with " · ": the first names the register checks that are `ok` — only `company` ("CUI") and `rar` ("autorizație RAR"): "CUI verificat", "Autorizație RAR verificată", "CUI și autorizație RAR verificate"; the second names the most serious problem — `failed` before `warning`, `rar` before any other kind, then the kinds' order — as `<kind name> <detail>`, with `rar = failed` reading "Lipsește autorizația RAR"; the line starts with a capital; with neither part it reads "Neverificat". The record call returns the file's new summary in both languages.

_From 300-verification-checks._

### 302-FR-007 — Ticking MUST record the kind `ok` with no detail through the existing record call (300-FR-003) at once, with no confirmation; unticking MUST record `not_run` with no detail, which the record call MUST now accept (`not_run` joins its recorded results, with no detail and no activities; modifies 300-FR-003 and 300-FR-010). "Marchează o problemă" MUST open a small task (`dialog` shape) with the choice "Avertisment" / "Warning" or "Problemă" / "Failure" and a required detail field of 1 to 200 characters, whose save records `warning` or `failed` with the detail and closes; the row then shows the lamp and the detail and the checkbox is unchecked. The drawer MUST show the saved state only from the server's answer: on a failure the control reverts to the last answer and a toast reads "Nu am putut salva verificarea" / "Could not save the check"; on 409 `verification_file_decided` it re-reads the file (FR-001) and turns read-only. Every tick's audit entry and event are the record call's (300-FR-006, FR-007); this story writes none of its own.

_From 302-garage-verification-file._

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

### 049-FR-001 — The system MUST store a SUSPENSION per suspension with: id, garage, cause (`recheck_failed`, `documents_overdue`, `admin`, `report_confirmed`), reason (text, 1 to 200 characters), `from_time` (UTC, the commit's time), `until_time` (empty while open; #106 sets it), who suspended (an admin's account, or none for `system`) and creation time. At most one open suspension (empty `until_time`) MUST exist per garage, enforced by the database.

_From 049-garage-suspension._

### 049-FR-002 — The system MUST provide one domain use case in the verification module, `suspend(garageId, cause, reason, actor)`, that in a single transaction: creates the SUSPENSION, sets the garage's status `approved` → `suspended`, writes one audit entry on subject `garage` (actor, actor role, old and new status, the cause and the reason) and one outbox row `garage.suspended` whose payload carries `garageId` and `cause`. A failed audit or outbox write MUST fail the transaction. Two concurrent calls for one garage MUST end with exactly one committed (the row lock on the garage, as the verification transitions use).

_From 049-garage-suspension._

### 049-FR-003 — The use case MUST refuse with 409 `garage_already_suspended` ("Deja suspendat" / "Already suspended") a garage that is `suspended`, writing one audit entry that records the refused attempt with its cause, reason and actor, committed on its own after the refusing transaction rolls back, and changing nothing else; and with 409 `garage_not_approved` a garage that is `draft` (no file, or a file waiting for a decision), writing no audit entry. An unknown garage id answers 404 `not_found`.

_From 049-garage-suspension._

### 049-FR-004 — The use case MUST accept an actor whose role is `admin` or `system` and refuse every other actor with 404, as the capability policy answers on admin routes (207-FR-010). The `system` actor is written as "MotorFix" in the audit history (390-FR-006).

_From 049-garage-suspension._

### 049-FR-005 — `POST /api/v1/admin/garages/{id}/suspend` MUST take `{ cause, reason }` through a DTO in the contracts library validated at the edge (400 `validation_failed` for a cause outside FR-001's four, or a reason missing, blank, not a string or over 200 characters), call the use case with the signed-in admin as actor, and answer 200 with the suspension `{ id, garageId, cause, reason, fromTime }`; a non-admin session gets 404 with no garage data, no session 401 `sign_in_required`. The OpenAPI document and the generated client MUST be regenerated.

_From 049-garage-suspension._

### 049-FR-014 — The new endpoint MUST be listed in `infra/observability/inventory.json` with its metric (the API's request duration by route, plus a suspensions counter by cause), its dashboard panel and its alert or the reason none is needed; the suspend use case MUST log one line per suspension (garage id, cause, actor role) and the `garage.suspended` consumer one per message built.

_From 049-garage-suspension._

### 049-FR-015 — Tests MUST cover, on real PostgreSQL and Redis: each of the four causes writing the SUSPENSION, the status, the audit entry and the outbox row in one transaction; the 409s of FR-003 (with the refused attempt's audit entry) and the 404 of FR-004 and FR-005 for a driver, an owner, a receptionist and a mechanic; the DTO's 400s; exactly one suspension under two concurrent calls; the public scope excluding a garage suspended through the use case in the search, the brand pages, the profile (410) and the routing; the 409s of FR-008 and FR-009; GARAGE_SUSPENDED built once per owner with every channel muted, in each owner's language, and once for a replayed event. Web unit tests MUST cover the banner's presence, texts and next step per cause in both languages and its absence for `approved` and `draft`. Playwright MUST show an admin suspending Atelier Dinamo while a visitor has its BMW results open: the card leaves the list without a reload, and the owner signs in and sees the banner.

_From 049-garage-suspension._
### 301-FR-001 — The system MUST expose an admin-only read of the verification queue, platform-wide whatever city the overview has chosen: every file whose status is `submitted` or `in_review`, oldest first by the time of its latest sending, for one page of 20 rows by default (the panel asks for 5), `offset` 0 to 10000 and `limit` 1 to 200 (a live re-read asks for every loaded row), a value outside those bounds answering 400 `validation_failed`, with the total number waiting; anyone who is not a MotorFix admin gets 404, no token 401.

_From 301-verification-queue._

### 301-FR-002 — Each row MUST carry the file id and status, the garage id and name, its area (the town recorded for the garage, or for a mobile mechanic its service radius in km), the count of brands the garage works on, the count of its mechanics (absent when the garage's team-mechanics switch is off), the checks' summary line in Romanian and English and its lamp colour (from 300-FR-008 and 300-FR-009: red when any check failed, amber when any check is a warning, green when at least one check is ok and none is a warning or failure, grey when nothing is recorded), the time of its latest sending, the working days it has waited and whether it is flagged; when flagged, the server's `lamp` is amber unless a check failed (red wins).

_From 301-verification-queue._

### 301-FR-003 — The time of a file's latest sending MUST be stored on the file (`submitted_at`): set when the garage sends the file, reset when it sends the file again after more was requested and reset when an admin reopens a decided file; files sent before this change take their creation time.

_From 301-verification-queue._

### 301-FR-004 — Working days MUST be counted in Europe/Bucharest as Monday to Friday minus Romania's legal holidays (the `public_holiday` table): the days after the sending day on which the sending's wall-clock time has passed; a file is flagged when it has waited more than VERIFICATION_TARGET_WORKING_DAYS = 2 working days, so a Monday 10:00 sending is flagged from Thursday 10:01 with "așteaptă de 3 zile lucrătoare" / "waiting 3 working days" ("1 zi lucrătoare" / "1 working day" in the singular).

_From 301-verification-queue._

### 302-FR-003 — The drawer MUST open at the address `/app/admin/garages/{fileId}` under the admin shell's "Service-uri" view, through the overlay service's `drawer-wide` shape (a full-height bottom sheet under 768 px, 158-FR-001), titled "Dosar de verificare" / "Verification file" with the garage's name as its subtitle; the queue row's "Deschide dosarul" navigates there (modifies 301-FR-005: the link opens the drawer, not a separate page). Opening calls FR-002 once; closing by X, Escape, outside click or Back returns to `/app/admin/garages` with the view's scroll kept. While the call is on its way the body shows skeleton sections marked busy (157-FR-012); a failed call shows "Nu am putut deschide dosarul" / "Could not open the file" with "Reîncearcă" / "Retry".

_From 302-garage-verification-file._

### 301-FR-006 — The four counts — the panel's, the view's, the menu item "Service-uri" and the header line — MUST come from one count of the files waiting (`garagesWaiting`, 163-FR-007), so they agree; the queue read's total MUST be that same count. With a city chosen the header keeps its 163 rule (that city's count); the other three stay platform-wide.

_From 301-verification-queue._

### 301-FR-007 — With no file waiting the panel and the view MUST read "Niciun service nu așteaptă verificarea" / "No garage is waiting for verification"; the panel and the view read 0, the menu counter is hidden and the header reads its existing "none waiting" line, as the shell does today.

_From 301-verification-queue._

### 301-FR-008 — While the queue read is on its way the panel and the view MUST show skeleton rows; when it fails they MUST show an error line with a retry, and the counts keep their last value marked stale (the overview tile's existing failed state).

_From 301-verification-queue._

### 301-FR-010 — When a garage sends its file, and when it sends it again after more was requested, the system MUST notify every active MotorFix admin once per sending with ADMIN_VERIFICATION_QUEUED (bell, e-mail, push; mutable), naming the garage and linking to the admin dashboard, after the sending commits: the worker's verification fan-out reads the `verification.submitted` event, whose id makes each sending one alert; a sending rolled back tells nobody. The template exists in Romanian and English with an example, as every kind in the registry.

_From 301-verification-queue._

### 301-FR-011 — Reading the queue MUST write no audit entry and change nothing.

_From 301-verification-queue._

### 301-FR-012 — The row DTO and the queue read's query live in the contracts library, the endpoint is REST with OpenAPI and the generated client is regenerated; every text of the panel and the view lives in the shared i18n files in Romanian and English; the panel and the view read at 320 px, 390 px, tablet and desktop, in light and dark, with no sideways scroll, and the flag is conveyed by text, not by colour alone; every row's button is reachable and operable by keyboard, and its lamp carries the summary line as its text alternative.

_From 301-verification-queue._

### 301-FR-013 — Tests MUST cover, in Jest: the waiting-state filter (`more_requested`, `approved`, `rejected` left out) and the oldest-first order including a resend; the working-day count across a weekend and across 1 December; the flag threshold at exactly 2 and at 3 days; `submitted_at` reset on resend and on reopen; red winning over the flag; the four counts equal to the read's total; 404 for each non-admin role; one ADMIN_VERIFICATION_QUEUED per admin per sending, none duplicated on a resend; the row's lamp colour for each case. End to end, as the seeded admin: the queue open with the seeded waiting files, a submission's `verification.submitted` event recorded for another seeded garage from a second context, the row and the four counts appearing without a reload, at desktop and a 320 px phone; the four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 301-verification-queue._

### 066-FR-001 — The system MUST expose an admin-only summary read of the garages, `GET /api/v1/admin/garages/summary`, platform-wide whatever city the overview has chosen, answering three counts: `listed` (garages whose status is `approved`), `waiting` (the one waiting count of 301-FR-006, the files `submitted` or `in_review`) and `suspended` (garages whose status is `suspended`); every value is a count and nothing in the answer is personal data.

_From 066-suspended-garages._

### 066-FR-002 — The system MUST expose an admin-only list read of the garages by status, `GET /api/v1/admin/garages?status=suspended`, with `offset` 0 to 10000 and `limit` 1 to 200 (default 20; a live re-read asks for every loaded row), answering the rows and `total` (every suspended garage); `status` is required and `suspended` is the one value this story accepts, every other value, a missing status, or an offset or limit out of range answering 400 `validation_failed`. One row per suspended garage, its open suspension (empty `until_time`) when it has one, ordered by the suspension's start, most recent first, then by the garage id ascending (a garage with no open suspension last, by its name, then its id).

_From 066-suspended-garages._

### 066-FR-003 — Each row MUST carry the garage id and name, the id of the garage's newest verification file (absent when it has none; the "Deschide dosarul" link opens it, as the queue's rows link a file), its area (the town recorded for the garage, or for a mobile mechanic its service radius in km; absent when none, as 301-FR-002), and, from the open suspension: the cause, the reason as stored, `fromTime` (UTC), and `cancelledBookings`, the number of the garage's bookings cancelled with the reason `garage_suspended` at or after `fromTime` (0 until #204 cancels them); a garage with no open suspension carries none of these four.

_From 066-suspended-garages._

### 066-FR-004 — For a `recheck_failed` suspension the row MUST carry `rarVerdict` ∈ `expired`, `suspended`, `withdrawn`, decided once on the server: from the failed re-check's recorded verdict when the re-check story (#9) stores one, and until then from the reason, the one of "expirat", "suspendat", "retras" that comes first in the reason's text (any case, any ending); absent when neither names one. The state text per cause is the web's, in Romanian and English: `recheck_failed` "autorizație RAR expirată" / "autorizație RAR suspendată" / "autorizație RAR retrasă" by the verdict and "autorizație RAR nevalidă" without one ("RAR authorisation expired / suspended / withdrawn / invalid"); `documents_overdue` "documente anuale neîncărcate" ("yearly documents not uploaded"); `report_confirmed` "sesizare confirmată" ("report confirmed"); `admin` "decizia unui administrator" ("an admin's decision"); each shown as "suspendat · {text}" ("suspended · {text}").

_From 066-suspended-garages._

### 066-FR-005 — Both reads MUST keep the `admin/*` access policy: an admin reads them, any other role answers 404 `not_found` with no garage data, a missing token 401 `sign_in_required`; reading MUST write no audit entry and change nothing; neither read is refused by maintenance mode (160-FR-003).

_From 066-suspended-garages._

### 066-FR-010 — The two reads MUST be REST with OpenAPI, their query, row and answer DTOs in the contracts library validated at the edge, and the generated client regenerated; the web MUST call them through the generated client; both MUST be listed in `infra/observability/inventory.json` with their metric (the API's request duration by route), dashboard panel and alert or the reason none is needed.

_From 066-suspended-garages._

### 066-FR-011 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the three counts (approved, waiting as `submitted` or `in_review`, suspended; a `draft` garage counting nowhere) and `waiting` equal to the overview's count; the list's filter and order (most recent start first), `total`, the 400s of FR-002, a garage with no open suspension; `cancelledBookings` counting only `garage_suspended` cancellations at or after `fromTime`; `rarVerdict` for each of the three words, for a reason naming none and for the other three causes; 404 for a driver, an owner, a receptionist and a mechanic on both reads; no audit entry written by a read. Web unit tests MUST cover the counts line's three states and its plural forms in both languages, and the panel's state text per cause and verdict, the date, the cancelled count, the empty, loading, failed and stale states, in both languages. Playwright MUST show, as the seeded admin at desktop and a 320 px phone, the counts line and the panel on "Service-uri", then Atelier Dinamo suspended from a second context through the suspend endpoint: the line's figures and the panel's new row appear without a reload; the four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 066-suspended-garages._
### 302-FR-001 — The system MUST expose an admin-only read of one verification file, `GET /api/v1/admin/verification-files/{id}`, answering in one response: the file (id, status, latest sending time, who opened it and when, who decided it and when, reason code and note, who reopened it and when and the reopen reason, the declaring name and time); the garage header (garage id and name, kind of business, CUI, the workshop address or, for a mobile mechanic, the registered seat and the service radius in km, phone, the names of the brands it works on, its photos as short-lived thumbnail and display addresses as the public profile issues them); the 8 checks (kind, result, detail, who recorded it, when; for `activities` the recorded activities' names in both languages); the documents, one entry per kind of the contracts list in its order, present (id, page count, issue date, and, for the ONRC certificate only, whether the issue date is absent or more than 30 days before the latest sending; null for every other kind) or missing; whether the document store is reachable (the API's storage probe); the garage's `open` reports (text, time); the earlier rejection when `previous_file_id` names one (reason code, note, decision time); and the timeline of FR-010. Anyone who is not a MotorFix admin MUST get 404 with no garage data, no token 401; the read MUST write no audit entry and change nothing.

_From 302-garage-verification-file._

### 302-FR-002 — The system MUST expose `POST /api/v1/admin/verification-files/{id}/open`, which runs the existing open use case (207-FR-002) for the signed-in admin and answers the same body as FR-001: a `submitted` file becomes `in_review` with `opened_by` and `opened_at`, one audit entry and one `verification.opened` outbox row in the same transaction; a file already `in_review` is answered unchanged with no entry and no row; every status other than `submitted` (`in_review`, decided, `more_requested`) is answered unchanged with no transition, no entry and no row, which changes the existing use case so it no longer refuses a decided file with 409 (modifies 207-FR-002), so the drawer opens read-only; an unknown id and every non-admin get 404.

_From 302-garage-verification-file._

### 302-FR-003 — The drawer MUST open at the address `/app/admin/garages/{fileId}` under the admin shell's "Service-uri" view, through the overlay service's `drawer-wide` shape (a full-height bottom sheet under 768 px, 158-FR-001), titled "Dosar de verificare" / "Verification file" with the garage's name as its subtitle; the queue row's "Deschide dosarul" navigates there (modifies 301-FR-005: the link opens the drawer, not a separate page). Opening calls FR-002 once; closing by X, Escape, outside click or Back returns to `/app/admin/garages` with the view's scroll kept. While the call is on its way the body shows skeleton sections marked busy (157-FR-012); a failed call shows "Nu am putut deschide dosarul" / "Could not open the file" with "Reîncearcă" / "Retry".

_From 302-garage-verification-file._

### 203-FR-006 — In the drawer, the `company` row MUST read "Firmă activă la ANAF și ONRC" / "Active company at ANAF and ONRC" and the `caen` row "Cod CAEN 4520" / "CAEN code 4520" (modifies the labels of 302-FR-004), each grey "neverificat" / "not checked" until recorded. The `company` row MUST carry two links, "ANAF" and "ONRC", and the `caen` row one, "ONRC", each opening the public look-up page (ANAF: `https://mfinante.gov.ro/ro/web/site/info-pj-selectie-dupa-cui`; ONRC: `https://portal.onrc.ro/`) in a new tab and copying the garage's CUI to the clipboard, with a toast "CUI copiat" / "CUI copied"; when the clipboard is unavailable the tab still opens and nothing else happens. The links are plain links to fixed public addresses with no CUI in them; MotorFix sends nothing to those sites.

_From 203-company-caen-check._

### 302-FR-005 — Each document kind of the contracts list MUST be one row: label from the kind's shared labels (206-FR-004); when present, "· emis acum <n> zile" / "· issued <n> days ago" ("emis azi" / "issued today", "emis ieri" / "issued yesterday") from its issue date, else "· <n> pagini" / "· <n> pages" (singular "1 pagină" / "1 page"); a second line in the warning colour "Mai vechi de 30 de zile la data trimiterii" / "Older than 30 days at the time of sending" or "Data emiterii lipsește" / "Issue date missing" for the certificate when so; one "Deschide" / "Open" button for a one-page document, else "Deschide pagina <n>" / "Open page <n>" per page; when missing, "· lipsește" / "· missing" in the failed colour and no button; when the store is unreachable, "indisponibil" / "unavailable" in place of the buttons. Pressing a button MUST ask the existing page address (206-FR-014) and open it in a new tab; a failed request shows "Nu am putut deschide documentul" / "Could not open the document" with "Reîncearcă" / "Retry" on that row only. This story adds no address route and no audit write of its own: every opening is the one 206-FR-014 already logs.

_From 302-garage-verification-file._

### 302-FR-006 — The manual checks MUST be four rows, in this order and mapped to these kinds: `address` "Adresa din documente e cea de pe profil" / "The address in the documents matches the profile" (mobile mechanic: "Adresa din documente e sediul social de pe profil" / "The address in the documents is the registered seat on the profile"); `photos` "Fotografiile sunt ale atelierului" / "The photos show the actual workshop" (mobile mechanic: "Fotografiile arată duba sau trusa mobilă și sculele principale" / "The photos show the van or mobile kit and main tools"); `representative` "Telefon confirmat prin apel" / "Phone confirmed by call"; `documents` "Documentele sunt complete și lizibile" / "The documents are complete and readable". Each row is a checkbox (checked when the result is `ok`), a "Marchează o problemă" / "Mark a problem" button, and, when the result is `warning` or `failed`, its lamp and detail; the `documents` checkbox is disabled with "Lipsește un document" / "A document is missing" while a kind is missing; every control is at least 44 px tall and reachable by keyboard.

_From 302-garage-verification-file._

### 302-FR-007 — Ticking MUST record the kind `ok` with no detail through the existing record call (300-FR-003) at once, with no confirmation; unticking MUST record `not_run` with no detail, which the record call MUST now accept (`not_run` joins its recorded results, with no detail and no activities; modifies 300-FR-003 and 300-FR-010). "Marchează o problemă" MUST open a small task (`dialog` shape) with the choice "Avertisment" / "Warning" or "Problemă" / "Failure" and a required detail field of 1 to 200 characters, whose save records `warning` or `failed` with the detail and closes; the row then shows the lamp and the detail and the checkbox is unchecked. The drawer MUST show the saved state only from the server's answer: on a failure the control reverts to the last answer and a toast reads "Nu am putut salva verificarea" / "Could not save the check"; on 409 `verification_file_decided` it re-reads the file (FR-001) and turns read-only. Every tick's audit entry and event are the record call's (300-FR-006, FR-007); this story writes none of its own.

_From 302-garage-verification-file._

### 302-FR-008 — The drawer MUST re-read the file (FR-001) through the dashboards' shared live re-read when `verification.opened`, `verification.check_recorded`, `verification.decided` or `verification.reopened` arrives on the admin's stream with its own `fileId`, and on every reconnect, so another admin's tick, a record form's save and a decision show within one re-read and no reload (modifies nothing in 301-FR-009: the kinds are already in the shell's list); events of other files MUST cause no re-read. No per-file live channel is added.

_From 302-garage-verification-file._

### 302-FR-009 — On a `submitted` or `in_review` file the footer MUST show the three buttons "Aprobă și publică" / "Approve and publish", "Cere completări" / "Ask for more" and "Respinge" / "Reject", disabled, with the note "Service-ul primește decizia pe e-mail. La „Cere completări” poate adăuga ce lipsește fără să reia tot." / "The garage gets the decision by email. With “Ask for more” it can add what is missing without starting over." (#173, #58, #59 and #172 enable them). On an `approved`, `rejected` or `more_requested` file the drawer MUST be read-only — checkboxes and problem buttons disabled, no save attempted — and the footer MUST read "Aprobat de <first name>, <date time>" / "Approved by …", "Respins de …" / "Rejected by …" or "Completări cerute de …" / "More requested by …", with the reason label and note when there is one; "Redeschide dosarul" is #173's.

_From 302-garage-verification-file._

### 302-FR-010 — The read of FR-001 MUST include the file's timeline: the audit entries whose subject is the file, one of its checks or one of its documents and whose action is one of the file's sending, opening, decision, reopening or resending, a check record, or a document `open` (a document upload and the declaration write are left out, on the server), newest first, at most 50 of those with their total, each with action, field, old and new values, actor's first name ("MotorFix" for `system`), reason text and time; the drawer MUST render each as one line in the admin's language and Europe/Bucharest as US4 scenario 1 lists, and "și încă <n>" / "and <n> more" past 50.

_From 302-garage-verification-file._

### 302-FR-011 — Every text of the drawer and its dialog MUST live in the shared i18n files in Romanian and English; the drawer MUST read at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll; every state MUST be conveyed by text as well as colour; the drawer is a modal dialog named by its title with focus kept inside and returned on close (157-FR-008, FR-009).

_From 302-garage-verification-file._

### 302-FR-012 — The file DTO and the open call live in the contracts library, both endpoints are REST with OpenAPI, and the generated client is regenerated; the two new routes are listed in `infra/observability/inventory.json` with the API's request metrics by route, their dashboard panel and the reason no alert of their own is needed; the open call MUST log one line per first opening (file id, admin id).

_From 302-garage-verification-file._

### 302-FR-013 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the first opening moving the file to `in_review` with its audit entry and outbox row and a second opening writing neither; the open call on a decided file changing nothing; the read's 404 for a driver, an owner, a receptionist and a mechanic and 401 with no token; the read carrying the header (company and mobile mechanic), the 8 checks, a present and a missing document kind, the 30-day and no-date flags, an open report, the earlier rejection, the storage flag and the timeline's order and cap; the read writing no audit entry; the four tick mappings (`ok`, `not_run`, `warning`, `failed` with detail) through the record call, `not_run` included; the timeline leaving out a document upload and the declaration write. Web unit tests MUST cover the section order, the two wordings (company, mobile mechanic), the document row texts, the disabled documents tick, the revert on a failed save, the read-only decided state and the re-read filter by `fileId`. Playwright MUST, as the seeded admin: open a file from the queue, see the status change in the row, open both documents (two tabs with signed addresses), tick the four manual checks (both documents present) and see them held checked after a reload, mark a problem on one and see the queue row name it, at desktop and at a 320 px phone; the four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 302-garage-verification-file._

### 203-FR-001 — Each `company` and `caen` check MUST carry evidence beside its result and detail, stored with the check and returned with it in the file: for `company`, the company name as the admin typed it, trimmed of surrounding whitespace (1 to 200 characters after trimming, so a name of spaces only counts as empty; no control characters; optional unless `ok`); for `caen`, whether 4520 is on the certificate, whether 4520 is in the ONRC record, whether the address matches, and whether an ONRC certificate was uploaded at the time of the save; for both, the day of the save (Bucharest calendar day, written by the server) as the date the registers were looked up. The admin's part of the evidence (the name; the three ticks) is sent with the record call (modifies 300-FR-003), while whether a certificate was uploaded and the look-up date are written by the server and are not part of the request, is accepted only for these two kinds and only with `ok`, `warning` or `failed` (400 `validation_failed` otherwise), and a `not_run` record clears it.

_From 203-company-caen-check._

### 203-FR-002 — A `company` record MUST be accepted as `ok` only when the evidence holds a company name and the garage's stored CUI passes the shared CUI validator (an optional "RO" prefix, 2 to 10 digits whose last is the control digit under key 753217532, stored without "RO"; the one step 6 uses); the server then writes the detail "CUI valid · <name>" itself, whatever detail was sent. An `ok` save without a name, or on a CUI that fails the validator, is refused with 400 `validation_failed` naming the reason. `warning` and `failed` keep the rules of 300-FR-010: a typed detail of 1 to 200 characters, required.

_From 203-company-caen-check._

### 203-FR-003 — A `caen` record MUST be accepted as `ok` only when the evidence says 4520 is in the ONRC record, the address matches, and 4520 is on the certificate unless no ONRC certificate was uploaded (OD-29). Whether a certificate was uploaded is read by the server from the file's documents at the time of the save and written into the evidence; a value sent by the form for it is ignored. An `ok` save that lacks a required tick is refused with 400 `validation_failed` naming the missing tick. On `ok` the server writes the detail "Întreținerea și repararea autovehiculelor, la punctul de lucru", or "… la sediul social" when the garage is a mobile mechanic, whatever detail was sent. `warning` and `failed` keep the typed, required detail and store the ticks as sent.

_From 203-company-caen-check._

### 203-FR-005 — The system MUST record the company and CAEN results by hand only at launch: every record of either stores `automatic = false` and calls no outside company register. No company-register seam, adapter, alert, metric or retry ships with this story (owner decision, 2026-10-17); the automatic look-up story adds the seam together with its call site.

_From 203-company-caen-check._

### 203-FR-006 — In the drawer, the `company` row MUST read "Firmă activă la ANAF și ONRC" / "Active company at ANAF and ONRC" and the `caen` row "Cod CAEN 4520" / "CAEN code 4520" (modifies the labels of 302-FR-004), each grey "neverificat" / "not checked" until recorded. The `company` row MUST carry two links, "ANAF" and "ONRC", and the `caen` row one, "ONRC", each opening the public look-up page (ANAF: `https://mfinante.gov.ro/ro/web/site/info-pj-selectie-dupa-cui`; ONRC: `https://portal.onrc.ro/`) in a new tab and copying the garage's CUI to the clipboard, with a toast "CUI copiat" / "CUI copied"; when the clipboard is unavailable the tab still opens and nothing else happens. The links are plain links to fixed public addresses with no CUI in them; MotorFix sends nothing to those sites.

_From 203-company-caen-check._

### 203-FR-007 — Each of the two rows MUST offer a record form while the file is undecided: three buttons "OK" / "Atenție" / "Problemă" ("OK" / "Warning" / "Failure"), a detail field required for Atenție and Problemă (1 to 200 characters, hidden for OK since the server writes that detail), and a "Resetează" / "Clear" action that records `not_run` when the row has a result. The `company` form holds a "Denumirea firmei" / "Company name" field, required for OK. The `caen` form holds the ticks "4520 pe certificat" / "4520 on the certificate" (absent when the file holds no ONRC certificate), "4520 în ONRC" / "4520 in the ONRC record" and "la punctul de lucru" / "at the workshop address" with the garage's address shown beneath it, or "la sediul social" / "at the registered seat" with the seat address for a mobile mechanic; OK is refused in the form with the missing tick named before anything is sent, and the server's refusal (FR-003) is shown the same way when it arrives. Saving records the kind through the existing record call with the result, the detail and the evidence.

_From 203-company-caen-check._

### 203-FR-008 — After a save, the row MUST show only the server's answer: the lamp, the detail, the ticks of a `caen` check as stored (each as text, "certificat · ONRC · adresă" or the English equivalents, with a missing certificate read as "fără certificat" / "no certificate"), the recorder's name and the time; the queue line is updated from the answer's summary (300-FR-009): "CUI verificat" on a `company` ok, "CUI <detail>" on a warning or failure. On a failure the form keeps what was typed and ticked and a toast reads "Nu am putut salva verificarea" / "Could not save the check"; on 409 `verification_file_decided` the drawer re-reads the file and turns read-only (as 302-FR-007). Another admin's open drawer refreshes the rows through the existing `verification-file:{fileId}` live update (302-FR-009), with no new channel.

_From 203-company-caen-check._

### 203-FR-009 — Every text of the forms and rows MUST live in the shared i18n files in Romanian and English; the fixed `ok` details the server writes (FR-002, FR-003) are stored in Romanian, like every typed detail, and shown as stored in both languages; the forms MUST read at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll, every state conveyed by text as well as colour, the ticks and buttons reachable by keyboard and named for a screen reader; the row's record form opens inside the drawer, which stays the one modal dialog (302-FR-011). Opening a form moves focus to its first control and closing it returns focus to the button that opened it; a refusal (a missing name or tick, a server error) is announced to assistive technology and names the control at fault; every control keeps the drawer's minimum touch target of 44 px.

_From 203-company-caen-check._

### 203-FR-010 — The evidence shape and the register seam live in the contracts and domain libraries; the record call's contract is extended, not duplicated, with OpenAPI updated and the generated client regenerated. The product action "verification check recorded" MUST be counted by kind and result and logged once per record with the file id, the kind, the result and the admin id, listed in `infra/observability/inventory.json` with the record route, its dashboard panel and the reason a count needs no alert of its own; the record route joins the API's request metrics by route.

_From 203-company-caen-check._

## Retired

- `207-FR-005` — superseded by `307-FR-001` (2026-10-08)

- `301-FR-005` — superseded by `302-FR-003` (2026-10-17)
- `207-FR-002` — superseded by `302-FR-002` (2026-10-17)
- `300-FR-003` — superseded by `302-FR-007` (2026-10-17)
- `300-FR-010` — superseded by `302-FR-007` (2026-10-17)

- `302-FR-007` — superseded by `203-FR-007` (2026-10-17)
- `300-FR-006` — superseded by `203-FR-004` (2026-10-17)
- `302-FR-004` — superseded by `203-FR-006` (2026-10-17)

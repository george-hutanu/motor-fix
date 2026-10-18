---
capability: garage-verification
updated: 2026-10-18
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
  - 306-decision-record
  - 204-rar-activities-check
  - 303-approve-publish-garage
  - 069-report-decision
---

# Capability: Garage verification

How MotorFix keeps a garage hidden from drivers until an admin approves it: the verification file and its allowed transitions, the garage's status, the one public scope every public read of garages goes through, the status label shown to the garage, and the test-only switch that approves at once.

## Requirements

### 303-FR-005 — The garage MUST carry `last_checked_on`, a nullable calendar date, set at every approval (an admin's and the system's, a reopened file's included) to the decision time's day in Europe/Bucharest, in the same update that sets `status` and `approved_at`, and included in the garage's audit entry of that approval; nothing else in this story writes it (#248 reads it; the monthly re-check of MF-59 may write it later). Modifies 207-FR-001 (one more column) and 207-FR-003 (the approval sets it beside `approved_at`).

_From 303-approve-publish-garage._

### 302-FR-002 — The system MUST expose `POST /api/v1/admin/verification-files/{id}/open`, which runs the existing open use case (207-FR-002) for the signed-in admin and answers the same body as FR-001: a `submitted` file becomes `in_review` with `opened_by` and `opened_at`, one audit entry and one `verification.opened` outbox row in the same transaction; a file already `in_review` is answered unchanged with no entry and no row; every status other than `submitted` (`in_review`, decided, `more_requested`) is answered unchanged with no transition, no entry and no row, which changes the existing use case so it no longer refuses a decided file with 409 (modifies 207-FR-002), so the drawer opens read-only; an unknown id and every non-admin get 404.

_From 302-garage-verification-file._

### 303-FR-005 — The garage MUST carry `last_checked_on`, a nullable calendar date, set at every approval (an admin's and the system's, a reopened file's included) to the decision time's day in Europe/Bucharest, in the same update that sets `status` and `approved_at`, and included in the garage's audit entry of that approval; nothing else in this story writes it (#248 reads it; the monthly re-check of MF-59 may write it later). Modifies 207-FR-001 (one more column) and 207-FR-003 (the approval sets it beside `approved_at`).

_From 303-approve-publish-garage._

### 207-FR-004 — Submitting MUST create a file `submitted` for a garage that has no `submitted`, `in_review` or `approved` file; when the garage's newest file is `rejected`, the new file's `previous_file_id` MUST point to it; when it is `submitted`, `in_review`, `more_requested` (the garage re-sends that file instead) or `approved` (a change goes through the change-flow stories), submitting MUST be refused with 409. This story exposes the submit transition for the submission story to call; it ships no submit endpoint.

_From 207-garage-approval-flow._

### 307-FR-001 — `GET /api/v1/garages/{slug}` MUST keep answering only through the one public scope: 200 for an `approved` garage, 404 `not_found` with no garage data for a `draft`, waiting or unknown slug, to everyone including the garage's own staff, and 410 `gone` with no garage data for a `suspended` garage (modifies 207-FR-005: the profile is now served from its cache, 307-FR-006).

_From 307-public-garage-profile._

### 207-FR-006 — The status shown to the garage MUST be derived, never stored, as one of: Ciornă (draft) when the garage is `draft` and has no file; Trimis (sent) when the newest file is `submitted`; În verificare (under review) when it is `in_review`; Cerute completări (more details requested) when it is `more_requested`; Respins (rejected), with the reason code and note, when it is `rejected`; Aprobat, pe hartă (approved, on the map) when the garage is `approved`, whatever its newest file; Suspendat (suspended) when the garage is `suspended`. The seven labels MUST exist in Romanian and English in the shared status labels, in the forms the mock uses: "Trimis", "În verificare", "Cerute completări", "Respins", "Aprobat, pe hartă" and, for the unpublished states, the suffix "· nepublicat" (English "· not published").

_From 207-garage-approval-flow._

### 207-FR-007 — The system MUST expose the list of fields whose change needs a new approval: `cui`, `address` or `seat_address` (a mobile mechanic's registered seat stands in for the workshop address), `business_kind`, and the kinds of work (the job types offered). A change of any of them on an approved garage MUST NOT change the garage's status or hide it: public reads keep showing the last approved values until an admin decides (the flow itself belongs to the change-flow stories, not to this one).

_From 207-garage-approval-flow._

### 303-FR-006 — The approval's audit record (306-FR-004: the file's status entry with the note, and the garage's entry of the same approval) MUST carry the list FR-003 judges, on the garage's entry as `verificationMissing`, computed for every approval (the `system` actor's included, which is exempt from the refusal, not from the record): the check kinds not `ok` with their results and the missing document kinds, empty when every check was ok; the timeline line of 302-FR-010 is unchanged. Modifies 306-FR-004.

_From 303-approve-publish-garage._

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

### 204-FR-013 — The five seeded RAR activity codes (mechanics, brakes, steering, suspension, air_con) stand until the lawyer's later review (owner, 2026-10-16, under the 2026-10-11 rule; a follow-up, not a gate, #578). The capability spec records that a migration replacing them must map or report every stored `GARAGE.rar_activities` value, and a migration test proves, after the migrations run, that the catalogue holds exactly those five codes and that every stored value is one of them. The seed migration's `TODO` comment stays: that migration is applied, and editing it would change its checksum on every deployed database.

_From 204-rar-activities-check._

### 204-FR-005 — Every `rar` and `activities` record MUST keep what 300-FR-003, 300-FR-006, 300-FR-007, 300-FR-010, 300-FR-011 and 203-FR-004 already give the record call: `recorded_by` and `recorded_at` set, `automatic = false`, one audit entry whose old and new values carry the result, the detail, the evidence and (for `activities`) the list, the `verification.check_recorded` event in the outbox in the same transaction, `price_list.updated` when the list changes, 409 "Dosarul e deja decis" on a decided file that was not reopened, and 404 for anyone but a MotorFix admin. This story adds no second write path.

_From 204-rar-activities-check._

### 300-FR-007 — Every record MUST emit `verification.check_recorded` with fileId, kind and result through the outbox, in the same transaction, to the admin channel.

_From 300-verification-checks._

### 300-FR-008 — The system MUST map a result to a lamp colour: `ok` green, `warning` amber, `failed` red, `not_run` grey.

_From 300-verification-checks._

### 204-FR-010 — The summary line MUST take the file's legal document rows beside its checks (modifies 300-FR-009): a file without a `rar_authorisation` document reads "Lipsește autorizația RAR" / "RAR licence missing" in its problem part whatever the `rar` result (ok included) and for every garage kind, until the document is on the file, ranked as a failed `rar` is; the queue and the record call's answer both pass the documents. The line reads "Autorizație RAR verificată" / "RAR licence checked" (the English line 300-FR-009 shipped) once `rar` is `ok` and the document is on the file (the wording SC-001 reads). A unit test covers it (#319).

_From 204-rar-activities-check._

### 302-FR-007 — Ticking MUST record the kind `ok` with no detail through the existing record call (300-FR-003) at once, with no confirmation; unticking MUST record `not_run` with no detail, which the record call MUST now accept (`not_run` joins its recorded results, with no detail and no activities; modifies 300-FR-003 and 300-FR-010). "Marchează o problemă" MUST open a small task (`dialog` shape) with the choice "Avertisment" / "Warning" or "Problemă" / "Failure" and a required detail field of 1 to 200 characters, whose save records `warning` or `failed` with the detail and closes; the row then shows the lamp and the detail and the checkbox is unchecked. The drawer MUST show the saved state only from the server's answer: on a failure the control reverts to the last answer and a toast reads "Nu am putut salva verificarea" / "Could not save the check"; on 409 `verification_file_decided` it re-reads the file (FR-001) and turns read-only. Every tick's audit entry and event are the record call's (300-FR-006, FR-007); this story writes none of its own.

_From 302-garage-verification-file._

### 300-FR-011 — Only a MotorFix admin may record a check; anyone else gets 404, as on the other admin routes.

_From 300-verification-checks._

### 312-FR-005 — The system MUST expose `POST /api/v1/garages/{id}/reports` in the verification module, taking `{ text }` through a DTO in the contracts library validated at the edge (400 `validation_failed` outside 20–1,000 characters or when `text` is not a string), answering 201 with `{ id, createdAt }`; the OpenAPI document and the generated client MUST be regenerated.

_From 312-report-garage._

### 312-FR-006 — The endpoint MUST require a session (401 `sign_in_required` without one, as the app-wide guard answers) and MUST answer 404 with no garage data when: the actor does not hold the `driver` role; the account is staff of that garage, read by account id inside the request from both `garage_member` (owner, receptionist) and the mechanic card, whatever role the session holds (never from `actor.garageId`); or the garage is not `approved` (draft, waiting, suspended or unknown id). Trust is decided on the server, never from what the page shows.

_From 312-report-garage._

### 069-FR-003 — An accepted decision MUST, in one transaction: set every `open` report of the file to `unfounded` or `confirmed` with `decided_by` (the admin), `decided_at` (UTC) and `decision_note` (the note, or the reason); set the file `in_review` → `approved` with `decided_by` and `decided_at` the same admin and time, no other file column changed; write one audit entry on the file (action `report_decided`, actor role `admin`, the decision, the ids of the reports it covers, the note or reason); write one outbox row `garage_report.decided` carrying `fileId`, `garageId`, `decision`, `reportIds` and `reporterIds` (the distinct reporters). A failed write MUST fail the transaction.

_From 069-report-decision._

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
### 306-FR-006 — The system MUST expose `POST /api/v1/admin/verification-files/{id}/decision`, taking FR-001's payload through a DTO in the contracts library validated at the edge, and `POST /api/v1/admin/verification-files/{id}/reopen` with no body; both run the use case with the signed-in admin as actor (the `admin.garages` capability, as the open call) and answer 200 with the file read's body (302-FR-001), which now carries `requested_items`; anyone who is not a MotorFix admin MUST get 404 with no garage data, no token 401, an unknown id 404. The OpenAPI document and the generated client MUST be regenerated.

_From 306-decision-record._
### 303-FR-007 — The file read MUST carry, on its garage part, `cuiAlsoUsedBy`: the names of the other garage rows holding the same stored CUI, whatever their status, sorted by name in Romanian collation then by id, empty when the CUI is null or held by no other garage; the drawer MUST show, in the header under the CUI, the line "CUI folosit și de alt service: {names}" / "CUI also used by another garage: {names}" in the warning colour and by text (an alert role is not used: it is a fact, not an event), and nothing of the button's state changes. Modifies the file read (204-FR-009, the latest form of 302-FR-001: one more field).

_From 303-approve-publish-garage._

### 302-FR-002 — The system MUST expose `POST /api/v1/admin/verification-files/{id}/open`, which runs the existing open use case (207-FR-002) for the signed-in admin and answers the same body as FR-001: a `submitted` file becomes `in_review` with `opened_by` and `opened_at`, one audit entry and one `verification.opened` outbox row in the same transaction; a file already `in_review` is answered unchanged with no entry and no row; every status other than `submitted` (`in_review`, decided, `more_requested`) is answered unchanged with no transition, no entry and no row, which changes the existing use case so it no longer refuses a decided file with 409 (modifies 207-FR-002), so the drawer opens read-only; an unknown id and every non-admin get 404.

_From 302-garage-verification-file._

### 302-FR-003 — The drawer MUST open at the address `/app/admin/garages/{fileId}` under the admin shell's "Service-uri" view, through the overlay service's `drawer-wide` shape (a full-height bottom sheet under 768 px, 158-FR-001), titled "Dosar de verificare" / "Verification file" with the garage's name as its subtitle; the queue row's "Deschide dosarul" navigates there (modifies 301-FR-005: the link opens the drawer, not a separate page). Opening calls FR-002 once; closing by X, Escape, outside click or Back returns to `/app/admin/garages` with the view's scroll kept. While the call is on its way the body shows skeleton sections marked busy (157-FR-012); a failed call shows "Nu am putut deschide dosarul" / "Could not open the file" with "Reîncearcă" / "Retry".

_From 302-garage-verification-file._

### 204-FR-007 — In the drawer, the `rar` row MUST read "Autorizație RAR găsită în registru" / "RAR authorisation found in the register", and "Autorizația RAR nu apare în registru" / "RAR authorisation not found in the register" while its result is `failed`; the `activities` row "Activitățile autorizate acoperă lista de prețuri" / "Authorised activities cover the price list" (modifies the labels of 302-FR-004 and 203-FR-006); each grey "neverificat" / "not checked" until recorded. The `rar` row MUST show the file's RAR number as stored, or "număr lipsă" / "number missing", a "Corectează" / "Correct" action on an undecided file that opens a one-field form calling FR-001, and one link "Registrul RAR" / "RAR register" opening `https://portal.rarom.ro/` in a new tab and copying the number to the clipboard with a toast "Număr RAR copiat" / "RAR number copied"; when the clipboard is unavailable the tab still opens and nothing else happens. The link is a plain link to a fixed public address with no number in it; MotorFix sends nothing to that site.

_From 204-rar-activities-check._

### 302-FR-005 — Each document kind of the contracts list MUST be one row: label from the kind's shared labels (206-FR-004); when present, "· emis acum <n> zile" / "· issued <n> days ago" ("emis azi" / "issued today", "emis ieri" / "issued yesterday") from its issue date, else "· <n> pagini" / "· <n> pages" (singular "1 pagină" / "1 page"); a second line in the warning colour "Mai vechi de 30 de zile la data trimiterii" / "Older than 30 days at the time of sending" or "Data emiterii lipsește" / "Issue date missing" for the certificate when so; one "Deschide" / "Open" button for a one-page document, else "Deschide pagina <n>" / "Open page <n>" per page; when missing, "· lipsește" / "· missing" in the failed colour and no button; when the store is unreachable, "indisponibil" / "unavailable" in place of the buttons. Pressing a button MUST ask the existing page address (206-FR-014) and open it in a new tab; a failed request shows "Nu am putut deschide documentul" / "Could not open the document" with "Reîncearcă" / "Retry" on that row only. This story adds no address route and no audit write of its own: every opening is the one 206-FR-014 already logs.

_From 302-garage-verification-file._

### 302-FR-006 — The manual checks MUST be four rows, in this order and mapped to these kinds: `address` "Adresa din documente e cea de pe profil" / "The address in the documents matches the profile" (mobile mechanic: "Adresa din documente e sediul social de pe profil" / "The address in the documents is the registered seat on the profile"); `photos` "Fotografiile sunt ale atelierului" / "The photos show the actual workshop" (mobile mechanic: "Fotografiile arată duba sau trusa mobilă și sculele principale" / "The photos show the van or mobile kit and main tools"); `representative` "Telefon confirmat prin apel" / "Phone confirmed by call"; `documents` "Documentele sunt complete și lizibile" / "The documents are complete and readable". Each row is a checkbox (checked when the result is `ok`), a "Marchează o problemă" / "Mark a problem" button, and, when the result is `warning` or `failed`, its lamp and detail; the `documents` checkbox is disabled with "Lipsește un document" / "A document is missing" while a kind is missing; every control is at least 44 px tall and reachable by keyboard.

_From 302-garage-verification-file._

### 302-FR-007 — Ticking MUST record the kind `ok` with no detail through the existing record call (300-FR-003) at once, with no confirmation; unticking MUST record `not_run` with no detail, which the record call MUST now accept (`not_run` joins its recorded results, with no detail and no activities; modifies 300-FR-003 and 300-FR-010). "Marchează o problemă" MUST open a small task (`dialog` shape) with the choice "Avertisment" / "Warning" or "Problemă" / "Failure" and a required detail field of 1 to 200 characters, whose save records `warning` or `failed` with the detail and closes; the row then shows the lamp and the detail and the checkbox is unchecked. The drawer MUST show the saved state only from the server's answer: on a failure the control reverts to the last answer and a toast reads "Nu am putut salva verificarea" / "Could not save the check"; on 409 `verification_file_decided` it re-reads the file (FR-001) and turns read-only. Every tick's audit entry and event are the record call's (300-FR-006, FR-007); this story writes none of its own.

_From 302-garage-verification-file._

### 302-FR-008 — The drawer MUST re-read the file (FR-001) through the dashboards' shared live re-read when `verification.opened`, `verification.check_recorded`, `verification.decided` or `verification.reopened` arrives on the admin's stream with its own `fileId`, and on every reconnect, so another admin's tick, a record form's save and a decision show within one re-read and no reload (modifies nothing in 301-FR-009: the kinds are already in the shell's list); events of other files MUST cause no re-read. No per-file live channel is added.

_From 302-garage-verification-file._

### 069-FR-009 — On a file `in_review` with at least one `open` report the drawer's footer MUST show "Sesizare nefondată" / "Report unfounded" and "Sesizare confirmată" / "Report confirmed" in place of the three decision buttons, each at least 44 px tall and reachable by keyboard. "Sesizare nefondată" MUST open a confirmation dialog with one optional note field (at most 1,000 characters, "Notă internă" / "Internal note", counted) and send `unfounded`; "Sesizare confirmată" MUST open a dialog with one required reason field (1 to 200 characters, "Motivul pe care îl vede service-ul" / "The reason the garage will see", counted) and the line "Service-ul va fi suspendat și va primi acest motiv." / "The garage will be suspended and receive this reason.", and send `confirmed`; the dialogs MUST refuse to send outside those limits and show the server's 409 as the drawer's existing red line (306-FR-008). On success the drawer MUST show the decided state.

_From 069-report-decision._

### 302-FR-010 — The read of FR-001 MUST include the file's timeline: the audit entries whose subject is the file, one of its checks or one of its documents and whose action is one of the file's sending, opening, decision, reopening or resending, a check record, or a document `open` (a document upload and the declaration write are left out, on the server), newest first, at most 50 of those with their total, each with action, field, old and new values, actor's first name ("MotorFix" for `system`), reason text and time; the drawer MUST render each as one line in the admin's language and Europe/Bucharest as US4 scenario 1 lists, and "și încă <n>" / "and <n> more" past 50.

_From 302-garage-verification-file._

### 302-FR-011 — Every text of the drawer and its dialog MUST live in the shared i18n files in Romanian and English; the drawer MUST read at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll; every state MUST be conveyed by text as well as colour; the drawer is a modal dialog named by its title with focus kept inside and returned on close (157-FR-008, FR-009).

_From 302-garage-verification-file._

### 302-FR-012 — The file DTO and the open call live in the contracts library, both endpoints are REST with OpenAPI, and the generated client is regenerated; the two new routes are listed in `infra/observability/inventory.json` with the API's request metrics by route, their dashboard panel and the reason no alert of their own is needed; the open call MUST log one line per first opening (file id, admin id).

_From 302-garage-verification-file._

### 302-FR-013 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the first opening moving the file to `in_review` with its audit entry and outbox row and a second opening writing neither; the open call on a decided file changing nothing; the read's 404 for a driver, an owner, a receptionist and a mechanic and 401 with no token; the read carrying the header (company and mobile mechanic), the 8 checks, a present and a missing document kind, the 30-day and no-date flags, an open report, the earlier rejection, the storage flag and the timeline's order and cap; the read writing no audit entry; the four tick mappings (`ok`, `not_run`, `warning`, `failed` with detail) through the record call, `not_run` included; the timeline leaving out a document upload and the declaration write. Web unit tests MUST cover the section order, the two wordings (company, mobile mechanic), the document row texts, the disabled documents tick, the revert on a failed save, the read-only decided state and the re-read filter by `fileId`. Playwright MUST, as the seeded admin: open a file from the queue, see the status change in the row, open both documents (two tabs with signed addresses), tick the four manual checks (both documents present) and see them held checked after a reload, mark a problem on one and see the queue row name it, at desktop and at a 320 px phone; the four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 302-garage-verification-file._

### 204-FR-002 — Each `rar` and `activities` check MUST carry evidence beside its result and detail, stored with the check and returned with it (extends 203-FR-001's evidence to these two kinds): for `rar`, whether the authorisation was found, whether it is for the same company, whether it is for the same address (the registered seat for a mobile mechanic), the authorisation number as stored at the save, and the day of the save; for `activities`, the price-list jobs the ticked activities do not cover (job type ids) and the day of the save. The admin's part (the three ticks) is sent with the record call; the number, the uncovered jobs and the date are written by the server and refused in the request like any unknown field. Evidence is accepted only on `company`, `caen`, `rar` and `activities`, only with `ok`, `warning` or `failed`, and a `not_run` record clears it.

_From 204-rar-activities-check._

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

### 303-FR-003 — The decision use case MUST, for an `approved` decision from an actor whose role is `admin`, after the RAR and CAEN gates and inside the same transaction and row lock, read the file's six other checks and its two document kinds and refuse with 422 `note_required` (the existing shape, with a `missing` list naming each check kind not `ok` and each absent document kind, the checks in the drawer's row order, then the documents in the contracts list's order) when any of them is not `ok` or absent and the note is null after trimming; a note of 1 to 1,000 characters lets it through and is stored as the file's `reason_note` (306-FR-004's columns, unchanged). The `system` actor is exempt. `missing` is a list of `{ kind, result }` (a check not ok) and `{ document }` (an absent kind) objects, typed in the contracts library; a missing certificate yields both its document line and the `documents` check line when that check is not ok. The refusal writes no audit entry and no event and is counted and logged as the other refusals are (FR-010). Modifies 306-FR-001, which left this rule to #58.

_From 303-approve-publish-garage._

### 306-FR-002 — A decision MUST be accepted only while the file is `submitted` or `in_review`, as one conditional update on the status (unchanged); the refusal of an already decided file MUST answer 409 `verification_transition_refused` with the details `decidedBy` (the deciding admin's first name, "MotorFix" for `system`), `decidedAt` (UTC) and `currentStatus`, and the text "already decided by <name> at <time>" (modifies the refusal text of the existing guard). Two concurrent decisions on one file MUST end with exactly one committed.

_From 306-decision-record._

### 303-FR-004 — When the API does not run as production and the platform rule `skip_rar_check` reads `true`, the RAR gate of 306-FR-003 MUST be skipped for an admin's approval (the CAEN gate stays); in production the rule MUST never be read (the verification config's `testRules`, false when `APP_ENV` is `production`, the same test as the platform rules' `production` option), so the gate stands whatever a copied database holds. Modifies 306-FR-003.

_From 303-approve-publish-garage._

### 306-FR-005 — Reopening MUST be allowed from `approved`, `rejected` and `more_requested` and refused from `submitted` and `in_review` with 409 `verification_transition_refused` (unchanged); an admin's reopening MUST set `reopened_by` to the admin, `reopened_at`, reset `submitted_at`, keep the earlier decision's columns, write its audit entry and one `verification.reopened` row whose payload gains `adminId` (the account id, null for `system`) beside `fileId`, `garageId` and, when set, `reason` (modifies 207-FR-008); the garage's status and `approved_at` MUST NOT change (207-FR-003, unchanged), and no notification is built for the garage.

_From 306-decision-record._

### 306-FR-006 — The system MUST expose `POST /api/v1/admin/verification-files/{id}/decision`, taking FR-001's payload through a DTO in the contracts library validated at the edge, and `POST /api/v1/admin/verification-files/{id}/reopen` with no body; both run the use case with the signed-in admin as actor (the `admin.garages` capability, as the open call) and answer 200 with the file read's body (302-FR-001), which now carries `requested_items`; anyone who is not a MotorFix admin MUST get 404 with no garage data, no token 401, an unknown id 404. The OpenAPI document and the generated client MUST be regenerated.

_From 306-decision-record._

### 303-FR-009 — While the decision call is in flight the button MUST show a spinner (busy, named to assistive technology) and the drawer's controls stay disabled (306-FR-008); on any failure other than the two 409 kinds and 422 `note_required` the drawer MUST show the toast "Nu am putut salva decizia" and re-read the file before the controls return, so a decision that committed is shown and never sent twice; on 422 `note_required` it MUST re-read the file and open the dialog of FR-002 again with the server's `missing` list and the note required. The 409 messages of 306-FR-008 are unchanged. Modifies 306-FR-008 (the re-read on failure).

_From 303-approve-publish-garage._

### 306-FR-009 — On an `approved`, `rejected` or `more_requested` file the drawer's header MUST hold a text button "Redeschide dosarul" / "Reopen the file", at least 44 px tall and reachable by keyboard, which opens a confirmation (the `dialog` shape the problem dialog uses) reading "Redeschizi dosarul? Decizia rămâne până iei una nouă." / "Reopen the file? The decision stands until you take a new one." with "Redeschide" / "Reopen" and "Renunță" / "Cancel"; confirming calls the reopen endpoint and the drawer shows the server's answer (`in_review`, the three buttons back, the reopen button gone); a failed call shows the toast "Nu am putut redeschide dosarul" / "Could not reopen the file" and changes nothing. The button is absent on a `submitted` or `in_review` file.

_From 306-decision-record._

### 306-FR-010 — Every new text MUST live in the shared i18n files in Romanian and English; the message, the button and the dialog MUST read at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll, inside the drawer, which stays the one modal dialog (302-FR-011); the confirmation returns focus to the reopen button on cancel and to the drawer's title on success.

_From 306-decision-record._

### 306-FR-011 — The two endpoints MUST be listed in `infra/observability/inventory.json` with the API's request metrics by route, a dashboard panel and the reason no alert of their own is needed; the system MUST count decisions refused by reason (`already_decided`, `rar_check_required`, `caen_check_required`) and reopenings by actor role (`admin`, `system`) in two product counters, listed with their panel on the product dashboard and the reason a count needs no alert; the use case MUST log one line per decision (file id, decision, admin id), per refusal (file id, reason) and per reopening (file id, admin id); the inventory entries whose reason reads "no admin decision endpoint exists" (the decisions counter, VERIFICATION_RESULT) MUST be reworded now that one does.

_From 306-decision-record._

### 306-FR-012 — Tests MUST cover, in Jest on real PostgreSQL and Redis: each payload rule of FR-001 (the two 422s, the 400s); the three decisions storing their columns, the audit entry and the outbox row with `reason` and `note` in one transaction, rolled back together; `requested_items` stored and read; the 409 with the first admin's name and time; two concurrent decisions ending 200 and 409; `rar_check_required` and `caen_check_required` for each non-ok result, the OD-29 case passing, the system actor exempt; reopening from each decided state with `adminId` in the event, refused from `submitted` and `in_review`; a reopened approved garage still public with its last approved details; 404 for a driver, an owner, a receptionist and a mechanic and 401 with no token, on both endpoints; VERIFICATION_RESULT queued once per decision (the existing fan-out, verified). Web unit tests MUST cover `decide()` on success, on the two 409 kinds (the message text in both languages and the re-read) and on a failure, the note line under the decided footer, the reopen button's presence per status, the confirmation's two outcomes and the failed-reopen toast. Playwright MUST show two admin contexts on one seeded file: the first rejects through the endpoint and the second's open drawer shows "Respins de …" without a reload; the second reopens from the drawer and confirms, the buttons come back; the first approves through the endpoint (`rar` and `caen` seeded ok) and the timeline shows the rejection, the reopening and the approval, at desktop and a 320 px phone; the four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 306-decision-record._
### 204-FR-001 — The verification file MUST carry the garage's RAR authorisation number: a new nullable field, filled when the submit use case is given one (an optional argument; no shipped flow passes it yet, so a real file starts with none and an admin sets it), kept by a resend, given to the seeded files by the seed, and returned in the file read (modifies 302-FR-001). An admin MUST be able to set or correct it on an undecided file through one admin-only call: the value is normalised as step 6 normalises it, refused with 400 `validation_failed` when shorter than 3 characters or holding control characters, written with one audit entry on the file (old and new number, admin, time) and no outbox event, and shown in the timeline (302-FR-010); a decided file that was not reopened answers 409 "Dosarul e deja decis", a non-admin 404, and an unchanged value writes nothing. The garage is not told and is not asked again.

_From 204-rar-activities-check._

### 204-FR-002 — Each `rar` and `activities` check MUST carry evidence beside its result and detail, stored with the check and returned with it (extends 203-FR-001's evidence to these two kinds): for `rar`, whether the authorisation was found, whether it is for the same company, whether it is for the same address (the registered seat for a mobile mechanic), the authorisation number as stored at the save, and the day of the save; for `activities`, the price-list jobs the ticked activities do not cover (job type ids) and the day of the save. The admin's part (the three ticks) is sent with the record call; the number, the uncovered jobs and the date are written by the server and refused in the request like any unknown field. Evidence is accepted only on `company`, `caen`, `rar` and `activities`, only with `ok`, `warning` or `failed`, and a `not_run` record clears it.

_From 204-rar-activities-check._

### 204-FR-003 — A `rar` record MUST be accepted as `ok` only when the file holds a RAR number and the evidence says found, same company and same address; the server then writes the detail "aceeași firmă și adresă", or "aceeași firmă și sediu social" for a mobile mechanic, whatever detail was sent. An `ok` save that lacks a tick or a number is refused with 400 `validation_failed` naming what is missing. `warning` and `failed` keep the typed, required detail (300-FR-010) and store the ticks as sent.

_From 204-rar-activities-check._

### 204-FR-004 — An `activities` record MUST compute, on the server at the save, the garage's price-list jobs whose RAR activity is not among the sent activities, with the price list's own rule (a job with no mapped activity is covered; an empty list covers every job), and store them in the evidence. Every price row of the garage counts, whatever its status, judged by the activity rule alone. It MUST be accepted as `ok` only when at least one activity is sent and no job is uncovered (the list is still required, 300-FR-004); the server then writes the detail "toate lucrările sunt acoperite", whatever detail was sent. An `ok` save with an empty list or an uncovered job is refused with 400 `validation_failed` naming what is missing. `warning` and `failed` keep the typed, required detail. The garage's RAR activities are written as 300-FR-004 already writes them, in the same save.

_From 204-rar-activities-check._

### 204-FR-006 — The system MUST record the RAR and activities results by hand only at launch: every record of either stores `automatic = false` and calls no outside register. No `RarRegister` seam, adapter, alert, metric or retry ships with this story (owner precedent of 2026-10-17 on ST-203's `CompanyRegister`; Principle I); the automatic look-up story adds the seam together with its call site.

_From 204-rar-activities-check._

### 204-FR-007 — In the drawer, the `rar` row MUST read "Autorizație RAR găsită în registru" / "RAR authorisation found in the register", and "Autorizația RAR nu apare în registru" / "RAR authorisation not found in the register" while its result is `failed`; the `activities` row "Activitățile autorizate acoperă lista de prețuri" / "Authorised activities cover the price list" (modifies the labels of 302-FR-004 and 203-FR-006); each grey "neverificat" / "not checked" until recorded. The `rar` row MUST show the file's RAR number as stored, or "număr lipsă" / "number missing", a "Corectează" / "Correct" action on an undecided file that opens a one-field form calling FR-001, and one link "Registrul RAR" / "RAR register" opening `https://portal.rarom.ro/` in a new tab and copying the number to the clipboard with a toast "Număr RAR copiat" / "RAR number copied"; when the clipboard is unavailable the tab still opens and nothing else happens. The link is a plain link to a fixed public address with no number in it; MotorFix sends nothing to that site.

_From 204-rar-activities-check._

### 204-FR-008 — Each of the two rows MUST offer a record form while the file is undecided, in the register form's shape (203-FR-007): three buttons "OK" / "Atenție" / "Problemă", a detail field required for Atenție and Problemă (1 to 200 characters, hidden for OK since the server writes that detail), and "Resetează" / "Clear" recording `not_run` when the row has a result. The `rar` form holds the ticks "găsită" / "found", "aceeași firmă" / "same company" and "aceeași adresă" / "same address" with the workshop address beneath it, or "același sediu social" / "same registered seat" with the seat address for a mobile mechanic; when "găsită" is unticked and Problemă is chosen, the detail is proposed as "numărul introdus nu există în registrul public RAR" / "the number entered is not in the public RAR register", editable. The `activities` form is a two-column view, stacked on a phone: the file's `rar_authorisation` document on the left as the documents section already shows it (its pages or "fără autorizație încărcată" / "no authorisation uploaded"), and on the right one tick per RAR activity of the catalogue by name (pre-ticked from the garage's stored activities), with the garage's price-list jobs beneath, each marked "acoperit" / "covered" or "neacoperit" / "not covered" as the ticks change; when a job is uncovered and Atenție or Problemă is chosen, the detail is proposed as "<Job> nu apare în autorizație" / "<Job>, <Job> nu apar în autorizație" (English "<Job> is not on the authorisation" / "… are not …"), editable. OK is refused in the form with the missing tick, the missing number or the uncovered jobs named before anything is sent, and the server's refusal (FR-003, FR-004) is shown the same way when it arrives. Saving records the kind through the existing record call with the result, the detail, the evidence ticks and (for `activities`) the list.

_From 204-rar-activities-check._

### 069-FR-008 — The file read (302-FR-001) MUST include the file's reports, newest first: id, text, creation time, status, reporter (id, first name and the initial of the family name) and, when decided, the deciding admin's first name, `decided_at` and `decision_note`; the drawer MUST show them in a "Sesizări" / "Reports" part above "Documente", titled with the count of open reports ("Sesizări · <n> deschise" / "Reports · <n> open"), each row with the text, the date and time in the admin's locale and the reporter's name as a link to the admin's accounts view for that account; a file with no report shows no part. The report text and the notes MUST be shown as plain text, never as markup. A reporter whose account is deleted is shown as "Cont șters" / "Deleted account" with no link.

_From 069-report-decision._

### 204-FR-011 — The result and detail rules of a check MUST live in one layer: the relationship rules (a detail required for `warning` and `failed` and refused with `not_run`; a list, evidence or ticks only on their kind and never with `not_run`; `ok` only with its ticks, number or covered jobs; the fixed `ok` details) in the verification-checks service, and the per-field shape (types, enums, lengths, no control characters) in the DTO; the one rule checked in both is the 200-character detail length, which the service keeps for the detail it stores, so a direct caller that skips the DTO gets a 400 and never the database's 500 (Principle V); one suite covers the service's rules (#591).

_From 204-rar-activities-check._

### 204-FR-012 — Files decided before the verification-check migration MUST keep their eight back-filled `not_run` checks and their decision; no migration removes them (OD-33, 2026-10-16, #592). The capability spec records it; a test proves no migration after the verification-check migration deletes or rewrites a decided file's checks, and an integration test proves a decided file holding the back-fill's eight `not_run` checks reads them and its decision unchanged.

_From 204-rar-activities-check._

### 204-FR-013 — The five seeded RAR activity codes (mechanics, brakes, steering, suspension, air_con) stand until the lawyer's later review (owner, 2026-10-16, under the 2026-10-11 rule; a follow-up, not a gate, #578). The capability spec records that a migration replacing them must map or report every stored `GARAGE.rar_activities` value, and a migration test proves, after the migrations run, that the catalogue holds exactly those five codes and that every stored value is one of them. The seed migration's `TODO` comment stays: that migration is applied, and editing it would change its checksum on every deployed database.

_From 204-rar-activities-check._

### 204-FR-014 — Every text of the forms, rows and footer note MUST live in the shared i18n files in Romanian and English; the fixed `ok` details the server writes (FR-003, FR-004) are stored in Romanian, like every typed detail, and shown as stored in both languages; the forms MUST read at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll (the two-column view stacked under the tablet width), every state conveyed by text as well as colour, the ticks, buttons and the correction field reachable by keyboard and named for a screen reader; a form opens inside the drawer, which stays the one modal dialog (302-FR-011); opening a form moves focus to its first control and closing it returns focus to the button that opened it; a refusal is announced to assistive technology and names the control at fault; every control keeps the drawer's minimum touch target of 44 px.

_From 204-rar-activities-check._

### 204-FR-015 — The evidence shape, the file's new field and the correction call live in the contracts and domain libraries; the record call's contract and the file read are extended, not duplicated, with OpenAPI updated and the generated client regenerated. The correction route is listed in `infra/observability/inventory.json` with the API's request metrics and one log line per correction (file id, admin id), with the reason a correction needs no alert; the record route's product action (203-FR-010) already counts `rar` and `activities` by kind and result.

_From 204-rar-activities-check._

### 303-FR-001 — On an undecided file the drawer's "Aprobă și publică" / "Approve and publish" button MUST be enabled when the file's `rar` and `caen` checks are both `ok` and disabled otherwise, with one hint under the buttons: "Verificarea RAR e obligatorie" / "The RAR check is required" while `rar` is not `ok`, else "Verificarea CAEN 4520 e obligatorie" / "The CAEN 4520 check is required" while `caen` is not `ok`; the hint is text, named to assistive technology as the button's description, and absent when the button is enabled or the file is decided. The "Cere completări" and "Respinge" buttons stay disabled (#59 and the reject story wire them). The button follows the file read alone; a `skip_rar_check` test environment is served by the API (FR-004), not by the drawer.

_From 303-approve-publish-garage._

### 303-FR-002 — Pressing the enabled button MUST open an approval dialog (the `dialog` shape the problem dialog uses) titled "Aprobă și publică" / "Approve and publish" that lists, one line each, every check among `company`, `activities`, `representative`, `address`, `photos`, `documents` whose result is not `ok` (the row's label, as the drawer shows it, with the result: "neverificat" / "not checked", "atenție" / "warning", "problemă" / "failure") and every missing document kind ("Lipsește: Certificat constatator ONRC" / "Missing: ONRC company certificate", "Lipsește: Autorizația RAR" / "Missing: RAR authorisation"), or the line "Toate verificările sunt în regulă." / "Every check is ok." when the list is empty; a text area "Notă" / "Note" of at most 1,000 characters with a live count, required when the list is not empty ("Scrie de ce aprobi așa." / "Say why you approve as it is.") and optional otherwise; the buttons "Aprobă și publică" / "Approve and publish" and "Renunță" / "Cancel". Confirming with a required note empty after trimming MUST be refused in the dialog, the text area named at fault and the refusal announced. Confirming calls the existing `decide({ decision: 'approved', note })`, the note left out when empty; cancelling (the "Renunță" button or the Escape key) returns focus to the button; confirming closes the dialog at once and, while the decision call is in flight, the drawer's approve button is disabled and shows the spinner (FR-009), so one press sends one call. The dialog opens inside the drawer, which stays the one modal dialog (302-FR-011); the note is internal to MotorFix and is not sent to the garage.

_From 303-approve-publish-garage._

### 303-FR-003 — The decision use case MUST, for an `approved` decision from an actor whose role is `admin`, after the RAR and CAEN gates and inside the same transaction and row lock, read the file's six other checks and its two document kinds and refuse with 422 `note_required` (the existing shape, with a `missing` list naming each check kind not `ok` and each absent document kind, the checks in the drawer's row order, then the documents in the contracts list's order) when any of them is not `ok` or absent and the note is null after trimming; a note of 1 to 1,000 characters lets it through and is stored as the file's `reason_note` (306-FR-004's columns, unchanged). The `system` actor is exempt. `missing` is a list of `{ kind, result }` (a check not ok) and `{ document }` (an absent kind) objects, typed in the contracts library; a missing certificate yields both its document line and the `documents` check line when that check is not ok. The refusal writes no audit entry and no event and is counted and logged as the other refusals are (FR-010). Modifies 306-FR-001, which left this rule to #58.

_From 303-approve-publish-garage._

### 303-FR-004 — When the API does not run as production and the platform rule `skip_rar_check` reads `true`, the RAR gate of 306-FR-003 MUST be skipped for an admin's approval (the CAEN gate stays); in production the rule MUST never be read (the verification config's `testRules`, false when `APP_ENV` is `production`, the same test as the platform rules' `production` option), so the gate stands whatever a copied database holds. Modifies 306-FR-003.

_From 303-approve-publish-garage._

### 303-FR-005 — The garage MUST carry `last_checked_on`, a nullable calendar date, set at every approval (an admin's and the system's, a reopened file's included) to the decision time's day in Europe/Bucharest, in the same update that sets `status` and `approved_at`, and included in the garage's audit entry of that approval; nothing else in this story writes it (#248 reads it; the monthly re-check of MF-59 may write it later). Modifies 207-FR-001 (one more column) and 207-FR-003 (the approval sets it beside `approved_at`).

_From 303-approve-publish-garage._

### 303-FR-006 — The approval's audit record (306-FR-004: the file's status entry with the note, and the garage's entry of the same approval) MUST carry the list FR-003 judges, on the garage's entry as `verificationMissing`, computed for every approval (the `system` actor's included, which is exempt from the refusal, not from the record): the check kinds not `ok` with their results and the missing document kinds, empty when every check was ok; the timeline line of 302-FR-010 is unchanged. Modifies 306-FR-004.

_From 303-approve-publish-garage._

### 303-FR-007 — The file read MUST carry, on its garage part, `cuiAlsoUsedBy`: the names of the other garage rows holding the same stored CUI, whatever their status, sorted by name in Romanian collation then by id, empty when the CUI is null or held by no other garage; the drawer MUST show, in the header under the CUI, the line "CUI folosit și de alt service: {names}" / "CUI also used by another garage: {names}" in the warning colour and by text (an alert role is not used: it is a fact, not an event), and nothing of the button's state changes. Modifies the file read (204-FR-009, the latest form of 302-FR-001: one more field).

_From 303-approve-publish-garage._

### 303-FR-008 — A queue row (overview panel and "Service-uri" view) whose file is decided `approved` while the row is shown MUST keep its place for the rest of the visit with its lamp, summary and waiting line replaced by the text "Aprobat, e pe hartă" / "Approved, on the map" (the mock's wording; the garage's own status label "Aprobat, pe hartă" of 207-FR-006 is unchanged), its "Deschide dosarul" link kept, held in that queue component's own state (lost when the admin leaves the view) and outside the page size, the counts dropping as today; the queue learns it from the `verification.decided` event's `fileId` (the live message carries no outcome) by reading that file once and keeping the row when the file's status is `approved`, and its re-read (unchanged, waiting files only) leaves the decided row in place; a fresh visit lists waiting files only. A decision other than `approved` leaves the row as today (its stories own the text).

_From 303-approve-publish-garage._

### 303-FR-009 — While the decision call is in flight the button MUST show a spinner (busy, named to assistive technology) and the drawer's controls stay disabled (306-FR-008); on any failure other than the two 409 kinds and 422 `note_required` the drawer MUST show the toast "Nu am putut salva decizia" and re-read the file before the controls return, so a decision that committed is shown and never sent twice; on 422 `note_required` it MUST re-read the file and open the dialog of FR-002 again with the server's `missing` list and the note required. The 409 messages of 306-FR-008 are unchanged. Modifies 306-FR-008 (the re-read on failure).

_From 303-approve-publish-garage._

### 303-FR-010 — This story adds no endpoint, service, queue or outside call: the refusals counter of 306-FR-011 MUST gain the reason `note_required`, with one log line per refusal (file id, reason), and its inventory entry reworded to name it; `last_checked_on` and `cuiAlsoUsedBy` ride existing reads under the API's route metrics. The DTO change lives in the contracts library, the OpenAPI document and the generated client are regenerated (Principle V).

_From 303-approve-publish-garage._

### 303-FR-012 — Tests MUST exist before the code (Principle II). Jest on real PostgreSQL and Redis: 422 `note_required` for each of the six check kinds not `ok` (`not_run`, `warning`, `failed`) and for each missing document kind, with the `missing` list; the approval saved with a note in each case and without one when every check is ok and both documents present; the OD-29 case (no certificate, `caen` ok from the record) refused without a note and saved with one; the `system` actor exempt; `skip_rar_check` = true letting an approval without `rar` through outside production and ignored in production, the CAEN gate still refusing; `last_checked_on` set to the Bucharest day (a decision at 23:30 UTC on a summer day is the next day) and reset on a reopened file's second approval; the audit entry's list; `cuiAlsoUsedBy` with none, one and two other garages and with a null CUI; the public read showing the garage after approval and the `verification.decided` audiences holding `admin`, the garage, `public:garage:{id}` and `public:search`; VERIFICATION_RESULT queued once; the refusals counter's `note_required`; the existing 409 and 404 cases still passing (the existing approval tests gain a note where their checks are not ok). Web unit tests: the button enabled and disabled with each hint in both languages; the dialog's list for each non-ok check and missing document, the empty-list line, the required and optional note, the in-dialog refusal, the call with and without the note; the spinner; the re-read on a failure and on 422 with the dialog reopened; the CUI line present and absent; the queue row's state text after an approved event and its untouched row after another decision. Playwright, as the seeded admin: open Atelier Dinamo's file, record every check ok (both documents seeded), press "Aprobă și publică", confirm, see "Aprobat de …" in the footer and "Aprobat, e pe hartă" on the queue row without a reload; the garage's public read answers (404 before, 200 after) and its `last_checked_on` holds the day; at desktop and a 320 px phone (amended at implement, 2026-10-18, pending the owner's answer on #58: the driver's brand search and the owner's VERIFICATION_RESULT item are proven by the integration specs of the publish path and its audiences, not in the browser). The four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 303-approve-publish-garage._

### 069-FR-001 — The system MUST expose `POST /api/v1/admin/verification-files/{id}/report-decision` in the verification module, taking `{ decision, reason?, note? }` through a DTO in the contracts library validated at the edge: `decision` ∈ `unfounded`, `confirmed`; `reason` a trimmed string of 1 to 200 characters, read only with `confirmed`; `note` a trimmed string of at most 1,000 characters, read only with `unfounded` (the other field, when sent, is ignored and stored nowhere). A payload outside that shape MUST answer 400 `validation_failed`; `confirmed` with no reason or a blank one MUST answer 422 `reason_required` from the use case. The route MUST be admin-only, as the capability policy answers on admin routes (207-FR-010): every other actor gets 404 with no file data. An id that matches no verification file is 404 `not_found`, the same answer.

_From 069-report-decision._

### 069-FR-002 — The decision MUST be accepted only while the file is `in_review` and holds at least one `open` report, as one conditional update on the file's status; any other file MUST be refused with 409 `verification_transition_refused` as 306-FR-002 answers: a decided file with `decidedBy` (the file's deciding admin's first name), `decidedAt` (UTC) and `currentStatus`; an `in_review` file with no open report with ST-306's "already under review" refusal. Two concurrent report decisions on one file MUST end with exactly one committed.

_From 069-report-decision._

### 069-FR-004 — A `confirmed` decision MUST, inside the same transaction and before this story's own writes, suspend the garage through the ST-49 use case `suspend(garageId, 'report_confirmed', reason, actor)` (049-FR-002), so the SUSPENSION, the garage's status, its audit entry and `garage.suspended` commit with the reports; when the garage already holds an open suspension, no second one MUST be made and nothing of ST-49 written, the reports still close, and this story's audit entry MUST carry `alreadySuspended: true` and the open suspension's cause. An `unfounded` decision MUST write nothing on the garage and send nothing to it.

_From 069-report-decision._

### 069-FR-005 — The decision MUST never change the garage's listing beyond FR-004: the file returns to `approved`, never `rejected` or `more_requested`, and the garage's status is `approved` after an unfounded decision.

_From 069-report-decision._

### 069-FR-006 — `garage_report.decided` MUST reach, through the audience resolver (419-FR-006) and a new subject `garage_report`, `admin` and `account:{reporterId}` for every distinct reporter of the covered reports, and never the garage's channel; the admin queue and the drawer MUST re-read on it, as they do on `verification.decided` (302-FR-008), so the "Raportat" marker goes without a reload.

_From 069-report-decision._

### 069-FR-010 — Every new text MUST live in the shared i18n files in Romanian and English; the part, the buttons and the two dialogs MUST read at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll.

_From 069-report-decision._

### 069-FR-011 — The route MUST be listed in `infra/observability/inventory.json` with the API's request metrics by route, a dashboard panel and the reason no alert of its own is needed; the system MUST count decisions by outcome and refusals by code in the API's metrics.

_From 069-report-decision._

### 069-FR-012 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the payload rules of FR-001 (the 400s, the 422, the 404 for a non-admin); an unfounded decision closing every open report, returning the file to `approved`, writing the audit entry and the event, leaving the garage `approved` and sending nothing to its owners; a confirmed decision suspending the garage with cause `report_confirmed` and the reason in the same transaction; the confirmation on an already suspended garage closing the reports with no second suspension; the 409 for a second decision, under two concurrent calls; the 409 on a file with no open report; one GARAGE_REPORT_DECIDED per reporter with the outcome wording and no note or reason; the live re-read on `garage_report.decided`. In Playwright, end to end: a driver reports a test garage; an admin opens the file, reads the report and confirms it with a reason; the garage leaves the results and its owner sees the suspended banner.

_From 069-report-decision._

## Retired

- `207-FR-005` — superseded by `307-FR-001` (2026-10-08)

- `301-FR-005` — superseded by `302-FR-003` (2026-10-17)
- `207-FR-002` — superseded by `302-FR-002` (2026-10-17)
- `300-FR-003` — superseded by `302-FR-007` (2026-10-17)
- `300-FR-010` — superseded by `302-FR-007` (2026-10-17)

- `302-FR-007` — superseded by `203-FR-007` (2026-10-17)
- `300-FR-006` — superseded by `203-FR-004` (2026-10-17)
- `302-FR-004` — superseded by `203-FR-006` (2026-10-17)

- `207-FR-008` — superseded by `306-FR-004` (2026-10-17)
- `302-FR-009` — superseded by `306-FR-007` (2026-10-17)
- `302-FR-001` — superseded by `306-FR-006` (2026-10-17)
- `300-FR-009` — superseded by `204-FR-010` (2026-10-17)
- `302-FR-001` — superseded by `204-FR-009` (2026-10-17)
- `203-FR-006` — superseded by `204-FR-007` (2026-10-17)
- `203-FR-001` — superseded by `204-FR-002` (2026-10-17)
- `203-FR-004` — superseded by `204-FR-005` (2026-10-17)
- `300-FR-005` — superseded by `204-FR-013` (2026-10-17)

- `306-FR-001` — superseded by `303-FR-003` (2026-10-18)
- `306-FR-003` — superseded by `303-FR-004` (2026-10-18)
- `306-FR-004` — superseded by `303-FR-006` (2026-10-18)
- `306-FR-008` — superseded by `303-FR-009` (2026-10-18)
- `204-FR-009` — superseded by `303-FR-007` (2026-10-18)
- `207-FR-001` — superseded by `303-FR-005` (2026-10-18)
- `207-FR-003` — superseded by `303-FR-005` (2026-10-18)

- `204-FR-009` — superseded by `069-FR-008` (2026-10-18)
- `306-FR-007` — superseded by `069-FR-009` (2026-10-18)
- `312-FR-007` — superseded by `069-FR-003` (2026-10-18)

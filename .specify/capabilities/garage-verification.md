---
capability: garage-verification
updated: 2026-10-24
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
  - 259-approval-rules
  - 210-legal-check-panel
  - 305-reject-garage-reason
  - 304-request-garage-details
  - 069-report-decision
  - 1351-rar-monthly-recheck
  - 1354-garage-legal-checks
  - 1357-rar-covered-jobs
  - 116-listing-verification-status
  - 101-verification-progress
  - 208-resubmit-after-more
  - 068-yearly-documents
  - 067-restore-suspended-garage
  - 413-verification-file-presence
---

# Capability: Garage verification

How MotorFix keeps a garage hidden from drivers until an admin approves it: the verification file and its allowed transitions, the garage's status, the one public scope every public read of garages goes through, the status label shown to the garage, and the test-only switch that approves at once.

## Requirements

### 1351-FR-006 — An `ok` record MUST, in one transaction: store the re-check; set the garage's date of last check to the date checked; set the garage's authorised activities to the recorded set; write one audit entry on the garage by the admin with the result, the date, the activities before and after, and the detail; write one `recheck.recorded` outbox row (garageId, result); and, when the set narrowed, one `price_list.updated` outbox row for the garage. It MUST NOT itself hide, show or touch any price-list job: the hiding is #242's rule, owned by #228 on this trigger.

_From 1351-rar-monthly-recheck._

### 302-FR-002 — The system MUST expose `POST /api/v1/admin/verification-files/{id}/open`, which runs the existing open use case (207-FR-002) for the signed-in admin and answers the same body as FR-001: a `submitted` file becomes `in_review` with `opened_by` and `opened_at`, one audit entry and one `verification.opened` outbox row in the same transaction; a file already `in_review` is answered unchanged with no entry and no row; every status other than `submitted` (`in_review`, decided, `more_requested`) is answered unchanged with no transition, no entry and no row, which changes the existing use case so it no longer refuses a decided file with 409 (modifies 207-FR-002), so the drawer opens read-only; an unknown id and every non-admin get 404.

_From 302-garage-verification-file._

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

### 259-FR-002 — When the API does not run as production and automatic approval is on (the stored rule `skip_manual_approval` reads `true`, or, under `APP_ENV=test`, `SKIP_MANUAL_APPROVAL` reads `1` or `true`), a garage's sending of its listing (the submission, and the resend after more was requested) MUST approve the file at once as the `system` actor (`decided_by` null, shown as "MotorFix"), in the same transaction as the sending, when the RAR rule is met: the file's `rar` check is `ok`, or `skip_rar_check` reads `true` (FR-004's switch). The approval is the existing decision use case's: the audit entries and outbox rows of both transitions (`verification.submitted`, `verification.decided`), the garage published with `approved_at` and `last_checked_on`, the owner's VERIFICATION_RESULT from the fan-out (207-FR-009, 306-FR-004, 303-FR-005, unchanged). Modifies 207-FR-009: the stored rule turns the switch on as the variable does, the resend is covered, and the approval is conditional on the RAR rule.

_From 259-approval-rules._

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

### 1351-FR-006 — An `ok` record MUST, in one transaction: store the re-check; set the garage's date of last check to the date checked; set the garage's authorised activities to the recorded set; write one audit entry on the garage by the admin with the result, the date, the activities before and after, and the detail; write one `recheck.recorded` outbox row (garageId, result); and, when the set narrowed, one `price_list.updated` outbox row for the garage. It MUST NOT itself hide, show or touch any price-list job: the hiding is #242's rule, owned by #228 on this trigger.

_From 1351-rar-monthly-recheck._

### 204-FR-013 — The five seeded RAR activity codes (mechanics, brakes, steering, suspension, air_con) stand until the lawyer's later review (owner, 2026-10-16, under the 2026-10-11 rule; a follow-up, not a gate, #578). The capability spec records that a migration replacing them must map or report every stored `GARAGE.rar_activities` value, and a migration test proves, after the migrations run, that the catalogue holds exactly those five codes and that every stored value is one of them. The seed migration's `TODO` comment stays: that migration is applied, and editing it would change its checksum on every deployed database.

_From 204-rar-activities-check._

### 204-FR-005 — Every `rar` and `activities` record MUST keep what 300-FR-003, 300-FR-006, 300-FR-007, 300-FR-010, 300-FR-011 and 203-FR-004 already give the record call: `recorded_by` and `recorded_at` set, `automatic = false`, one audit entry whose old and new values carry the result, the detail, the evidence and (for `activities`) the list, the `verification.check_recorded` event in the outbox in the same transaction, `price_list.updated` when the list changes, 409 "Dosarul e deja decis" on a decided file that was not reopened, and 404 for anyone but a MotorFix admin. This story adds no second write path.

_From 204-rar-activities-check._

### 1354-FR-007 — While the owner's dashboard is open, `garage.suspended` arriving on `garage:{garageId}` MUST make the panel read again, as `recheck.recorded` and the verification events do today (210-FR-011); and the session MUST re-read on `recheck.recorded` as it does on `garage.suspended` (049-FR-012), so the strip's date follows. This story MUST add no event, sender, audience or channel: `recheck.recorded` and `garage.suspended` already reach the channel (1351-FR-013, 049-FR-007); `garage.restored` (#106) and `document.*` (ST-68) add their re-reads with their senders. Modifies 210-FR-011 (the kinds the panel re-reads on).

_From 1354-garage-legal-checks._

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

### 068-FR-014 — The outbox events `document.due` (one per reminder sent: garageId, stage ∈ 30, 7, 0, dueOn), `document.overdue`, `document.uploaded`, `document.accepted` and `document.refused` MUST be written with their change (Constitution VI) and reach, through the audience resolver, `garage:{garageId}` and `admin` (`document.uploaded` keeps its admin-only audience for a listing's documents and gains the garage channel for a renewal). `garage.suspended` stays #209's and #97's.

_From 068-yearly-documents._

### 068-FR-008 — A `LEGAL_DOCUMENT` row's status MUST be one of `valid`, `in_review`, `refused` (`valid` stays the default the listing attach writes, 206-FR-013), and the rows MUST also hold `decided_by`, `decided_at`, `refusal_reason` and `refusal_note` (empty for a listing document). At most one `in_review` row and at most one `valid` unreplaced row MUST exist per kind and file (the existing one-current index is kept for `valid` rows and a second partial index covers `in_review`). The verification file read (302-FR-005) MUST list, per kind, the current `valid` document as today and, when present, the `in_review` or latest `refused` document with its issue date, page count, upload time and decision.

_From 068-yearly-documents._

### 206-FR-014 — `GET /api/v1/admin/verification-files/{id}/documents/{documentId}/pages/{n}/download-url` MUST answer a MotorFix admin an address signed for 5 minutes (422-FR-006, `DOWNLOAD_URL_MINUTES`), inline, for page `n` (a whole number from 1 to the number of pages the document holds) of that document, with a file name `<kind>-<n>.<ext>` and its expiry; a signed-in staff member (owner, receptionist, mechanic) of the file's garage MUST get 403 with a stable code; any other actor, an unknown file, document or page, MUST get 404 (no session: 401 `sign_in_required`, as every route); no address is issued on 403 or 404. Every issued address MUST write one audit entry with action `open`, subject `legal_document`, the document id, the page number, the actor and the garage id, in the same transaction as the read that resolved the document.

_From 206-documents-declaration._

### 067-FR-001 — The SUSPENSION record (049-FR-001) MUST also hold who lifted it (`lifted_by`, an admin's account; empty while open) and the lift note (`lift_note`, 1 to 1,000 characters or empty), added by a migration that leaves every existing row open; `until_time` is set by the restore and only by it. The database rule of at most one open suspension per garage stays; an ended suspension keeps `until_time` ≥ `from_time`, an invariant of the single writer asserted by tests, not a new database constraint.

_From 067-restore-suspended-garage._

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
### 068-FR-011 — The admin verification queue (301-FR-001) MUST also list every garage with a legal document `in_review`, as a row of kind "Documente anuale" / "Yearly documents" (the row DTO gains `item: 'verification' | 'documents'`), oldest upload first among the files waiting, lamp amber, red when the garage's cycle is `overdue` and its grace has ended or the garage is `suspended`; the one count of files waiting (301-FR-006) MUST include them (a garage whose verification file is itself waiting shows as that file's row only); the row opens the garage's drawer (302-FR-003) at the "Documente" part. Every active admin MUST be notified once per upload with ADMIN_VERIFICATION_QUEUED naming the garage and "documente anuale" (301-FR-010's type and channels, one event id per upload). The queue and the drawer MUST re-read on `document.uploaded`, `document.accepted`, `document.refused` and `document.overdue` arriving on the `admin` stream.

_From 068-yearly-documents._

### 301-FR-002 — Each row MUST carry the file id and status, the garage id and name, its area (the town recorded for the garage, or for a mobile mechanic its service radius in km), the count of brands the garage works on, the count of its mechanics (absent when the garage's team-mechanics switch is off), the checks' summary line in Romanian and English and its lamp colour (from 300-FR-008 and 300-FR-009: red when any check failed, amber when any check is a warning, green when at least one check is ok and none is a warning or failure, grey when nothing is recorded), the time of its latest sending, the working days it has waited and whether it is flagged; when flagged, the server's `lamp` is amber unless a check failed (red wins).

_From 301-verification-queue._

### 301-FR-003 — The time of a file's latest sending MUST be stored on the file (`submitted_at`): set when the garage sends the file, reset when it sends the file again after more was requested and reset when an admin reopens a decided file; files sent before this change take their creation time.

_From 301-verification-queue._

### 301-FR-004 — Working days MUST be counted in Europe/Bucharest as Monday to Friday minus Romania's legal holidays (the `public_holiday` table): the days after the sending day on which the sending's wall-clock time has passed; a file is flagged when it has waited more than VERIFICATION_TARGET_WORKING_DAYS = 2 working days, so a Monday 10:00 sending is flagged from Thursday 10:01 with "așteaptă de 3 zile lucrătoare" / "waiting 3 working days" ("1 zi lucrătoare" / "1 working day" in the singular).

_From 301-verification-queue._

### 067-FR-009 — The admin MUST reach the restore from two places, both opening the same dialog: the button "Repune pe hartă" / "Put back on the map" (text alternative "Repune pe hartă {name}") on every row of the "Service-uri suspendate" panel that carries an open suspension (066-FR-007, which left the button to this story), beside "Deschide dosarul"; and in the file drawer's header when the garage is `suspended`, which needs the file read (302-FR-001) to carry the garage's latest suspension (`suspension`: cause, reason, fromTime, untilTime, liftedBy name, note; absent when the garage never was suspended). The dialog (the overlays' dialog pattern, as the re-check record dialog) MUST name the garage, the cause's state text as the list reads it (066-FR-004), the reason and "din {date}"; show, for `recheck_failed`, the admin re-check form (1351-FR-011) with the result fixed to "Valabilă", the date filled with today and the activities pre-ticked from the garage's current set, and no failure choice; for `documents_overdue`, the documents' state line ("Documente anuale valabile" / "Yearly documents valid" when the accept answer or the file's cycle reads `due`, else "Documentele anuale nu sunt toate valabile" with the confirm button disabled); for every cause a note field with a 1,000-character counter, required for `admin` and `report_confirmed` ("Scrie ce s-a rezolvat" / "Say what was fixed" when empty) and labelled optional otherwise; and the buttons "Repune pe hartă" and "Renunță" / "Cancel". While the call is in flight the confirm button is disabled and shows a busy state, so a double press sends one restore; a network failure or a 5xx is shown in the dialog as "Nu am putut repune service-ul pe hartă. Încearcă din nou." / "Could not put the garage back on the map. Try again." with the input kept and the call retryable (a retry after a commit the answer never reached ends in `garage_already_restored` naming the same admin, shown as in the next sentence). A 409 or 422 MUST be shown in the dialog with the server's message, the dialog staying open with the admin's input kept, except `garage_already_restored` and `garage_not_suspended`, which close it after showing the message and make the list or the file re-read. On 200 the dialog closes, the list and the counts re-read (the live event also re-reads them), and the drawer's header reads the ended suspension. After an acceptance in the drawer's "Documente" part (068-FR-012) whose answer carries `suspendedFor: documents_overdue` and a cycle in state `due`, the part MUST offer "Repune pe hartă" in the same step, opening this dialog; the suspension line stays otherwise.

_From 067-restore-suspended-garage._

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

### 1351-FR-010 — The admin view "Service-uri" MUST show the list "Reverificări RAR" / "RAR re-checks" between the verification queue and the suspended garages: each row the garage's name, its RAR number, the date of last check in the language's format and the days since ("28 de zile" / "28 days"); overdue rows show the days in red with "depășit" / "overdue"; an empty list shows "Nicio reverificare de făcut azi" / "No re-checks to do today". The list MUST re-read on `recheck.recorded`, `garage.suspended` and `garage.restored` over the `admin` channel so a recorded row leaves every admin's open list without a reload.

_From 1351-rar-monthly-recheck._

### 1351-FR-007 — A `failed` record MUST, in one transaction: store the re-check and suspend the garage through the existing suspension use case (049-FR-002) with cause `recheck_failed` and the reason "Autorizație RAR expirată · {detail}" (or "suspendată", "retrasă"), trimmed to 200 characters, so its SUSPENSION, status change, audit entry, `garage.suspended` row and everything downstream (#97, #204) happen as defined there; write the re-check's own audit entry and `recheck.recorded` row. It MUST NOT move the date of last check or the activities. A refusal by the suspension (409) MUST roll back the re-check, while the suspension's own refused-attempt audit entry is still written, as #97 defines.

_From 1351-rar-monthly-recheck._

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

### 204-FR-007 — In the drawer, the `rar` row MUST read "Autorizație RAR găsită în registru" / "RAR authorisation found in the register", and "Autorizația RAR nu apare în registru" / "RAR authorisation not found in the register" while its result is `failed`; the `activities` row "Activitățile autorizate acoperă lista de prețuri" / "Authorised activities cover the price list" (modifies the labels of 302-FR-004 and 203-FR-006); each grey "neverificat" / "not checked" until recorded. The `rar` row MUST show the file's RAR number as stored, or "număr lipsă" / "number missing", a "Corectează" / "Correct" action on an undecided file that opens a one-field form calling FR-001, and one link "Registrul RAR" / "RAR register" opening `https://portal.rarom.ro/` in a new tab and copying the number to the clipboard with a toast "Număr RAR copiat" / "RAR number copied"; when the clipboard is unavailable the tab still opens and nothing else happens. The link is a plain link to a fixed public address with no number in it; MotorFix sends nothing to that site.

_From 204-rar-activities-check._

### 302-FR-006 — The manual checks MUST be four rows, in this order and mapped to these kinds: `address` "Adresa din documente e cea de pe profil" / "The address in the documents matches the profile" (mobile mechanic: "Adresa din documente e sediul social de pe profil" / "The address in the documents is the registered seat on the profile"); `photos` "Fotografiile sunt ale atelierului" / "The photos show the actual workshop" (mobile mechanic: "Fotografiile arată duba sau trusa mobilă și sculele principale" / "The photos show the van or mobile kit and main tools"); `representative` "Telefon confirmat prin apel" / "Phone confirmed by call"; `documents` "Documentele sunt complete și lizibile" / "The documents are complete and readable". Each row is a checkbox (checked when the result is `ok`), a "Marchează o problemă" / "Mark a problem" button, and, when the result is `warning` or `failed`, its lamp and detail; the `documents` checkbox is disabled with "Lipsește un document" / "A document is missing" while a kind is missing; every control is at least 44 px tall and reachable by keyboard.

_From 302-garage-verification-file._

### 413-FR-008 — The drawer MUST show, under its title and above the header, a banner naming the other admins present, read from the presence answer; it MUST re-read presence (FR-002) when `presence.changed` arrives with its own `fileId`, on every reconnect of the live stream, and at every heartbeat; a message about another file causes no re-read; with an empty list the banner is not rendered. The drawer's existing file re-read (302-FR-008) is unchanged.

_From 413-verification-file-presence._

### 069-FR-009 — On a file `in_review` with at least one `open` report the drawer's footer MUST show "Sesizare nefondată" / "Report unfounded" and "Sesizare confirmată" / "Report confirmed" in place of the three decision buttons, each at least 44 px tall and reachable by keyboard. "Sesizare nefondată" MUST open a confirmation dialog with one optional note field (at most 1,000 characters, "Notă internă" / "Internal note", counted) and send `unfounded`; "Sesizare confirmată" MUST open a dialog with one required reason field (1 to 200 characters, "Motivul pe care îl vede service-ul" / "The reason the garage will see", counted) and the line "Service-ul va fi suspendat și va primi acest motiv." / "The garage will be suspended and receive this reason.", and send `confirmed`; the dialogs MUST refuse to send outside those limits and show the server's 409 as the drawer's existing red line (306-FR-008). On success the drawer MUST show the decided state.

_From 069-report-decision._

### 302-FR-010 — The read of FR-001 MUST include the file's timeline: the audit entries whose subject is the file, one of its checks or one of its documents and whose action is one of the file's sending, opening, decision, reopening or resending, a check record, or a document `open` (a document upload and the declaration write are left out, on the server), newest first, at most 50 of those with their total, each with action, field, old and new values, actor's first name ("MotorFix" for `system`), reason text and time; the drawer MUST render each as one line in the admin's language and Europe/Bucharest as US4 scenario 1 lists, and "și încă <n>" / "and <n> more" past 50. The refused approvals of 259-FR-005 are among its entries (259-FR-006).

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

### 203-FR-008 — After a save, the row MUST show only the server's answer: the lamp, the detail, the ticks of a `caen` check as stored (each as text, "certificat · ONRC · adresă" or the English equivalents, with a missing certificate read as "fără certificat" / "no certificate"), the recorder's name and the time; the queue line is updated from the answer's summary (300-FR-009): "CUI verificat" on a `company` ok, "CUI <detail>" on a warning or failure. On a failure the form keeps what was typed and ticked and a toast reads "Nu am putut salva verificarea" / "Could not save the check"; on 409 `verification_file_decided` the drawer re-reads the file and turns read-only (as 302-FR-007). Another admin's open drawer refreshes the rows through the existing `verification-file:{fileId}` live update (302-FR-009), with no new channel.

_From 203-company-caen-check._

### 203-FR-009 — Every text of the forms and rows MUST live in the shared i18n files in Romanian and English; the fixed `ok` details the server writes (FR-002, FR-003) are stored in Romanian, like every typed detail, and shown as stored in both languages; the forms MUST read at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll, every state conveyed by text as well as colour, the ticks and buttons reachable by keyboard and named for a screen reader; the row's record form opens inside the drawer, which stays the one modal dialog (302-FR-011). Opening a form moves focus to its first control and closing it returns focus to the button that opened it; a refusal (a missing name or tick, a server error) is announced to assistive technology and names the control at fault; every control keeps the drawer's minimum touch target of 44 px.

_From 203-company-caen-check._

### 203-FR-010 — The evidence shape and the register seam live in the contracts and domain libraries; the record call's contract is extended, not duplicated, with OpenAPI updated and the generated client regenerated. The product action "verification check recorded" MUST be counted by kind and result and logged once per record with the file id, the kind, the result and the admin id, listed in `infra/observability/inventory.json` with the record route, its dashboard panel and the reason a count needs no alert of its own; the record route joins the API's request metrics by route.

_From 203-company-caen-check._

### 303-FR-003 — The decision use case MUST, for an `approved` decision from an actor whose role is `admin`, after the RAR and CAEN gates and inside the same transaction and row lock, read the file's six other checks and its two document kinds and refuse with 422 `note_required` (the existing shape, with a `missing` list naming each check kind not `ok` and each absent document kind, the checks in the drawer's row order, then the documents in the contracts list's order) when any of them is not `ok` or absent and the note is null after trimming; a note of 1 to 1,000 characters lets it through and is stored as the file's `reason_note` (306-FR-004's columns, unchanged). The `system` actor is exempt. `missing` is a list of `{ kind, result }` (a check not ok) and `{ document }` (an absent kind) objects, typed in the contracts library; a missing certificate yields both its document line and the `documents` check line when that check is not ok. The refusal writes no event and is counted and logged as the other refusals are (FR-010); an admin's refusal leaves its one audit entry, written after the rollback (259-FR-005). Modifies 306-FR-001, which left this rule to #58.

_From 303-approve-publish-garage._

### 306-FR-002 — A decision MUST be accepted only while the file is `submitted` or `in_review`, as one conditional update on the status (unchanged); the refusal of an already decided file MUST answer 409 `verification_transition_refused` with the details `decidedBy` (the deciding admin's first name, "MotorFix" for `system`), `decidedAt` (UTC) and `currentStatus`, and the text "already decided by <name> at <time>" (modifies the refusal text of the existing guard). Two concurrent decisions on one file MUST end with exactly one committed.

_From 306-decision-record._

### 259-FR-004 — When the API does not run as production and the platform rule `skip_rar_check` reads `true`, an admin's approval MUST skip both the RAR gate and the CAEN gate of 306-FR-003 (today the RAR gate only); the note rule of 303-FR-003 stays as it is: it covers the guide checks and the documents, never `rar` and `caen`, so a lifted gate owes no note. The rule is read per decision inside the decision's transaction, never in production (FR-001). Modifies 303-FR-004.

_From 259-approval-rules._

### 306-FR-005 — Reopening MUST be allowed from `approved`, `rejected` and `more_requested` and refused from `submitted` and `in_review` with 409 `verification_transition_refused` (unchanged); an admin's reopening MUST set `reopened_by` to the admin, `reopened_at`, reset `submitted_at`, keep the earlier decision's columns, write its audit entry and one `verification.reopened` row whose payload gains `adminId` (the account id, null for `system`) beside `fileId`, `garageId` and, when set, `reason` (modifies 207-FR-008); the garage's status and `approved_at` MUST NOT change (207-FR-003, unchanged), and no notification is built for the garage.

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

### 204-FR-003 — A `rar` record MUST be accepted as `ok` only when the file holds a RAR number and the evidence says found, same company and same address; the server then writes the detail "aceeași firmă și adresă", or "aceeași firmă și sediu social" for a mobile mechanic, whatever detail was sent. An `ok` save that lacks a tick or a number is refused with 400 `validation_failed` naming what is missing. `warning` and `failed` keep the typed, required detail (300-FR-010) and store the ticks as sent.

_From 204-rar-activities-check._

### 204-FR-004 — An `activities` record MUST compute, on the server at the save, the garage's price-list jobs whose RAR activity is not among the sent activities, with the price list's own rule (a job with no mapped activity is covered; an empty list covers every job), and store them in the evidence. Every price row of the garage counts, whatever its status, judged by the activity rule alone. It MUST be accepted as `ok` only when at least one activity is sent and no job is uncovered (the list is still required, 300-FR-004); the server then writes the detail "toate lucrările sunt acoperite", whatever detail was sent. An `ok` save with an empty list or an uncovered job is refused with 400 `validation_failed` naming what is missing. `warning` and `failed` keep the typed, required detail. The garage's RAR activities are written as 300-FR-004 already writes them, in the same save.

_From 204-rar-activities-check._

### 204-FR-006 — The system MUST record the RAR and activities results by hand only at launch: every record of either stores `automatic = false` and calls no outside register. No `RarRegister` seam, adapter, alert, metric or retry ships with this story (owner precedent of 2026-10-17 on ST-203's `CompanyRegister`; Principle I); the automatic look-up story adds the seam together with its call site.

_From 204-rar-activities-check._

### 204-FR-008 — Each of the two rows MUST offer a record form while the file is undecided, in the register form's shape (203-FR-007): three buttons "OK" / "Atenție" / "Problemă", a detail field required for Atenție and Problemă (1 to 200 characters, hidden for OK since the server writes that detail), and "Resetează" / "Clear" recording `not_run` when the row has a result. The `rar` form holds the ticks "găsită" / "found", "aceeași firmă" / "same company" and "aceeași adresă" / "same address" with the workshop address beneath it, or "același sediu social" / "same registered seat" with the seat address for a mobile mechanic; when "găsită" is unticked and Problemă is chosen, the detail is proposed as "numărul introdus nu există în registrul public RAR" / "the number entered is not in the public RAR register", editable. The `activities` form is a two-column view, stacked on a phone: the file's `rar_authorisation` document on the left as the documents section already shows it (its pages or "fără autorizație încărcată" / "no authorisation uploaded"), and on the right one tick per RAR activity of the catalogue by name (pre-ticked from the garage's stored activities), with the garage's price-list jobs beneath, each marked "acoperit" / "covered" or "neacoperit" / "not covered" as the ticks change; when a job is uncovered and Atenție or Problemă is chosen, the detail is proposed as "<Job> nu apare în autorizație" / "<Job>, <Job> nu apar în autorizație" (English "<Job> is not on the authorisation" / "… are not …"), editable. OK is refused in the form with the missing tick, the missing number or the uncovered jobs named before anything is sent, and the server's refusal (FR-003, FR-004) is shown the same way when it arrives. Saving records the kind through the existing record call with the result, the detail, the evidence ticks and (for `activities`) the list.

_From 204-rar-activities-check._

### 067-FR-010 — The record of the suspension MUST say when it ended and who lifted it: the file header reads "Suspendat din {date}" / "Suspended since {date}" while open and "Suspendat {from} – {until} · repus pe hartă de {name}" / "Suspended {from} – {until} · put back on the map by {name}" (dates in the admin's language, Europe/Bucharest; the year once when both dates share it) once ended, with the note under it when there is one; the timeline (302-FR-010) shows the `garage_restored` entry with the cause lifted, the evidence, the note and the admin, beside the suspension's own entry; the audit entry is the record's source and the header its summary.

_From 067-restore-suspended-garage._

### 204-FR-011 — The result and detail rules of a check MUST live in one layer: the relationship rules (a detail required for `warning` and `failed` and refused with `not_run`; a list, evidence or ticks only on their kind and never with `not_run`; `ok` only with its ticks, number or covered jobs; the fixed `ok` details) in the verification-checks service, and the per-field shape (types, enums, lengths, no control characters) in the DTO; the one rule checked in both is the 200-character detail length, which the service keeps for the detail it stores, so a direct caller that skips the DTO gets a 400 and never the database's 500 (Principle V); one suite covers the service's rules (#591).

_From 204-rar-activities-check._

### 204-FR-012 — Files decided before the verification-check migration MUST keep their eight back-filled `not_run` checks and their decision; no migration removes them (OD-33, 2026-10-16, #592). The capability spec records it; a test proves no migration after the verification-check migration deletes or rewrites a decided file's checks, and an integration test proves a decided file holding the back-fill's eight `not_run` checks reads them and its decision unchanged.

_From 204-rar-activities-check._

### 204-FR-014 — Every text of the forms, rows and footer note MUST live in the shared i18n files in Romanian and English; the fixed `ok` details the server writes (FR-003, FR-004) are stored in Romanian, like every typed detail, and shown as stored in both languages; the forms MUST read at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll (the two-column view stacked under the tablet width), every state conveyed by text as well as colour, the ticks, buttons and the correction field reachable by keyboard and named for a screen reader; a form opens inside the drawer, which stays the one modal dialog (302-FR-011); opening a form moves focus to its first control and closing it returns focus to the button that opened it; a refusal is announced to assistive technology and names the control at fault; every control keeps the drawer's minimum touch target of 44 px.

_From 204-rar-activities-check._

### 204-FR-015 — The evidence shape, the file's new field and the correction call live in the contracts and domain libraries; the record call's contract and the file read are extended, not duplicated, with OpenAPI updated and the generated client regenerated. The correction route is listed in `infra/observability/inventory.json` with the API's request metrics and one log line per correction (file id, admin id), with the reason a correction needs no alert; the record route's product action (203-FR-010) already counts `rar` and `activities` by kind and result.

_From 204-rar-activities-check._

### 304-FR-001 — On an undecided file the drawer's "Cere completări" / "Ask for more" button MUST be enabled, whatever the checks' results, disabled while a decision call is in flight or the file is decided, and at least 44 px tall; pressing it MUST open the dialog of FR-002 and never send a decision by itself. The "Respinge" / "Reject" button keeps its rule: enabled on an undecided file whatever the checks' results, disabled while a decision call is in flight or the file is decided, at least 44 px tall, opening the reject dialog of 305-FR-002 and never sending a decision by itself. The "Aprobă și publică" / "Approve and publish" button keeps its rule: enabled when the file's `rar` and `caen` checks are both `ok` and disabled otherwise, with one hint under the buttons, "Verificarea RAR e obligatorie" / "The RAR check is required" while `rar` is not `ok`, else "Verificarea CAEN 4520 e obligatorie" / "The CAEN 4520 check is required" while `caen` is not `ok`; the hint is text, named to assistive technology as the button's description, and absent when the button is enabled or the file is decided; the button follows the file read alone, a `skip_rar_check` test environment being served by the API (259-FR-004), not by the drawer. Modifies 305-FR-001 (the ask button is wired; the reject and approve rules are restated above, unchanged).

_From 304-request-garage-details._

### 303-FR-002 — Pressing the enabled button MUST open an approval dialog (the `dialog` shape the problem dialog uses) titled "Aprobă și publică" / "Approve and publish" that lists, one line each, every check among `company`, `activities`, `representative`, `address`, `photos`, `documents` whose result is not `ok` (the row's label, as the drawer shows it, with the result: "neverificat" / "not checked", "atenție" / "warning", "problemă" / "failure") and every missing document kind ("Lipsește: Certificat constatator ONRC" / "Missing: ONRC company certificate", "Lipsește: Autorizația RAR" / "Missing: RAR authorisation"), or the line "Toate verificările sunt în regulă." / "Every check is ok." when the list is empty; a text area "Notă" / "Note" of at most 1,000 characters with a live count, required when the list is not empty ("Scrie de ce aprobi așa." / "Say why you approve as it is.") and optional otherwise; the buttons "Aprobă și publică" / "Approve and publish" and "Renunță" / "Cancel". Confirming with a required note empty after trimming MUST be refused in the dialog, the text area named at fault and the refusal announced. Confirming calls the existing `decide({ decision: 'approved', note })`, the note left out when empty; cancelling (the "Renunță" button or the Escape key) returns focus to the button; confirming closes the dialog at once and, while the decision call is in flight, the drawer's approve button is disabled and shows the spinner (FR-009), so one press sends one call. The dialog opens inside the drawer, which stays the one modal dialog (302-FR-011); the note is internal to MotorFix and is not sent to the garage.

_From 303-approve-publish-garage._

### 303-FR-004 — When the API does not run as production and the platform rule `skip_rar_check` reads `true`, the RAR gate of 306-FR-003 MUST be skipped for an admin's approval (the CAEN gate stays); in production the rule MUST never be read (the verification config's `testRules`, false when `APP_ENV` is `production`, the same test as the platform rules' `production` option), so the gate stands whatever a copied database holds. Modifies 306-FR-003.

_From 303-approve-publish-garage._

### 303-FR-008 — A queue row (overview panel and "Service-uri" view) whose file is decided `approved` while the row is shown MUST keep its place for the rest of the visit with its lamp, summary and waiting line replaced by the text "Aprobat, e pe hartă" / "Approved, on the map" (the mock's wording; the garage's own status label "Aprobat, pe hartă" of 207-FR-006 is unchanged), its "Deschide dosarul" link kept, held in that queue component's own state (lost when the admin leaves the view) and outside the page size, the counts dropping as today; the queue learns it from the `verification.decided` event's `fileId` (the live message carries no outcome) by reading that file once and keeping the row when the file's status is `approved`, and its re-read (unchanged, waiting files only) leaves the decided row in place; a fresh visit lists waiting files only. A decision other than `approved` leaves the row as today (its stories own the text).

_From 303-approve-publish-garage._

### 303-FR-010 — This story adds no endpoint, service, queue or outside call: the refusals counter of 306-FR-011 MUST gain the reason `note_required`, with one log line per refusal (file id, reason), and its inventory entry reworded to name it; `last_checked_on` and `cuiAlsoUsedBy` ride existing reads under the API's route metrics. The DTO change lives in the contracts library, the OpenAPI document and the generated client are regenerated (Principle V).

_From 303-approve-publish-garage._

### 303-FR-012 — Tests MUST exist before the code (Principle II). Jest on real PostgreSQL and Redis: 422 `note_required` for each of the six check kinds not `ok` (`not_run`, `warning`, `failed`) and for each missing document kind, with the `missing` list; the approval saved with a note in each case and without one when every check is ok and both documents present; the OD-29 case (no certificate, `caen` ok from the record) refused without a note and saved with one; the `system` actor exempt; `skip_rar_check` = true letting an approval without `rar` through outside production and ignored in production, the CAEN gate still refusing; `last_checked_on` set to the Bucharest day (a decision at 23:30 UTC on a summer day is the next day) and reset on a reopened file's second approval; the audit entry's list; `cuiAlsoUsedBy` with none, one and two other garages and with a null CUI; the public read showing the garage after approval and the `verification.decided` audiences holding `admin`, the garage, `public:garage:{id}` and `public:search`; VERIFICATION_RESULT queued once; the refusals counter's `note_required`; the existing 409 and 404 cases still passing (the existing approval tests gain a note where their checks are not ok). Web unit tests: the button enabled and disabled with each hint in both languages; the dialog's list for each non-ok check and missing document, the empty-list line, the required and optional note, the in-dialog refusal, the call with and without the note; the spinner; the re-read on a failure and on 422 with the dialog reopened; the CUI line present and absent; the queue row's state text after an approved event and its untouched row after another decision. Playwright, as the seeded admin: open Atelier Dinamo's file, record every check ok (both documents seeded), press "Aprobă și publică", confirm, see "Aprobat de …" in the footer and "Aprobat, e pe hartă" on the queue row without a reload; the garage's public read answers (404 before, 200 after) and its `last_checked_on` holds the day; at desktop and a 320 px phone (amended at implement, 2026-10-18, pending the owner's answer on #58: the driver's brand search and the owner's VERIFICATION_RESULT item are proven by the integration specs of the publish path and its audiences, not in the browser). The four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 303-approve-publish-garage._

### 259-FR-001 — Neither test-only switch MUST have any effect when the API runs as production: the stored rules `skip_manual_approval` and `skip_rar_check` MUST never be read there (the verification configuration's `testRules`, false when `APP_ENV` is `production`, the one guard of 303-FR-004, now covering both keys), `SKIP_MANUAL_APPROVAL` MUST keep counting only under `APP_ENV=test` (207-FR-009), and the rules API MUST keep answering 404 for both keys and listing neither (258-FR-003, 258-FR-004, unchanged). A stored `true` for either key in production MUST change nothing: no automatic approval, both gates standing.

_From 259-approval-rules._

### 259-FR-003 — When automatic approval is on and the RAR rule is not met, or the garage is `suspended`, the sending MUST commit as it does today, the file staying `submitted` (its sending's audit entry and outbox row written, no decision), and an admin approves it by hand later; one log line MUST say the automatic approval waited, with the file id and the cause (`rar_check_required`, or `garage_suspended` for a suspended garage); nothing is counted as a refusal and no audit entry is written for it. The sending MUST never be refused because of the automatic approval.

_From 259-approval-rules._

### 259-FR-005 — Every admin's approval that the policy refuses, 409 `rar_check_required`, 409 `caen_check_required` or 422 `note_required`, MUST leave one audit entry: subject the verification file, actor the admin (id, role, first name), action `update` with kind `verification_approval_refused` (the audit's free `kind` column, no schema change), the refusal's code as its new value, the garage's id, written by the decision use case's owner of the transaction (the endpoint's wrapper hands the refusal to the verification service, which writes the entry in a fresh transaction) after the decision's transaction rolled back, so the file, its decision columns and the garage are unchanged while the attempt is kept; the refusal's answer, counter and log line are unchanged (306-FR-011). No event and no notification follow, and the garage's reads are unchanged. A failed write of the entry is logged and does not change the answer. The `system` actor, a decision already taken (`verification_transition_refused`), the suspended garage's refusal and the edge's validation errors write none. Modifies 303-FR-003 (its "the refusal writes no audit entry" is replaced for an admin's refusal) and 390-FR-001 is untouched: the entry is a change of its own, committed in its own transaction.

_From 259-approval-rules._

### 259-FR-006 — The file's timeline (302-FR-010) MUST include the refusal entries of FR-005 among the file's entries, newest first and within the 50 and the total, each read with its kind, value, actor's first name and time; the drawer MUST render each as one line "Aprobare refuzată: {motiv} — {name}, {when}" / "Approval refused: {reason} — {name}, {when}", the reason being "verificarea RAR nu e în regulă" / "the RAR check is not ok" for `rar_check_required`, "verificarea CAEN 4520 nu e în regulă" / "the CAEN 4520 check is not ok" for `caen_check_required`, "lipsește nota" / "the note is missing" for `note_required`, and the code itself for one the drawer has no words for; the texts live in the shared admin i18n files in Romanian and English, and the line wraps and reads at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll, inside the drawer. Modifies 302-FR-010 (one more kind of entry in the timeline).

_From 259-approval-rules._

### 259-FR-007 — This story adds no endpoint, service, queue, outside call, counter or inventory entry: the automatic approval rides the existing decision counter and log line (`by system`), the refusals keep their counter and log lines (306-FR-011), FR-003 adds one log line, and FR-005's entry is one more row of the audit history, which has its own capability. The DTO of the file read is unchanged (the timeline's entry shape already carries kind and values), so no contract or generated client changes.

_From 259-approval-rules._

### 259-FR-008 — Tests MUST exist before the code (Principle II). Jest on real PostgreSQL and Redis: production (`testRules` false) with both rules stored `true` and `SKIP_MANUAL_APPROVAL=true`: a submission waits and the two gates refuse; the rules API in production lists neither key and answers 404 for both (existing tests kept); outside production, each switch alone and together, for a submission and for a resend: `skip_manual_approval` on with `skip_rar_check` on approves at once as `system` (both audit entries, both outbox rows, the garage published), with `skip_rar_check` off waits (the file `submitted`, no refusal counted, the log line), a resend with `rar` recorded `ok` approves, a suspended garage's resend waits; the variable under `APP_ENV=test` with the stored rule `false` approves under the same condition, and under `development` is ignored; `skip_rar_check` on lets an admin approve with `rar` and `caen` not `ok` and no note when the guide checks and documents are in order, still refuses 422 `note_required` for a guide check not `ok` without a note, and off holds both gates (the existing "still holds the approval on the caen check" test inverted); each of the three refusals writes exactly one `verification_approval_refused` entry with the admin's id, role and name and the code, the file and garage rows unchanged, a second attempt a second entry; the `system` approval and the already-decided refusal write none; the timeline read returns the entry newest first and within the 50. Web unit tests: the history line for each of the three codes and for an unknown code, in both languages. Playwright, in the end-to-end stack (`APP_ENV=test`), on a file seeded waiting with no check recorded (nothing in the stack sends a listing yet: no endpoint calls the sending use case, plan research R5, so the automatic approval at sending is proven by the Jest cases above): as the admin read both rules `false` through the rules API; approve the file through the API without the RAR check and see 409 and, in the drawer, the refusal line first in the history and the approve button disabled with the RAR hint (305-FR-001), at desktop and 320 px. The RAR switch is not turned on there: it is one platform-wide value and the suite's other workers approve files under the gate it would lift, so its effect on an admin's approval is proven by the Jest cases above. The four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 259-approval-rules._

### 210-FR-001 — The API MUST serve the garage's legal check panel to the garage's `owner` only, at a garage-scoped read: 403 to a `receptionist` or `mechanic` of that garage, 404 to anyone without a membership there (another garage's staff, a driver, an admin, an unknown or malformed garage id); every route needs a session (no `@Public()`).

_From 210-legal-check-panel._

### 1354-FR-001 — The owner's legal panel read (`GET /api/v1/garages/{garageId}/legal-check`) MUST answer for a garage whose own status is `approved` or `suspended`, and 404 when the garage is `draft` or has no verification file; the owner-only rule stays (403 to a receptionist or mechanic of the garage, 404 to anyone else, 210-FR-001). Modifies 210-FR-002 (`suspended` no longer answers 404).

_From 1354-garage-legal-checks._

### 1354-FR-002 — The answer MUST carry, besides ST-210's fields, the garage's status (`approved` or `suspended`) and its latest re-check (by `recorded_at`) or null: the Europe/Bucharest day checked, the result (`ok` or `failed`), the failure (`expired`, `suspended`, `withdrawn`, or null) and the recorded detail (null on `ok`). The suspension's cause and reason are not repeated here; the session carries them (049-FR-012). Modifies 210-FR-003 (two fields added).

_From 1354-garage-legal-checks._

### 068-FR-005 — The documents row of the legal panel (210-FR-004) MUST read, by the cycle: `due` with both documents `valid` and nothing in review — green, "de reîncărcat o dată pe an, până în <lună an>" / "upload again once a year, by <Mon yyyy>" ("ian. 2027" / "Jan 2027"; amber when the due date is 30 days or fewer away); a document `in_review` — amber, "în verificare" / "under review"; `overdue` with nothing in review — red, "restante din <zi>, profilul iese de pe hartă pe <zi>" / "overdue since <day>, the profile leaves the map on <day>" (the day after `grace_until`); a kind `refused` and not re-uploaded — red, "refuzat: <notă>" / "refused: <note>". The owner MUST see the button "Încarcă documentele" / "Upload the documents" on the row whenever no document is `in_review`; the legal panel stays owner-only (210-FR-001), so a receptionist or mechanic sees neither. Every state of the row is conveyed by text, not colour alone, and the row and its button read at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll (as FR-012 requires of the drawer). `document.overdue`, `document.accepted` and `document.refused` (and `document.uploaded`, so another device of the owner shows the review) arriving on `garage:{garageId}` MUST make the panel read again without a reload, as the verification events do today (210-FR-011).

_From 068-yearly-documents._

### 1354-FR-005 — The "Profil verificat" strip (owner and receptionist of an `approved` garage, 210-FR-005) MUST show under its tag the line "Autorizația RAR, reverificată pe {day}" / "RAR authorisation, re-checked on {day}" (or "verificată pe" / "checked on" by FR-003's rule), the day as day and short month without the year, "1 oct." / "1 Oct", in Europe/Bucharest; no line when the stored date is empty. The signed-in person's garage entry in the session MUST carry the stored date of last check and whether a valid re-check has been recorded since it was set, so the strip needs no second read and the receptionist sees the same line. While the garage is `suspended` the strip stays hidden and the banner of 049-FR-012 carries the reason. Modifies 210-FR-005 (the strip gains the date line).

_From 1354-garage-legal-checks._

### 1354-FR-004 — When the garage's status is `suspended` the panel's tag MUST read "Suspendat" / "Suspended" in red instead of "Verificat"; when, in addition, the open suspension's cause is `recheck_failed`, the RAR row MUST be red, built from the latest re-check (the one recorded last), with state "problemă" / "problem", its detail "expirată pe {day}" / "expired on {day}", "suspendată pe {day}" / "suspended on {day}" or "retrasă pe {day}" / "withdrawn on {day}" by the failure, followed by " · " and the recorded detail, and its checked line "reverificată pe {day}", {day} being that re-check's day checked in every text of this row. For any other cause the four rows are as for an approved garage. Modifies 210-FR-006 (the tag and the RAR row gain the suspended case).

_From 1354-garage-legal-checks._

### 210-FR-007 — The CAEN row's detail MUST read "…, la sediul social" / "…, at the registered seat" for a mobile mechanic and "…, la punctul de lucru" / "…, at the workshop address" otherwise.

_From 210-legal-check-panel._

### 210-FR-008 — Dates in the panel MUST be shown as "1 oct. 2026" in Romanian and "1 Oct 2026" in English, as the Europe/Bucharest calendar day.

_From 210-legal-check-panel._

### 1354-FR-003 — The RAR row's day MUST be the garage's stored date of last check (`GARAGE.last_checked_on`, set by the approval, 303-FR-005, and moved by a valid re-check, 1351-FR-006), read as stored and never computed from the checks or the re-checks, on every row but FR-004's failure row; its detail line stays the garage's recorded activities (`GARAGE.rar_activities`, rewritten by a valid re-check) in the garage's order, else "în registrul RAR"; its checked line reads "reverificată pe {day}" / "re-checked on {day}" when the latest re-check (the one recorded last) is `ok` and not older than the stored date, else "verificată pe {day}" / "checked on {day}". Modifies 210-FR-009 (the `rar` check's recorded day is no longer read).

_From 1354-garage-legal-checks._

### 210-FR-010 — While the panel read is in flight the panel MUST show a skeleton of four rows, busy to assistive technology; on a failure it MUST show "Nu am putut încărca verificarea" / "We could not load the check" and a "Încearcă din nou" / "Try again" button that sends the read again.

_From 210-legal-check-panel._

### 210-FR-012 — The panel MUST be one reusable component taking its data and states as inputs, so the profile view (#236) can place it without a second copy.

_From 210-legal-check-panel._

### 210-FR-013 — The panel read MUST ship with its observability: a request counter and latency by outcome, its log line on a refusal, the dashboard panel and alert or the reason for none, listed in `infra/observability/inventory.json`.

_From 210-legal-check-panel._

### 210-FR-014 — Tests MUST cover the row mapping for each result, the documents row, the mobile wording, the date formats, the owner/receptionist/mechanic/outsider answers, the `check_recorded` audience, and one end-to-end flow: approve a test garage, sign in as its owner, see the four green rows and the "Verificat" tag.

_From 210-legal-check-panel._
### 305-FR-002 — The reject dialog (the `dialog` shape the approval dialog uses) MUST be titled "Respinge dosarul" / "Reject the file" and hold, in this order: a required radio group "Motivul" / "Reason" with five options mapped to these codes, "Documente" / "Documents" → `documents`, "Autorizația RAR" / "The RAR authorisation" → `rar`, "Adresa" / "The address" → `address`, "Fotografiile" / "The photos" → `photos`, "Altceva" / "Something else" → `other`, none selected on open; a required text area "Mesaj pentru service" / "Message to the garage" with a live count of code points out of 1,000 and the hint "Service-ul primește mesajul cuvânt cu cuvânt." / "The garage receives the message word for word."; a "Renunță" / "Cancel" button and a "Respinge" / "Reject" confirm button in the danger style. Confirm MUST send nothing and keep the dialog open while no option is selected ("Alege un motiv." / "Pick a reason."), while the note is blank after trimming ("Scrie un mesaj pentru service." / "Write a message to the garage.") or shorter than 10 code points ("Mesajul are cel puțin 10 caractere." / "The message is at least 10 characters.") or longer than 1,000, marking the field with the message as its description and moving focus to it; on a valid form it MUST close with the code and the trimmed note, and the drawer sends `{ decision: 'rejected', reason, note }` through the existing decision call, one request per confirm. A second press of "Respinge" while the dialog is open opens no second dialog.

_From 305-reject-garage-reason._

### 305-FR-003 — The decision use case MUST, for a `rejected` decision, require a reason among `documents`, `rar`, `address`, `photos`, `other` and a note of 10 to 1,000 code points after trimming, refusing with 422 `reason_required` (field `reason`) when the reason is absent, 422 `note_required` (field `note`) when the note is null after trimming and 422 `note_too_short` (field `note`) when it holds 1 to 9 code points (a note over 1,000 is refused 400 `validation_failed` at the edge, as today), each in the existing 422 shape, before any row is locked, nothing stored; a reason code outside the five MUST be refused 400 `validation_failed` at the edge as today. When several fields fail, the first refusal in this order wins: `reason_required`, then `note_required`, then `note_too_short`; the dialog marks the first failing field in the same order. Only the three 422 codes are counted in the refusals counter; an edge 400 is not (the edge runs before the use case). An accepted rejection MUST store `status` `rejected`, `reason_code`, `reason_note` (the trimmed note), `decided_by` and `decided_at`, leave the garage's `status` `draft` and write the file's audit entry (who, when, reason, note) and the `verification.decided` outbox row (`decision: 'rejected'`, reason, note) in the same transaction (303-FR-006, unchanged). The approval's note rule (1 to 1,000, 303-FR-003) and the request for more are unchanged. Extends 303-FR-003 (the rejection's note floor beside the approval's rule).

_From 305-reject-garage-reason._

### 305-FR-004 — A rejection MUST obey the decision guard (306-FR-002: 409 `verification_transition_refused` with `decidedBy`, `decidedAt`, `currentStatus` on a decided file; one of two concurrent rejections committed) and the access rule (306-FR-006: 404 for every non-admin, no garage data); both MUST be covered by this story's tests for the `rejected` outcome. Nothing in those rules changes.

_From 305-reject-garage-reason._

### 305-FR-005 — The accepted rejection MUST reach the garage's owners as VERIFICATION_RESULT (rejected) by e-mail, push and bell through the existing fan-out, the e-mail's "Motiv:" line carrying the stored reason's label in the owner's language and its "Nota:" line the note exactly as stored, unmutable (`always`); the templates are unchanged and this story's tests MUST prove the reason label and the note in the queued e-mail.

_From 305-reject-garage-reason._

### 304-FR-006 — A queue row (overview panel and "Service-uri" view) whose file is decided `rejected` or `more_requested` while the row is shown MUST keep its place for the rest of the visit, its lamp, summary and waiting line replaced by text: "Respins" / "Rejected" in the destructive text colour for a rejection, "Cerute completări" / "More details requested" in the muted text colour for a request for more; its "Deschide dosarul" link kept, held in the queue component's own state as an approved row is, the counts dropping by one; the queue learns it from the `verification.decided` event by reading that file once and keeping the row when its status is `rejected` or `more_requested`; a fresh visit lists waiting files only, and a re-read that returns the same file waiting replaces the kept row (one row per file). Modifies 305-FR-006 (a `more_requested` row is kept, not dropped; the rejected row's rule is restated above, unchanged).

_From 304-request-garage-details._

### 305-FR-007 — While the rejection call is in flight the drawer's "Respinge" button MUST show a spinner (busy, named to assistive technology) and the drawer's decision controls stay disabled; on 409 the drawer MUST show "Deja decis de {name} la {time}" and re-read the file; on 422 `reason_required`, `note_required` or `note_too_short` the drawer MUST re-open the dialog holding the entered reason and note with the named field marked as in FR-002; on any other failure the drawer MUST show the toast "Nu am putut salva decizia" and re-read the file before the controls return, so a rejection that committed is shown and never sent twice; on success the drawer MUST show the decided footer "Respins de {name}, {when}" with the reason label and the note, and focus move to the drawer's title. Extends 303-FR-009 (the rejection's outcomes).

_From 305-reject-garage-reason._

### 305-FR-008 — When a file whose `previous_file_id` points to a `rejected` file is opened, the drawer MUST show, above the checks, "Respins anterior: {reason}, {when}" / "Rejected before: {reason}, {when}" with the earlier file's reason label, its note and its decision date, the latest earlier rejection when the garage was rejected more than once; the line is text, not an alert; this story's tests MUST prove it against a rejection made by FR-003 and a new file linked by 207-FR-004, and that no second garage row exists after the rejection. The rendering is built (302); the requirement names what the tests hold it to.

_From 305-reject-garage-reason._

### 305-FR-009 — The rejection MUST be observable as a product action: a product counter `motorfix_verification_rejections_total` by `reason` (the five codes) incremented once per stored rejection beside the decisions counter's `rejected`; the refusals counter of 306-FR-011 gaining the reasons `reason_required` and `note_too_short`; one log line per rejection (file id, admin id, reason; never the note) and per refusal (file id, reason) under the existing `Verification` logger; the decision request's span carrying `verification.decision` = `rejected` and `verification.reason` as attributes; a panel on the product dashboard "Rejections by reason, 30 days" beside the decisions panel; an alert "Rejection burst" firing when more than 5 rejections are counted in 60 minutes, to the owner's contact point; every one of them listed in `infra/observability/inventory.json` (`scripts/observability-inventory.ts` passes), the decisions counter's entry reworded to name the rejections counter. Extends 306-FR-011 and 303-FR-010 (the refusals counter's reasons, the inventory wording).

_From 305-reject-garage-reason._

### 305-FR-011 — Tests MUST exist before the code (Principle II), with `// @traces` lines naming this feature's FR ids. Jest on real PostgreSQL and Redis: each of the five reason codes accepted and stored; an unknown code refused 400 `validation_failed`; `reason_required`, `note_required` and `note_too_short` (9 code points, a note of spaces, 10 accepted, 1,000 accepted, 1,001 refused 400 at the edge), nothing stored; the garage `draft` after the rejection and absent from the public scope; the audit entry and the outbox row with reason and note; the owner's VERIFICATION_RESULT with the reason label and the note; 409 from the guard after an approval and after a rejection, two concurrent rejections ending one committed; 404 for a garage owner, a receptionist and a mechanic, 401 `sign_in_required` for no token (the app-wide guard answers before the route); a new file linked by `previous_file_id` read with `previousRejection` and one garage row; the rejections counter by reason and the refusals counter's two new reasons. Jest on the dialog: five options, required marks, the 10 and 1,000 bounds in code points, close with code and trimmed note, cancel with nothing; the drawer: the dialog opened by the button, the decision sent once, the 409, 422 and failure paths of FR-007, focus moves; the queue: a rejected row kept with "Respins" and a `more_requested` row dropped. Playwright (`web-e2e`, on demand and at release, not per PR): an admin rejects the seeded file with "Autorizația RAR" and a note, the queue reads "Respins", the owner's test inbox has the reason and the note. The PR QA sweep's screenshots cover the dialog at the four sizes, both schemes and languages.

_From 305-reject-garage-reason._

### 304-FR-002 — The dialog (the `dialog` shape the reject dialog uses) MUST be titled "Ce lipsește?" / "What is missing?" and hold, in this order: a required text area labelled "Ce lipsește?" / "What is missing?" with a live count of the trimmed note's code points out of 1,000 and the hint "Service-ul primește mesajul cuvânt cu cuvânt." / "The garage receives the message word for word."; an optional group of five ticks "Privește" / "It concerns" mapped to these codes, "Documente" / "Documents" → `documents`, "Autorizația RAR" / "The RAR authorisation" → `rar`, "Adresa" / "The address" → `address`, "Fotografiile" / "The photos" → `photos`, "Altceva" / "Something else" → `other`, none ticked on open; a "Renunță" / "Cancel" button and a "Trimite cererea" / "Send the request" confirm button. Confirm MUST send nothing and keep the dialog open while the note is blank after trimming ("Scrie ce lipsește." / "Write what is missing.") or under 10 code points ("Cel puțin 10 caractere." / "At least 10 characters.") or over 1,000 ("Mesajul are cel mult 1000 de caractere." / "The message is at most 1000 characters."; the text area has no `maxlength`, so a pasted note is never cut), marking the field and moving focus to it; otherwise it MUST close with the trimmed note and the ticked codes, and the drawer sends `decision: 'more_requested'` with them. Cancel and Escape MUST close with nothing sent and return focus to the "Cere completări" button.

_From 304-request-garage-details._

### 304-FR-003 — The decision use case MUST, for a `more_requested` decision, keep requiring a note (422 `note_required`, field `note`, when blank after trimming) and MUST refuse with 422 `note_too_short` (field `note`) a note of 1 to 9 code points, in the existing 422 shape, before any row is locked, nothing stored; `note_required` wins over `note_too_short`. A note over 1,000 code points and an item outside the five stay refused 400 `validation_failed` at the edge, as today. Extends 305-FR-003 (`note_too_short` now covers a request for more too) and 306-FR-001.

_From 304-request-garage-details._

### 304-FR-004 — A request for more MUST obey the decision guard (306-FR-002: 409 `verification_transition_refused` with `decidedBy`, `decidedAt`, `currentStatus` on a decided file; one of two concurrent decisions committed) and the access rule (306-FR-006: 404 for every non-admin, no garage data), and MUST leave the garage `draft` with every profile field, price, brand, photo and document it entered unchanged; all three MUST be covered by this story's tests for the `more_requested` outcome. Nothing in those rules changes.

_From 304-request-garage-details._

### 304-FR-005 — The accepted request MUST reach the garage's owners as VERIFICATION_RESULT (more_requested) by e-mail, push and bell through the existing fan-out, the e-mail's "Nota:" line carrying the note exactly as stored, unmutable (`always`); the template's wording is #145's and is unchanged; this story's tests MUST prove the note in the queued e-mail and that the owner's preferences cannot mute it.

_From 304-request-garage-details._

### 304-FR-007 — The queue read's row and the file read MUST carry `resubmitted` (true for a file whose status is `submitted` or `in_review`, whose `decided_at` is set and whose `reopened_at` is unset or earlier than `decided_at`, which only the resend of a `more_requested` file leaves; false otherwise, so a reopened file and a file never asked for more are not resubmitted) and, when true, `requestedAt`, the file's `decided_at`; both derived at read time, never stored. A row with `resubmitted` MUST show the tag "Actualizat" / "Updated" after the garage's name, as text, at least 20 px tall; the tag MUST appear when the resend's `verification.submitted` event re-reads the queue, and the count rises by one, within the live update. Extends 301-FR-002 and 302-FR-001.

_From 304-request-garage-details._

### 304-FR-008 — The system MUST expose `GET /api/v1/admin/verification-files/{id}/changes`, admin-only (404 with no garage data for every other role, 401 `sign_in_required` without a session, 404 for an unknown file), answering the file's `resubmitted`, `requestedAt` and `changes`: the audit entries of that garage written after `requestedAt` whose subject is the garage's profile (`garage`, `garage_facility`, `garage_closed_day`), its brands (`garage_brand`), its prices (`garage_price`, `garage_brand_job`), its photos or its legal documents, leaving out entries flagged internal and entries about the verification file, its checks, accounts, notifications and the request itself; each change carrying its area (`profile`, `prices`, `brands`, `photos`, `documents`), the subject kind, the field, the old and new value as stored, the action and the time; newest first, at most 200 with `total`; `changes` empty with `resubmitted` false. Reading MUST write no audit entry and MUST reach PostgreSQL only (Principle VI); the OpenAPI document describes it and the generated client includes it (Principle V).

_From 304-request-garage-details._

### 304-FR-009 — When the open file's `resubmitted` is true the drawer MUST call FR-008's read beside the file read and render, above the checks, a panel titled "Ce s-a schimbat" / "What changed" with the line "de la cererea din {date}" / "since the request of {date}", listing the changes grouped in the order profile, prices, brands, photos, documents: one line per changed profile field or price with "{label}: {old} → {new}"; one line per counted kind for photos and brands with "{label}: {before} → {after}" (the current count from the file read, the earlier one worked back from the entries); one line per document kind with "înlocuit" / "replaced", "adăugat" / "added" or "șters" / "removed"; a value the panel cannot render, and a counted line when `total` exceeds 200, reads "{label}: modificat" / "{label}: changed"; a field without a label of its own reads by its stored name; more than 200 changes end with "și încă {n} modificări" / "and {n} more changes", in the language's plural forms ("și încă 1 modificare" / "and 1 more change", "și încă 20 de modificări"). With no changes the panel MUST read "Nicio modificare înregistrată de la cerere" / "No change recorded since the request". While the read is on its way the panel shows a skeleton; when it fails it MUST read "Nu am putut încărca modificările" / "Could not load the changes" with a "Reîncearcă" / "Retry" button, and every other part of the drawer, the decision controls included, MUST stay usable. With `resubmitted` false no panel and no read.

_From 304-request-garage-details._

### 304-FR-011 — While the request call is in flight the drawer's "Cere completări" button MUST show a spinner (busy, named to assistive technology) and the drawer's decision controls stay disabled; on 409 the drawer MUST show "Deja decis de {name} la {time}" and re-read the file; on 422 `note_required` or `note_too_short` the drawer MUST re-open the dialog holding the entered note and ticks with the note marked as in FR-002; on any other failure the drawer MUST show the toast "Nu am putut salva decizia" and re-read the file before the controls return, so a request that committed is shown and never sent twice; on success the drawer MUST show the decided footer "Completări cerute de {name}, {when}" with the note and the ticked items' labels, and focus move to the drawer's title. Extends 303-FR-009 and 305-FR-007 (the request's outcomes).

_From 304-request-garage-details._

### 304-FR-012 — The two product actions MUST be observable: a product counter `motorfix_verification_more_requests_total` incremented once per stored request beside the refusals counter (306-FR-011, whose `note_required` and `note_too_short` now count a request's refusals too), and `motorfix_verification_resubmissions_total` incremented once per committed resend; one log line per request (file id, admin id, the ticked codes; never the note) and per resend (file id) under the existing `Verification` logger; the decision request's span carrying `verification.decision` = `more_requested` and `verification.requested_items` (the codes joined by a comma); a panel "Requests for more and files returned, per hour" on the product dashboard beside the rejections panel; an alert "Request-for-more burst" firing when more than 5 requests are counted in 60 minutes, to the owner's contact point; the new endpoint of FR-008 under the API's request metrics by route with the API-wide error and latency rules; every one of them, and the reason the resubmissions counter needs no alert, listed in `infra/observability/inventory.json` (`scripts/observability-inventory.ts` passes).

_From 304-request-garage-details._

### 304-FR-014 — Tests MUST exist before the code (Principle II), with `// @traces` lines naming this feature's FR ids. Jest on real PostgreSQL and Redis: `note_required` for a blank note and a note of spaces, `note_too_short` at 9 code points, 10 and 1,000 accepted, 1,001 refused 400 at the edge, nothing stored on a refusal; each of the five items stored once, duplicates collapsed, no items accepted; the garage `draft` with its profile, prices, brands, photos and documents unchanged after the request; the audit entry and the outbox row with the note; the owner's VERIFICATION_RESULT with the note and unmutable; 409 from the guard after an approval, a rejection and a request, two concurrent decisions ending one committed; 404 for an owner, a receptionist, a mechanic and a driver, 401 with no token, for the decision and for the changes read; the waiting count one lower after the request and one higher after the resend; `resubmitted` true and `requestedAt` after a resend, false for a never-asked file, a reopened file and a decided file; the changes read listing only entries after the request, only the five areas, no internal entry, the 200 cap and `total`, empty for a never-asked file, the latest request after two cycles; the new audit entries of FR-010; the two counters, the span attributes and the log lines. Jest for the browser: the dialog's refusal, count, focus and close values; the drawer's spinner, the 409, the 422 re-open, the footer; the queue's kept "Cerute completări" row and the "Actualizat" tag on a live re-read; the panel's grouping, lines, empty, loading and failed states. Playwright, run on demand and at release: ask for photos as the admin; as the owner add photos and resend (no resend route exists until ST-208 ships it: the Jest tests drive the verification service's existing resend transition directly against PostgreSQL, and the Playwright setup performs it through the database, an `UPDATE` of the file and an outbox row, as `verification-queue.spec.ts` seeds files); as the admin see "Actualizat" and the change list.

_From 304-request-garage-details._
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

### 1351-FR-001 — A garage MUST be due for a RAR re-check exactly when its status is `approved` and its date of last check is 28 or more calendar days (Europe/Bucharest) before today, or empty; it MUST be overdue when that date is more than 31 days before today, or empty. A suspended, draft or waiting garage is never due. The approval's date (303-FR-005) counts as the first check.

_From 1351-rar-monthly-recheck._

### 1351-FR-002 — The system MUST store one re-check per record with: the garage, kind `rar`, the date checked, the result (`ok` or `failed`), for a failure which of `expired`, `suspended`, `withdrawn`, the detail (1 to 200 characters, required for a failure and refused for `ok`), the activities recorded (for `ok`), whether it was automatic (always no at launch, as the verification checks of 300-FR-003), who recorded it and when.

_From 1351-rar-monthly-recheck._

### 1351-FR-003 — The system MUST expose an admin-only read of the due list: one row per due garage with its id, name, RAR authorisation number (the newest verification file's, or empty when the garage has none, shown "număr lipsă" / "number missing"), date of last check, days since (whole calendar days), and whether it is overdue, ordered by date of last check ascending with empty dates first, then by name. It MUST write nothing. Non-admins get 404.

_From 1351-rar-monthly-recheck._

### 1351-FR-004 — The system MUST expose an admin-only record call per garage taking: the result, the date checked, the activities (for `ok`), the detail, and the date of last check the admin's row showed. Validated at the edge (Principle V): the date checked is a calendar date not after today in Europe/Bucharest and strictly after the garage's date of last check (any date up to today when that is empty), else 422 naming the field; the detail follows FR-002 (a detail with `ok` is 422); the activities MUST be a subset of the garage's current authorised activities (a wider set is 422 with the message of US1 scenario 6) and each a known RAR activity code. Non-admins get 404.

_From 1351-rar-monthly-recheck._

### 1351-FR-005 — The record MUST be refused with 409, nothing written, checking in this order (the garage row locked for the whole check): first a carried date of last check that differs from the garage's (`recheck_conflict` or `recheck_stale`, so a second admin learns who recorded), then a garage not approved or not due (FR-001, `recheck_not_due`). When a valid (`ok`) re-check newer than the carried date exists, the 409 (code `recheck_conflict`) MUST name its recorder (first name and initial, as the audit does) and its time in Europe/Bucharest, with the date added when it was not today, so the client shows "Deja reverificat de {name} la {time}" or "… pe {date} la {time}"; when none exists (the date moved some other way), a plain 409 with code `recheck_stale` and "Datele service-ului s-au schimbat. Reîncarcă lista." / "The garage's details changed. Reload the list.".

_From 1351-rar-monthly-recheck._

### 1351-FR-006 — An `ok` record MUST, in one transaction: store the re-check; set the garage's date of last check to the date checked; set the garage's authorised activities to the recorded set; write one audit entry on the garage by the admin with the result, the date, the activities before and after, and the detail; write one `recheck.recorded` outbox row (garageId, result); and, when the set narrowed, one `price_list.updated` outbox row for the garage. It MUST NOT itself hide, show or touch any price-list job: the hiding is #242's rule, owned by #228 on this trigger.

_From 1351-rar-monthly-recheck._

### 1351-FR-007 — A `failed` record MUST, in one transaction: store the re-check and suspend the garage through the existing suspension use case (049-FR-002) with cause `recheck_failed` and the reason "Autorizație RAR expirată · {detail}" (or "suspendată", "retrasă"), trimmed to 200 characters, so its SUSPENSION, status change, audit entry, `garage.suspended` row and everything downstream (#97, #204) happen as defined there; write the re-check's own audit entry and `recheck.recorded` row. It MUST NOT move the date of last check or the activities. A refusal by the suspension (409) MUST roll back the re-check, while the suspension's own refused-attempt audit entry is still written, as #97 defines.

_From 1351-rar-monthly-recheck._

### 1351-FR-011 — Each row MUST open a record dialog reusing the file drawer's RAR record form (the register link, the number on the clipboard; 204-FR-007) and its activities list (300-FR-004's picker): the result choice (Valabilă, Expirată, Suspendată, Retrasă), the date checked filled with today, the activities pre-ticked from the garage's current set, and, on a failure, the required detail field with its 200-character counter; a failure MUST ask the confirmation of US2 scenario 2 before saving. The 409 of FR-005 and the 422s of FR-004 MUST be shown in the dialog with the server's message, the dialog staying open with the admin's input kept (a 409 also makes the list re-read).

_From 1351-rar-monthly-recheck._

### 1351-FR-012 — Every re-check MUST leave one audit entry on the garage (FR-006, FR-007) so the garage's timeline shows each re-check with its result, activities before and after, and detail, by the admin who recorded it.

_From 1351-rar-monthly-recheck._

### 1351-FR-014 — The two endpoints MUST be REST with OpenAPI, their DTOs in the contracts library validated at the edge, the generated client regenerated; the re-check, the due rule and the record use case live in the domain's verification module beside the suspension; the new endpoints and the morning task are listed in the observability inventory with their dashboard and alerts.

_From 1351-rar-monthly-recheck._

### 1351-FR-015 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the due list at 27, 28 and 32 days, with an empty date, and excluding suspended and unapproved garages; an `ok` record moving the date and the activities with its audit entry and outbox rows, `price_list.updated` only on a narrowing; a wider set refused 422; a failure storing the re-check and the suspension in one transaction and rolling both back on the suspension's 409; the 409 of a second admin naming the first; 404 for a non-admin; the date rules; ADMIN_RECHECK_DUE once per day only when the count is above zero, and not to an admin who muted it. End to end (Playwright): seed a garage checked 29 days ago, record it as valid as an admin and see the owner's legal panel date change; record another as expired and see it leave the search results.

_From 1351-rar-monthly-recheck._

### 1354-FR-006 — Under the four rows the panel MUST show the note "Reverificăm lunar autorizația în registrul RAR. Dacă e suspendată sau retrasă, profilul iese de pe hartă până se rezolvă." / "We re-check the authorisation in the RAR register every month. If it is suspended or withdrawn, the profile comes off the map until that is fixed.", in the signed-in language, wrapping with no sideways scroll at 320 px.

_From 1354-garage-legal-checks._

### 1354-FR-008 — Dates MUST be shown in Europe/Bucharest: in the rows as "12 sept. 2026" / "12 Sep 2026" (210-FR-008, 019-FR-005); on the strip as "1 oct." / "1 Oct".

_From 1354-garage-legal-checks._

### 1354-FR-009 — The story MUST write nothing (no audit entry, no event, no field written) and add no endpoint, table, service, queue or outside call; the two answer fields (and the RAR row's optional `failure`, set only on FR-004's failure row so the panel needs no inference from the suspension's cause, which is not answered) and the session's two fields live in the contracts library's DTOs, the OpenAPI document and the generated client are regenerated with them (Principle V); the panel read's existing observability entry stands (210-FR-013).

_From 1354-garage-legal-checks._

### 1354-FR-010 — Tests MUST exist before the code (Principle II). Jest, unit: the RAR row's day and line for an approval-only garage and after an `ok` re-check; the suspended tag and the three failure texts; the dates in both languages; the strip's line in both languages and its absence without a date. Jest on real PostgreSQL and Redis: the read answers for a `suspended` garage with its status and the failed re-check recorded through the re-check use case, 404 for `draft` and for an outsider, 403 for the receptionist, and the session's garage entry carries the date and the re-check flag for the owner and the receptionist. Web unit: the panel re-reads on `garage.suspended` and the session on `recheck.recorded`. Playwright: with the owner's dashboard open, record a valid re-check as the seeded admin in another session and see the strip's date and the RAR row change without a reload. The four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 1354-garage-legal-checks._

### 1357-FR-003 — The admin's verification file MUST show, in its register section, the line "Activitățile autorizate acoperă lista de prețuri" / "Authorised activities cover the price list" with the recorded result's lamp and, when the record left jobs uncovered, "Neacoperite: {jobs}" / "Not covered: {jobs}" naming each by its catalogue name in the admin's language, as the shipped `activities` row does (verification-file.ts:300-316, 905-917); the server keeps computing the uncovered set at the save (204-FR-004). The story adds the test that pins it and changes no screen.

_From 1357-rar-covered-jobs._

### 1357-FR-004 — An `activities` record of any result that carries a list MUST keep writing the garage's list and saving one `price_list.updated` event for the garage's public audience in the same transaction (verification-checks.service.ts:406-420), and an `ok` re-check that narrows the list MUST keep doing the same (recheck.service.ts:394-401); no second path, column or event is added. The open profile and the owner's Prețuri re-read in place on that event, as they do for every `price_list.*` event today.

_From 1357-rar-covered-jobs._

### 116-FR-012 — When the normalised step-6 CUI equals the CUI of any garage (whatever its status or its file's) or of another open draft, the send MUST go through and the file MUST carry a warning "CUI folosit deja de: {name}" naming the other listing (the garage's name, or the other draft's step 1 name), stored on the file and shown to admins in the file's drawer header (302) and the queue line ("CUI {detail}", 300-FR-009 style); never a refusal.

_From 116-listing-verification-status._

### 208-FR-001 — The status read (`GET /api/v1/garages/{garageId}/verification`, 116-FR-014) MUST carry, for a `more_requested` file, the admin's note as stored (the file's `reason_note`, exposed as the DTO field `note`, contracts/completion.md) beside the requested items, and never the internal approval note or the reason of a decision other than the current one; 403 for a receptionist or mechanic and 404 outside the garage stay. Modifies 116-FR-014.

_From 208-resubmit-after-more._

### 101-FR-002 — The strip MUST show the sending date with the first stage, "Trimis · 2 mart. 2027" / "Submitted · 2 Mar 2027" (the i18n library's fixed short months, `formatDay`), from `submittedAt` in Europe/Bucharest, in the interface language's short-month form, wherever it is given one (this page and `ListingStatus`); a read with no `submittedAt`, and the just-sent summary, show the stage name alone. Modifies 116-FR-015 (the strip gains an optional date).

_From 101-verification-progress._

### 116-FR-016 — While the status view is open, `verification.opened`, `verification.decided` and `verification.reopened` arriving on the owner's stream for the garage MUST make the view read the status again (no reload); on every reconnect the view reads it again (255-FR-004). No event, audience or channel is added: the verification events already reach the garage's channel.

_From 116-listing-verification-status._

### 116-FR-021 — When the status read fails (network, 5xx), the view keeps the stage it shows, says in one line that it could not refresh, and offers "Reîncearcă" / "Retry"; the next event or reconnect reads again. On first load with no stage yet, it shows that line and the retry only.

_From 116-listing-verification-status._

### 101-FR-003 — For `more_requested` the page MUST list the requested items under "Cerute completări" with the existing `public.verificationStatus.items.*` labels, in the order the admin chose. The "Completează" button and the form it opens are #32's, not this story's: no button and no test for it here.

_From 101-verification-progress._

### 101-FR-004 — For `rejected` the page MUST show "Respins" with the reason's label from the same item labels and the admin's note as written (116-FR-015), and a button "Contactează MotorFix" / "Contact MotorFix" that opens the dashboard's contact overlay (the shell's `CONTACT` action, #166). The admin's internal approval note MUST never be in the status response or on the page (116-FR-014 unchanged).

_From 101-verification-progress._

### 101-FR-005 — `verification.opened`, `verification.decided` and `verification.reopened` for the garage, and every reconnect of the live stream, MUST make the page read the status again within 5 seconds, without a reload; events arriving in a burst coalesce into one read and the newest answer is the one shown (116-FR-016; no event, audience or channel is added, the verification events already reach `garage:{garageId}`).

_From 101-verification-progress._

### 101-FR-006 — `verification.decided` on the garage's channel MUST also make the shell read the session again, so an approval swaps the page for the full dashboard and shows the menu within 5 seconds, as `garage.suspended` does today, and keyboard focus lands on Panou's `h1` rather than being lost with the removed page; the shell's own re-read on every reconnect covers a decision the stream missed, so the page never reads the session itself.

_From 101-verification-progress._

### 101-FR-008 — Only the garage's `owner` reads the status; a `receptionist` or `mechanic` of a draft garage sees the title and the two lines, no strip and no status call (the route answers them 403, 116-FR-014 unchanged). Anyone outside the garage never reaches `/app/garage` for it (the area guard and 404, unchanged).

_From 101-verification-progress._

### 101-FR-009 — Loading shows a skeleton of the stage strip. A failed first read shows "Nu am putut încărca starea verificării." / "We could not load the verification status." with "Reîncearcă" / "Retry"; a failed refresh keeps the shown stage with the strip's one-line notice and retry (116-FR-021).

_From 101-verification-progress._

### 101-FR-010 — The page sends nothing, writes nothing and records no audit entry; messages about the file stay #145's.

_From 101-verification-progress._

### 101-FR-013 — Tests MUST cover, in colocated Jest specs: the status-to-stage mapping and the date line for all six read states; the reason and item labels; the page shown for `draft` and Panou for `approved` and `suspended`; the re-read on each of the three event kinds and on reconnect; the session re-read and swap on `verification.decided`; the empty menu and the move off `/app/garage/requests` while `draft`; the skeleton, the first-load error and the retry; and, on real PostgreSQL and Redis, 403 for the receptionist and mechanic, 404 outside the garage, and no approval note in the response (116-FR-014's tests extended where they do not already prove it). A Playwright test MUST send a listing and create the account, sign in and see "Trimis" on `/app/garage`, as an admin open the file and see "În verificare" light without a reload, ask for more and see "Cerute completări", approve and see the dashboard open.

_From 101-verification-progress._

### 208-FR-002 — While the file is `more_requested`, the verification page of ST-101 (`/app/garage`, the owner only) MUST show under "Cerute completări" / "More details requested" the items with their existing labels, the note word for word, and a button "Completează" / "Complete" (at least 44 px tall, keyboard reachable) that opens the listing form with the completion copy of FR-004; no note, no button for any other status; the staff of the garage see the title and the two lines only (101-FR-008 unchanged). The existing live re-read (101-FR-005) brings the request to an open page within 5 seconds. Modifies 101-FR-003 (the button and the note are added).

_From 208-resubmit-after-more._

### 208-FR-004 — The system MUST let the garage's `owner` open a **completion copy** of a `more_requested` garage: the garage's saved rows (step 1 details and place, step 2 brands and stances, step 3 prices, step 4 mechanic cards, step 5 hours and payments, step 6 CUI, RAR number and declaration), its current legal documents and its photos, read into the draft shape the listing form keeps; one open copy per file, opened again as long as the file is `more_requested`, with the owner's edits kept; 403 for a receptionist or mechanic, 404 for anyone outside the garage, 409 `verification_transition_refused` when the file is not `more_requested`. The copy is never swept while its file is `more_requested`; once the file leaves it, the sweep removes the open copy. It is not a visitor's draft: it needs the session, not a continue link.

_From 208-resubmit-after-more._

### 208-FR-006 — Replacing a legal document in step 6 MUST keep the replacement's pages in the copy until the resend and, in the resend's transaction, make the new upload the current LEGAL_DOCUMENT of its kind and keep the old row marked replaced (`replaced_at`, proposed); a kind not replaced keeps its row untouched; a replacement removed before the send leaves the file as it was. Admin reads of the file MUST show the current document per kind and list a replaced one as "înlocuit" / "replaced" with its date; a replaced document's pages stay downloadable to admins. One `document.uploaded` event per replaced document, emitted at the resend in that transaction, as the brief says. The per-file-and-kind uniqueness becomes a partial unique index over rows with no `replaced_at`.

_From 208-resubmit-after-more._

### 208-FR-007 — The send of a completion copy MUST, in one transaction that rolls back whole if any write fails: re-check the copy with the first send's rules (116-FR-007: 422 with the field list, nothing written; the two step 6 uploads not required; the `cui_in_use` warning stored on the file, never a refusal, 116-FR-012); write the copy back over the garage's own rows (details, place, brands, prices, mechanics, hours, payments, photos, documents), changing only what differs; write one audit entry per changed field with old and new values, one per photo or brand added or removed, one per replaced document, none for an unchanged value, and one for the resend; move the file `more_requested` → `submitted` through the existing `resend` transition (new `submittedAt`; `decidedAt`, `reasonNote` and `requestedItems` kept, so `resubmitted` and `requestedAt` derive as 304-FR-007 states); hand the outbox `verification.submitted` with `resubmission: true` in the same transaction (Principle VI). The garage stays `draft` and out of public reads while the stored automatic-approval switch is off; with it on, the existing `resend` ends in the automatic approval exactly as today (unchanged). The resubmissions counter counts once (304-FR-012). The same `Idempotency-Key` rule as the first send applies (116-FR-008).

_From 208-resubmit-after-more._

### 208-FR-008 — A send when the file is not `more_requested` (decided, reopened, or already resent) MUST answer 409 `verification_transition_refused` with `currentStatus`, nothing written; the form then shows the status view with the status read again. A receptionist or mechanic sending MUST be refused 403; anyone outside the garage 404.

_From 208-resubmit-after-more._

### 208-FR-009 — After a successful resend the form MUST show the confirmation and status view of 116-FR-001 ("Am primit cererea. O verificăm în 1–2 zile lucrătoare.", "Trimis" lit with the new date), focus on its heading; `/app/garage` MUST show "Trimis" with the new date and no request within 5 seconds (the `verification.submitted` event reaches the garage's channel). The admins' queue MUST show the garage waiting from the new sending time with "Actualizat" (304-FR-007), and the ADMIN_VERIFICATION_QUEUED fan-out MUST fire as for a first send (116-FR-011); nothing new is added to notifications.

_From 208-resubmit-after-more._

### 208-FR-010 — When the owner sends a copy holding no save made since the copy was created (an edit from an earlier session counts as a change), the form MUST first ask "Nu ai schimbat nimic. Trimiți oricum?" / "You changed nothing. Send anyway?" in a dialog with "Trimite" / "Send" and "Renunță" / "Cancel"; confirmed, the send runs; cancelled or dismissed, nothing is sent and focus returns to the send button. The dialog never shows when a change was saved.

_From 208-resubmit-after-more._

### 208-FR-011 — The owner's half of a request for more MUST be observable: the resend counted once per committed resend (the existing `motorfix_verification_resubmissions_total`, 304-FR-012), one log line per resend (file id, garage id, no note), and every new endpoint under the API's request metrics by route with the API-wide error and latency rules, listed in `infra/observability/inventory.json` with the reason no alert of its own is needed (`scripts/observability-inventory.ts` passes). A new product action (opening a completion copy) is counted once per copy opened.

_From 208-resubmit-after-more._

### 208-FR-019 — Tests MUST exist before the code (Principle II), with `// @traces` lines naming this feature's FR ids. Jest on real PostgreSQL and Redis: the status read's note for `more_requested` and none for other statuses, no approval note; the completion copy holding every row, document and photo of the garage, one per file, 403/404/409; the resend from `more_requested` only, 409 after an approval, a rejection and a reopening, 403 for a receptionist and a mechanic, 404 outside; every row kept when nothing changed and no audit entry written; a changed field's entry with old and new values; a replaced document kept and marked, the new one current, the untouched kind's row unchanged; the outbox `verification.submitted` with `resubmission: true`; `resubmitted` and `requestedAt` on the admin's file read; the garage `draft` and absent from public reads; the counter and log line; the `cui_in_use` warning after a CUI change; the whole send rolled back on one failed write. Jest for the browser: the page's note, items and button per status and role; the form at the asked-for step with the copy's data; the no-change dialog's three outcomes; the 409 swap to the status view; and FR-013 to FR-018's unit tests. Playwright (on demand and at release): the admin asks for photos; the owner sees the note and the button, adds 3 photos and sends; the admin sees the garage back in the queue with "Actualizat" and the change list.

_From 208-resubmit-after-more._

### 068-FR-001 — The system MUST keep one yearly document cycle per garage that has ever been approved, stored in PostgreSQL with: the due date (a Europe/Bucharest calendar day), the state (`due` or `overdue`), the grace end date (`grace_until`, empty while `due`), the three reminder marks (`reminded_30_at`, `reminded_7_at`, `reminded_0_at`) and when it was last reset. Approval (303-FR-005) MUST create it with the due date = the acceptance day plus 12 months; a migration MUST create one for every garage already `approved` or `suspended` with due date = the later of `approved_at` plus 12 months and the migration day plus 30 days, so every existing owner gets the full reminder sequence and FR-003's grace rule is the only one. Both documents share the one due date.

_From 068-yearly-documents._

### 068-FR-002 — The state and the grace date MUST be readable by other code and by the API: one domain read in the verification module, `documentCycleOf(garageId)`, answering the due date, state, grace end and whether a document is `in_review`, which #209 will call; the owner's legal check read (`GET /api/v1/garages/{garageId}/legal-check`) and the admin's verification file read (302-FR-001) MUST both carry the cycle (`dueOn`, `state`, `graceUntil`, `inReview`).

_From 068-yearly-documents._

### 068-FR-003 — The worker's daily run (200-FR-007) MUST include a compliance step that, for every cycle in state `due`, sends DOCUMENT_DUE to the garage's owner when the due date is 8 to 30 days away and `reminded_30_at` is unset, when it is 1 to 7 days away and `reminded_7_at` is unset, and on the due day when `reminded_0_at` is unset, each one setting its mark (a later mark also sets the earlier ones it skipped); and, for every cycle whose due date is before the run's day, in one transaction: sets the state `overdue` and `grace_until` = due date + 14 days (`DOCUMENT_GRACE_DAYS`), writes one audit entry on the garage by `system` (old and new state, the grace date), one `document.overdue` outbox row (garageId, dueOn, graceUntil) and sends DOCUMENT_OVERDUE to the owner once. The step MUST be idempotent: a second run the same day, or a concurrent one, sends nothing again and changes nothing (the row is locked while it changes). Each notice is sent once-only by its event id, not by the marks' transaction: DOCUMENT_DUE carries `document-<stage>-<garageId>-<dueOn>` and DOCUMENT_OVERDUE `document-overdue-<garageId>-<dueOn>`, the notice is committed by the notifications pipeline's own transaction, and its unique (kind, account, channel, event id) means a run that sends it again after the commit of the `reminded_*` marks or the `overdue` change failed sends nothing twice. An `overdue` cycle MUST get no further reminder. While a document of the garage is `in_review`, the step MUST still set `overdue` and `grace_until` (so #209 and the queue lamp read it) but send no DOCUMENT_DUE or DOCUMENT_OVERDUE and write no `document.due`; the skipped marks stay unset.

_From 068-yearly-documents._

### 068-FR-007 — `POST /api/v1/garages/{garageId}/legal-documents` MUST take, through a DTO in the contracts library validated at the edge, one entry per kind (`onrc_certificate`, `rar_authorisation`; both required, except that a kind may be sent alone when the other kind already has a `valid` row accepted since the cycle was last reset (or `in_review`), else 422 `both_documents_required`), each with its ordered page keys (1 to 10) and issue date (the certificate's within 30 days, else 422 `certificate_too_old`); confirm each page with storage (409 `file_missing`, 422 `file_too_large`, `file_type_mismatch` for bytes that are not the declared type; an upload refused by these rules keeps its uploaded pages for a retry); and in one transaction create one `LEGAL_DOCUMENT` row per kind with status `in_review` on the garage's current verification file, leaving the kind's `valid` row untouched, write one audit entry per row (action `create`, subject `legal_document`, by the owner), one `document.uploaded` outbox row per document to `admin` and `garage:{garageId}`, and answer 201 with the garage's cycle (`DocumentCycleDto`, `inReview` true). A kind already `in_review` answers 409 `document_in_review` and stores nothing. The caller MUST be the garage's `owner` (403 `not_owner` for its receptionist or mechanic, 404 for everyone else and for a `draft` garage); the route MUST be rate-limited as the listing uploads are.

_From 068-yearly-documents._

### 068-FR-009 — `POST /api/v1/admin/legal-documents/{id}/accept` MUST, for a MotorFix admin, in one transaction, locking the garage's cycle row as the worker's step does so an accept and a run on the same day cannot interleave: set the document `valid`, `decided_by` and `decided_at`; set `replaced_at` on the kind's earlier `valid` row; write one audit entry (action `update`, field `status`, subject `legal_document`) and one `document.accepted` outbox row (garageId, documentId, kind) to `admin` and `garage:{garageId}`; and, when after this both kinds' current documents are `valid` rows accepted since the cycle was last reset, reset the cycle: due date = the acceptance day plus 12 months, state `due`, `grace_until` empty, the three marks cleared, one audit entry on the garage (field `documents_due_on`, old and new) in the same transaction. A document not `in_review` answers 409 `document_not_in_review`; an unknown id or a non-admin, 404. It MUST answer 200 with the document and the cycle.

_From 068-yearly-documents._

### 068-FR-010 — `POST /api/v1/admin/legal-documents/{id}/refuse` MUST take `{ reason, note }` (reason ∈ `documents`, `other`; note 1 to 500 characters, trimmed, no control characters; else 400 `validation_failed`) and, in one transaction: set the document `refused` with the reason, the note, `decided_by` and `decided_at`; leave the kind's earlier `valid` row and the cycle (state, due date, grace) unchanged; write one audit entry and one `document.refused` outbox row (garageId, documentId, kind, reason) to `admin` and `garage:{garageId}`; and have the notifications worker build one DOCUMENT_REFUSED for the owner (e-mail and push; mutable like the owner's other account types; Romanian and English templates carrying the kind's label and, in the e-mail and the bell, the note as escaped plain text (the push, held to the template checks' 120 characters, names the kind and points to the dashboard), linking to the dashboard; bell entry opens the legal panel) keyed by the outbox event id. The same 409 and 404 rules as FR-009 apply.

_From 068-yearly-documents._

### 068-FR-013 — The audit history MUST hold, in the same transaction as each change: each upload (per document, by the owner), each acceptance and refusal (by the admin, with reason and note), each change to `overdue` and each cycle reset (actor `system` for the worker, written "MotorFix", 390-FR-006), on the garage's scope so the drawer's timeline (302-FR-010) shows them with the file's own entries. Opening a page stays logged as today.

_From 068-yearly-documents._

### 068-FR-017 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the due date from approval and from the migration (29 February included); reminders at 30, 7 and 0 days each sent once across repeated and concurrent runs, a missed window, and none once `overdue`; `overdue` on the day after the due date with `grace_until` = due + 14, its audit entry and outbox row in one transaction, and no suspension; DOCUMENT_DUE and DOCUMENT_OVERDUE built in quiet hours held until 08:00, sent on e-mail and push whatever the owner's settings, and none while a document is `in_review`; the upload's 201 and rows, the 409 for a kind in review, the 422s, the 403 for a receptionist and a mechanic and the 404s; accept moving the due date only when both kinds are valid, the `replaced_at`, the cycle reset and its audit entry; refuse keeping the earlier document and the grace, DOCUMENT_REFUSED built once with the note; the queue listing the garage, its lamp after the grace and the count; `documentCycleOf` answering state, grace and `inReview`; and the legal-check row's five texts. Web unit tests cover the row's texts and lamps by state, the button by role and the dialog's limits in both languages. Playwright MUST, with the clock on the due date, sign the owner in to the amber row, upload both documents, have an admin accept them from the drawer, and read the row green with the next year's month.

_From 068-yearly-documents._

### 067-FR-002 — The system MUST provide one domain use case in the verification module beside `suspend`, `restore(actor, garageId, body)`, that in a single transaction behind the garage's row lock (the lock `suspend` takes): reads the garage and its open suspension; refuses a garage that is not `suspended` with 409 `garage_not_suspended` ("Service‑ul nu este suspendat" / "The garage is not suspended"); checks the cause's evidence (FR-003); sets the open suspension's `until_time` (the commit's time), `lifted_by` (the admin) and `lift_note`; sets the garage's status `suspended` → `approved`; writes one audit entry on subject `garage` (kind `garage_restored`: actor, actor role, old and new status, the cause lifted, the evidence — the re-check's id and date, or the documents' acceptance, or the note — and the note) and one outbox row `garage.restored` whose payload carries `garageId` and `cause`; and answers the lifted suspension. A failed audit or outbox write MUST fail the transaction. Two concurrent calls for one garage MUST end with exactly one committed; the second answers 409 `garage_already_restored` (decided under the lock: the garage is `approved` and its latest suspension carries `lifted_by`, however long ago; a garage never suspended or not `approved`/`suspended` answers `garage_not_suspended`) ("Deja repus pe hartă de {name}." / "Already put back on the map by {name}.", the first admin's first name and initial as the audit history shows names, 390-FR-006), nothing written. An unknown garage id answers 404 `not_found`.

_From 067-restore-suspended-garage._

### 067-FR-003 — The evidence MUST follow the open suspension's cause, checked inside FR-002's transaction: `recheck_failed` needs a valid RAR re-check: when the body carries one (`recheck: { checkedOn, activities }`), it MUST be recorded in the same transaction with the `ok` record's effects (1351-FR-006: the RECHECK row with result `ok`, the garage's date of last check and authorised activities set, the `recheck_recorded` audit entry, the `recheck.recorded` outbox row and `price_list.updated` on a narrowing) under the record call's date and activities rules (1351-FR-004: the date not after today in Europe/Bucharest and strictly after the garage's date of last check, else 422 naming `checkedOn`; the activities a subset of the garage's current set and known codes, else 422) but not its due rule, since a suspended garage is never due (1351-FR-001); when the body carries none, a RECHECK with result `ok` recorded at or after the suspension's `from_time` MUST exist, else 409 `recheck_missing` ("Lipsește o reverificare RAR valabilă" / "A valid RAR re-check is missing"); a re-check in the body for any other cause answers 422 `recheck_not_expected`. `documents_overdue` needs the garage's yearly document cycle in state `due` (068-FR-009: both kinds accepted since the cycle was last reset), else 409 `documents_not_valid` ("Documentele anuale nu sunt toate valabile" / "The yearly documents are not all valid"). `admin` and `report_confirmed` need the note (1 to 1,000 characters counted by code point, not blank after trimming, no control character other than tab, LF and CR — the rule of #226's refusal note), else 400 `validation_failed`; for the other two causes the note is optional under the same limits. A 409 or 422 writes nothing.

_From 067-restore-suspended-garage._

### 067-FR-004 — The use case MUST accept an actor whose role is `admin` and refuse every other actor with 404, as the capability policy answers on admin routes (207-FR-010); there is no `system` restore. The verification file is not reopened and its status does not change.

_From 067-restore-suspended-garage._

### 067-FR-005 — `POST /api/v1/admin/garages/{id}/restore` MUST take `{ note?, recheck?: { checkedOn, activities } }` through a DTO in the contracts library validated at the edge (400 `validation_failed` for a note outside FR-003's limits, a `checkedOn` that is not a calendar date, or `recheck.activities` not a non-empty array of strings of 1 to 40 characters — the shape `RecordRecheckDto.activities` accepts; a code that is not a known RAR activity or not in the garage's current set is the use case's 422 `recheck_activity_unknown` / `recheck_activities_wider`, as the record call answers), call the use case with the signed-in admin as actor, and answer 200 with `{ id, garageId, cause, fromTime, untilTime, liftedBy: { name }, note, lastCheckedOn }`; a non-admin session gets 404 with no garage data, no session 401 `sign_in_required`. The OpenAPI document and the generated client MUST be regenerated, and the web MUST call it through the generated client.

_From 067-restore-suspended-garage._

### 067-FR-011 — The restore MUST write nothing to the bookings the suspension cancelled, the requests it closed or the quotes it withdrew, and send their drivers nothing: they keep their states and reasons. The suspended list's `cancelledBookings` (066-FR-003) is not shown for an ended suspension since the row leaves the list.

_From 067-restore-suspended-garage._

### 067-FR-014 — Tests MUST exist before the code (Principle II), tagged with this feature's ids. In Jest on real PostgreSQL and Redis: each cause's evidence accepted and refused (the inline re-check with its row, date, activities, audit entry and outbox rows; an existing valid re-check after `from_time` and one before it; the cycle `due` and `overdue`; the note present, missing, blank and 1,001 characters); the restore's transaction (until_time, lifted_by, note, status, audit entry, `garage.restored` row) and its rollback on a failed audit write; the 409s of FR-002 and FR-003 and the 422s, each writing nothing; exactly one restore under two concurrent calls, the loser naming the winner; 404 for a driver, an owner, a receptionist and a mechanic; the DTO's 400s; the public scope including the garage again in the search, the brand counts, the profile (with the new date) and the routing; the cancelled booking, closed request and withdrawn quote unchanged and no notification built for their drivers; GARAGE_RESTORED built once per owner with every channel muted, in each owner's language, once for a replayed event, and skipped for a garage without an owner; the file read's `suspension` while open, once ended and for a garage never suspended; the migration leaving existing rows open. Web unit tests MUST cover the button on the row and in the header (present only for an open suspension), the dialog per cause (the form, the state line, the note's requirement and counter), a 409 kept in the dialog with the input, the drawer offering the action after a `documents_overdue` acceptance with the cycle `due` and not otherwise, the header's two lines, in both languages. Playwright MUST, as the seeded admin: suspend a test garage by recording a failed re-check, restore it from "Suspendate" recording a valid re-check in the dialog, and see it back in the results for its brand with the new date on its profile; the four sizes, light and dark, Romanian and English are the PR QA sweep's.

_From 067-restore-suspended-garage._

### 413-FR-001 — While an admin has a verification file's drawer open, the system MUST hold one presence entry per admin per file in the in-memory store (VERIFICATION_PRESENCE, key `verification:presence:{fileId}`), a hash with one field per admin account id holding the shown name, "since" and the last heartbeat time; the key's time to live MUST be renewed to 60 seconds on every write, and a read MUST drop and delete every field whose last heartbeat is older than 60 seconds, so an entry expires 60 seconds after its last heartbeat; and the browser MUST send a heartbeat every 20 seconds while the drawer is open. Presence MUST NOT be stored in PostgreSQL, MUST write no audit entry and MUST emit nothing through the outbox: it is not a change.

_From 413-verification-file-presence._

### 413-FR-002 — The system MUST expose `PUT /api/v1/admin/verification-files/{id}/presence`, which creates the signed-in admin's entry on the file when there is none, setting "since" to the server's current time, and otherwise only renews its expiry (a heartbeat never resets "since"; the same admin in a second tab keeps the earliest "since"); it answers the list of the other admins present on the file (FR-003).

_From 413-verification-file-presence._

### 413-FR-003 — The presence list MUST hold every other admin with a live entry on the file, never the caller, each with the shown name and "since" (UTC), ordered by "since" ascending.

_From 413-verification-file-presence._

### 413-FR-004 — The system MUST expose `DELETE /api/v1/admin/verification-files/{id}/presence`, which removes the signed-in admin's entry at once and answers nothing; the web app MUST call it when the drawer closes, when the page is left and on sign-out, best effort, the expiry of FR-001 being the fallback. Before the DELETE the drawer MUST stop its heartbeat and its presence re-read, and MUST send no PUT for that file afterwards.

_From 413-verification-file-presence._

### 413-FR-005 — Both presence routes MUST answer 404 to every signed-in non-admin and for an unknown file id, as the file read does (302-FR-002); neither is public: both run behind the session guard, which answers a caller with no session 401 `sign_in_required`. A file of any status, decided ones included, accepts presence.

_From 413-verification-file-presence._

### 413-FR-006 — With the in-memory store unreachable, the presence calls MUST answer success with an empty list (PUT) or nothing (DELETE), with no error to the caller; the failure is counted (FR-013) and logged with the file id, never the admin's name; the drawer, the checks and the decision stop (306-FR-002) work unchanged.

_From 413-verification-file-presence._

### 413-FR-009 — The banner MUST read, for one admin, "{name} are dosarul deschis din {time}" / "{name} has had the file open since {time}" and, for several, "{name} (din {time}) și {name} (din {time}) au dosarul deschis" / "{name} (since {time}) and {name} (since {time}) have the file open", the names joined by ", " and the last by " și " / " and "; {time} is "since" as HH:mm in Europe/Bucharest. It is an amber strip with an info lamp, announced as a status region, at least 44 px tall on phones, and never locks or disables anything in the drawer.

_From 413-verification-file-presence._

### 413-FR-010 — The shown name MUST be the admin account's first name and the initial of the surname with a full stop ("Ana P."), derived from the account's name on the server when the entry is created: the first word plus the initial of the last word, as typed ("Ana Maria Popescu" → "Ana P."); an account with a single name word shows that word alone.

_From 413-verification-file-presence._

### 413-FR-011 — Nothing is locked: ticking a manual check, recording a register check and deciding work exactly as before while a banner is shown; the "already decided by <name> at <time>" stop (306-FR-002) and the reopen (306-FR-005) are not changed by this story.

_From 413-verification-file-presence._

### 413-FR-012 — Every new text MUST live in the shared i18n files in Romanian and English; the banner MUST read at 320 px, 390 px, tablet and desktop, light and dark, in both languages, with no sideways scroll, and the PR QA run's screenshots are the evidence.

_From 413-verification-file-presence._

### 413-FR-013 — The presence DTO lives in the contracts library, both routes are REST with OpenAPI, and the generated client is regenerated, never edited by hand. The two routes MUST be listed in `infra/observability/inventory.json` with the API's request metrics by route, one counter of presence changes by outcome (`created`, `removed`, `store_unavailable`), the store-failure log line, a dashboard panel, and the reason no alert of their own is needed (the data-store alerts already cover an unreachable store); the PR lists them in its Observability section.

_From 413-verification-file-presence._

### 413-FR-014 — Tests MUST cover, in Jest on real PostgreSQL and Redis: an entry's creation, its heartbeat keeping "since" and its expiry at 60 seconds; the delete on close; one entry per admin across two tabs with the earliest "since"; the list excluding the caller and ordered by "since"; 404 for a non-admin and an unknown id; the store unreachable answering an empty list without an error; `presence.changed` published on create and remove and not on a heartbeat; and the shown-name rule. In the browser: the banner's texts for one and for two admins in both languages, its re-read on `presence.changed` for its own file only, the heartbeat and close calls, and no PUT after close. End to end, in the PR QA flow: two admin browsers open the same file, the second sees the first's name and time, the first closes, the banner goes within 2 seconds; the second admin is the seed's existing second admin account (`admin2@example.test`, present since before this story), signed in by the flow itself; the seed is not changed.

_From 413-verification-file-presence._

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
- `207-FR-009` — superseded by `259-FR-002` (2026-10-18)
- `303-FR-004` — superseded by `259-FR-004` (2026-10-18)
- `300-FR-007` — superseded by `210-FR-011` (2026-10-18)
- `303-FR-001` — superseded by `305-FR-001` (2026-10-18)
- `305-FR-001` — superseded by `304-FR-001` (2026-10-18)
- `305-FR-006` — superseded by `304-FR-006` (2026-10-18)
- `303-FR-005` — superseded by `1351-FR-006` (2026-10-19)
- `300-FR-004` — superseded by `1351-FR-006` (2026-10-19)
- `066-FR-004` — superseded by `1351-FR-007` (2026-10-19)
- `066-FR-002` — superseded by `1351-FR-010` (2026-10-19)
- `210-FR-002` — superseded by `1354-FR-001` (2026-10-20)
- `210-FR-003` — superseded by `1354-FR-002` (2026-10-20)
- `210-FR-009` — superseded by `1354-FR-003` (2026-10-20)
- `210-FR-006` — superseded by `1354-FR-004` (2026-10-20)
- `210-FR-005` — superseded by `1354-FR-005` (2026-10-20)
- `210-FR-011` — superseded by `1354-FR-007` (2026-10-20)
- `116-FR-015` — superseded by `101-FR-002` (2026-10-21)
- `116-FR-014` — superseded by `208-FR-001` (2026-10-22)
- `210-FR-004` — superseded by `068-FR-005` (2026-10-23)
- `206-FR-013` — superseded by `068-FR-008` (2026-10-23)
- `302-FR-005` — superseded by `068-FR-008` (2026-10-23)
- `301-FR-001` — superseded by `068-FR-011` (2026-10-23)
- `301-FR-006` — superseded by `068-FR-011` (2026-10-23)
- `302-FR-003` — superseded by `068-FR-012` (2026-10-23)
- `206-FR-012` — superseded by `068-FR-014` (2026-10-23)
- `049-FR-001` — superseded by `067-FR-001` (2026-10-23)
- `068-FR-012` — superseded by `067-FR-009` (2026-10-23)
- `066-FR-003` — superseded by `067-FR-009` (2026-10-23)
- `069-FR-008` — superseded by `067-FR-010` (2026-10-23)
- `302-FR-008` — superseded by `413-FR-008` (2026-10-24)

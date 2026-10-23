---
capability: reviews
updated: 2026-10-23
features:
  - 022-review-drawer
  - 023-review-confirmed-job
  - 025-review-mechanic
  - 182-review-rules
---

# Capability: Reviews

A driver's review of a finished job: the drawer that writes it, the read that fills it, and the service that publishes it with its audit entry and its `review.posted` event, one live review per job.

## Requirements

### 022-FR-001 — The driver dashboard MUST open the review drawer when the URL carries `?review=:jobId`, and close it on Escape, the close control or the backdrop by navigating to the same route without `review` with the URL replaced (no new history entry), and on browser back because the parameter is gone, leaving the page beneath unchanged.

_From 022-review-drawer._

### 022-FR-002 — The drawer MUST show the copy-voice title (voice 1 until EP-11, in Romanian "Cum a mers reparația?") and, under it, the name of the garage that did the job.

_From 022-review-drawer._

### 022-FR-003 — The drawer MUST show Mașina ta (the request's car: brand, model, engine) and Ce s-a lucrat (the works of the accepted quote) filled from the job and locked; the driver cannot change either.

_From 022-review-drawer._

### 022-FR-004 — Nota ta MUST offer the five steps 1 to 5, start on 4, and show only the selected step's words: 1 "Nu m-aș întoarce", 2 "Au fost probleme", 3 "Și-au făcut treaba", 4 "Lucru bine făcut", 5 "Aș trimite un prieten".

_From 022-review-drawer._

### 022-FR-005 — Cât ai plătit MUST be optional and accept lei typed the Romanian way: thousands separated by "." and decimals by "," ("4.200", "4.200,50"); spaces and a "lei" suffix are tolerated. The drawer MUST refuse, at the field, 0, a negative amount, more than 1.000.000 lei, more than two decimals or any other character, and MUST send the amount to the service as an integer `paidBani` parsed with the shared contracts helper.

_From 022-review-drawer._

### 022-FR-006 — Comentariul tău MUST be optional, up to 2,000 characters, with a hint that suggests: was the price the quoted one, was it ready on time, would you go back. Over 2,000 characters the publish button MUST be disabled and the count shown.

_From 022-review-drawer._

### 022-FR-007 — The drawer MUST show the privacy line: only the driver's first name and surname initial (e.g. "Andrei M."), the car and the job are shown; never the plate or the phone.

_From 022-review-drawer._

### 022-FR-008 — Pressing Publică recenzia MUST publish the review and, on success, replace the form with the confirmation "Publicată. E acum pe profilul <garage>."; the button MUST be disabled while the request is in flight.

_From 022-review-drawer._

### 022-FR-009 — On a phone-width screen the same form MUST open as a bottom sheet; at tablet and desktop widths as a side drawer. Both MUST work at 320 px without sideways scroll, in light and dark.

_From 022-review-drawer._

### 022-FR-010 — Every word of the drawer MUST exist in Romanian and English and follow the driver's language.

_From 022-review-drawer._

### 022-FR-011 — When the driver's e-mail is not confirmed, or the account has no e-mail, the drawer MUST show the confirm-your-e-mail message in place of Publică recenzia, and, when an e-mail exists, a "Trimite din nou linkul" button that sends the confirmation link again through the existing resend.

_From 022-review-drawer._

### 023-FR-015 — The drawer MUST show, in place of the form and with its close control, the own-garage message when the reason is `own_garage` and the removed message when it is `review_removed`, on open and after a publish answered with that code; for `already_reviewed` it shows the existing review (rating with its words, amount if given, comment if given, posted date) in place of the form, with a one-line note when it is reported. The two messages use the layout of ST-22's not-done state: readable at 320 px with no sideways scroll, in light and dark, Romanian and English, the close control reachable by keyboard.

_From 023-review-confirmed-job._

### 022-FR-012a — When the caller's job is not `done`, the drawer MUST show a not-done message in place of the form, on open and after a 409 job_not_done.

_From 022-review-drawer._

### 022-FR-013 — When a publish fails for a network error or a 5xx, the drawer MUST show a toast with the error in the driver's language and keep every typed value; a 404, 409 or 422 MUST be shown with its own words (FR-023) and the typed values kept.

_From 022-review-drawer._

### 022-FR-013a — While the drawer's read is pending it MUST show a loading state in place of the form, and when the read fails (network or 5xx) a retry control with the error in the driver's language; the form never shows before the read has answered.

_From 022-review-drawer._

### 022-FR-014 — The service MUST expose one operation that publishes a job review for a signed-in driver, taking the job id, the rating (1..5), the optional comment and the optional amount; and one read the drawer uses to load the job's garage name, car, work, the job's status, the driver's e-mail-confirmed state (false when the account has no e-mail) and the existing live review with its status when there is one.

_From 022-review-drawer._

### 022-FR-015 — The service MUST refuse any car or jobs member in the body with 400 `validation_failed` (the global whitelist pipe) and never read it; the review's car and work are always derived from the job.

_From 022-review-drawer._

### 025-FR-001 — When a job review is posted, the system MUST set the review's mechanic to the job's mechanic at that moment, in the same transaction as the review row, its audit entry and its `review.posted` event (022-FR-024), so no review exists with a stale or missing link where the job had a mechanic.

_From 025-review-mechanic._

### 022-FR-017 — The amount MUST convert to bani exactly: "4.200" → 420000, "4.200,50" → 420050 (the shared contracts parser the drawer uses); the service takes the integer `paidBani` and MUST answer 422 for 0, a negative value, more than 100000000 bani (1.000.000 lei) ; a `paidBani` that is not an integer is refused earlier, with 400 `validation_failed`.

_From 022-review-drawer._

### 022-FR-018 — The service MUST answer 422 for a comment over 2,000 characters or a rating outside 1..5 (a rating that is not an integer is 400 `validation_failed`).

_From 022-review-drawer._

### 023-FR-003 — The service MUST answer 404 `not_found`, with one body for every case, when the job does not exist, its driver is not the caller, or the caller is not a driver.

_From 023-review-confirmed-job._

### 023-FR-004 — The service MUST answer 409 `job_not_done` (with `currentStatus`) for the caller's job in any status but `done`.

_From 023-review-confirmed-job._

### 023-FR-006 — The service MUST answer 409 `already_reviewed` (with `currentStatus`) when the job has a `published` or `reported` review.

_From 023-review-confirmed-job._

### 023-FR-009 — The service MUST answer 409 `email_not_confirmed` when the caller's e-mail is not confirmed or the account has no e-mail.

_From 023-review-confirmed-job._

### 022-FR-023 — Every refusal MUST carry a machine code the drawer maps to words in the driver's language; an unknown code reads as the code itself.

_From 022-review-drawer._

### 022-FR-024 — The REVIEW row, its ACTIVITY_LOG entry and the `review.posted` event MUST be written in one transaction, so none exists without the others.

_From 022-review-drawer._

### 022-FR-025 — The operation MUST require a driver session (no public route) and MUST be covered by failing tests first: service tests on real PostgreSQL for FR-014..FR-024 and FR-026, component tests for FR-001..FR-013 (FR-012a included).

_From 022-review-drawer._

### 023-FR-002 — After the session check (401) and the global pipe's 400, the publish operation MUST run its checks in this order and answer with the first that fails: 404 `not_found`, 409 `job_not_done`, 403 `own_garage`, 409 `already_reviewed` or `review_removed`, 409 `email_not_confirmed`, then the 422 field bounds.

_From 023-review-confirmed-job._

### 023-FR-001 — One use case MUST decide whether a caller may review a job, and both the publish operation and every read that offers "Scrie recenzia" (the drawer's read, the eligibility read) MUST take their answer from it.

_From 023-review-confirmed-job._

### 023-FR-005 — The service MUST answer 403 `own_garage` when the caller has a member row (any role) at the job's garage or is a mechanic of that garage linked to the caller's account.

_From 023-review-confirmed-job._

### 023-FR-007 — The service MUST answer 409 `review_removed` (with `currentStatus` `removed`) and the message "Recenzia ta a fost ștearsă de MotorFix; poți doar contesta decizia." / "MotorFix removed your review; you can only appeal the decision." when the job's review was removed.

_From 023-review-confirmed-job._

### 023-FR-008 — A review in `deleted_by_author` MUST NOT block a new review of the job.

_From 023-review-confirmed-job._

### 023-FR-010 — Two concurrent publishes for one job MUST yield exactly one 201 and one 409 `already_reviewed`, guaranteed by the database.

_From 023-review-confirmed-job._

### 023-FR-011 — Every refusal body MUST be `{ code, message }` (plus `currentStatus` where stated), the message in the caller's language (Romanian or English).

_From 023-review-confirmed-job._

### 023-FR-012 — The rule "reviews only after a confirmed job" MUST NOT change any answer on the job path: with it on or off, FR-002 to FR-011 answer the same.

_From 023-review-confirmed-job._

### 023-FR-013 — The service MUST expose an eligibility read for 1 to 50 job ids (UUIDs; else 400 `validation_failed`) of the signed-in driver, in first-occurrence order without duplicates, answering each id once with `offer` (whether a screen shows "Scrie recenzia") and `reason` (null when allowed, else the code the publish would answer); `offer` is true only when `reason` is null or `email_not_confirmed`; an id that is not the caller's job answers `offer` false, reason `not_found`.

_From 023-review-confirmed-job._

### 023-FR-014 — The drawer's read MUST carry the same `offer` and `reason` for its job.

_From 023-review-confirmed-job._

### 023-FR-016 — Every new word MUST exist in Romanian and English.

_From 023-review-confirmed-job._

### 023-FR-017 — Publish refusals MUST be counted by code on the existing review-outcome counter (the eligibility read, which writes nothing, is not counted there), and the eligibility read MUST ship with its request metrics, dashboard panel, alert (its 5xx rate, as the other API operations' alerts) and inventory line.

_From 023-review-confirmed-job._

### 025-FR-002 — A review with source `profile` MUST have no mechanic and MUST NOT change any mechanic's figures; it counts in its garage's figures only. No profile-review path exists in release 1 (OD-32) and the schema does not change for one: this is a guard, tested by seeding a `profile` row on an existing job.

_From 025-review-mechanic._

### 025-FR-003 — The `review.posted` event payload MUST carry `mechanicId` (null for a profile review), and the event's audience MUST include `public:mechanic:{mechanicId}` when it is set (as 419-FR-006 already states).

_From 025-review-mechanic._

### 025-FR-004 — A review MUST keep its mechanic when the mechanic leaves the garage, moves to another, is hidden from the profile or has its account deleted; the link is removed only when the mechanic row itself is deleted (then it becomes empty and the review stays).

_From 025-review-mechanic._

### 025-FR-005 — Each mechanic MUST carry a rating (one decimal, between 1,0 and 5,0, empty until reviewed) and a review count (0 or more), kept under the same rules as the garage's: a rating exactly when the count is above 0.

_From 025-review-mechanic._

### 025-FR-006 — A mechanic's rating MUST be the average of the ratings of their `published` reviews across every garage, to one decimal, rounding half up (computed in PostgreSQL as `round(avg(rating), 1)` over numeric, which rounds half away from zero); the count is the number of those reviews. A garage's rating and count MUST follow the same rule over its own reviews, profile reviews included. A `reported`, `removed` or `deleted_by_author` review counts in neither.

_From 025-review-mechanic._

### 025-FR-007 — A background job, a new outbox-relay consumer queue `review-ratings` in the worker, MUST recompute the figures after `review.posted`, `review.edited`, `review.deleted`, `review.reported`, `review.decided` and `review.appeal_decided` (only `review.posted` exists today; the others come from later stories and are consumed by name now): it reads the review named by the event, then recomputes its garage's figures and, when the review names a mechanic, that mechanic's figures, from the review rows alone.

_From 025-review-mechanic._

### 025-FR-008 — The recalculation MUST be idempotent and safe under concurrency: run twice for one event it writes the same figures; two runs for one garage or mechanic at the same time MUST serialise on a lock per row so neither overwrites the other with an older computation.

_From 025-review-mechanic._

### 025-FR-010 — A recalculation whose review row no longer exists MUST log it and end without writing.

_From 025-review-mechanic._

### 025-FR-011 — The system MUST expose `GET /api/v1/reviews/mechanic/{mechanicId}?page=` to anyone, signed in or not (a public route, joining the public-routes list), listing that mechanic's `published` reviews across every garage, newest first (posted date, then id), 20 per page, each with the review's rating, text (null when the author wrote none), posted date, author display name as the garage profile shows it (first name and surname initial, 022-FR-007), and its garage's name and slug; the answer carries `page`, `pageSize` 20, `total` and the items.

_From 025-review-mechanic._

### 025-FR-012 — The read MUST answer 404 `not_found` with one body for every case when the mechanic does not exist, is not on the profile (`on_profile` false) or its account is deleted; `page` below 1 or not an integer MUST answer 400 `validation_failed`; a missing `page` is page 1; a `page` past the last answers 200 with an empty `items` and the real `total`.

_From 025-review-mechanic._

### 025-FR-013 — The read MUST never expose the author's plate, phone, e-mail or account id, nor any review that is not `published`.

_From 025-review-mechanic._

### 025-FR-014 — The recalculation's queue and the new read MUST ship with their metrics (the worker's job and queue metrics by queue and job name, the API's request metrics by route template), their logs, a dashboard panel and an alert (the queue's failed jobs and oldest waiting age; the read's 5xx rate, as the other API operations' alerts), each listed in `infra/observability/inventory.json`; metric labels carry no id.

_From 025-review-mechanic._

### 025-FR-015 — Tests MUST be written first and cover, in Jest on real PostgreSQL: the mechanic set from the job including a changed mechanic and the owner's row when team mechanics is off; no mechanic for a profile review; the rating maths and rounding (4,45 → 4,5; 4,44 → 4,4; none → empty and 0); a move between garages; a reported review out of both figures until decided, then back in or out; a deleted mechanic account keeping the link; idempotent and concurrent recalculation; the event recorded only on change with its audience; the query's order, page size, garage label, 404 cases and 400 page. End to end (Playwright): none of its own. Every test file names its requirements in a `// @traces` line.

_From 025-review-mechanic._

### 182-FR-001 — The review drawer's form MUST show, under the "Comentariul tău" field and above the privacy line, the summary "Fără insulte, date personale sau reclame. Scrie doar despre această reparație." followed by the link "Regulile recenziilor" (English: "No insults, personal data or ads. Write only about this repair." and "Review rules"), on every path that shows the form: today the write path; the profile path (dropped from release 1 by OD-32) and edit mode (ST-408) inherit it when they ship, since the summary is part of the form. It is one paragraph placed after the comment field's block (after its count and error) and before the privacy line, with the link inline. A state that replaces the form shows no summary.

_From 182-review-rules._

### 182-FR-002 — The link MUST open the rules page of the driver's current language in a new tab, and the drawer in the opening tab MUST keep its state: open, with the rating, the amount and the comment as typed, and no API request sent from the drawer's tab (the new tab's own page load is not counted). The link carries a visually hidden "(opens in a new tab)" / "(se deschide într-o filă nouă)" text.

_From 182-review-rules._

### 182-FR-003 — The rules page MUST be a public page of its own component (not the versioned terms/privacy `Legal` page; no version line), with an `<h1>` and a route title, at `/ro/review-rules` and `/en/review-rules`: no sign-in, rendered on the server in the language of its address, with the canonical and alternate links and the sitemap entries every public page carries (021-FR-001, 021-FR-005, 021-FR-006), and a language switch that moves to the other language's address (021-FR-004).

_From 182-review-rules._

### 182-FR-004 — The page MUST list the eight rules of ST-181, each as one entry, in this order: no insults; no personal data; no ads; no promotion of other services; nothing off the topic of this repair or garage; no hate or discrimination; no fake or conflicted reviews (paid, by staff or competitors, or about a job that did not happen); no threats or legal accusations stated as fact (disputes go to support). The rules themselves are fixed; each entry's one-line explanation is proposed wording the owner may change.

_From 182-review-rules._

### 182-FR-005 — The page MUST say the eight rules also apply to the garage's replies, which the review's author can report: "Aceleași reguli se aplică și răspunsurilor service-urilor." / "The same rules apply to garages' replies."

_From 182-review-rules._

### 182-FR-006 — The page MUST carry a moderation section stating, in plain words: a garage can report a review and the review's author can report the garage's reply; a reported review or reply is hidden until an admin decides, within 48 hours, and a hidden review does not count in the rating meanwhile; the author and the garage are told of the decision; a removed review can be appealed once, within 14 days, and a different admin decides; a removed review cannot be written again. The wording is proposed; the facts are not.

_From 182-review-rules._

### 182-FR-007 — The site footer's legal links MUST include "Regulile recenziilor" / "Review rules", placed right after the terms link, opening the rules page of the current language in the same tab, on every page that shows the footer.

_From 182-review-rules._

### 182-FR-008 — Every text of the summary, the link and the page MUST exist in Romanian and English in the interface translation files (the drawer's in the driver area, the page's in the public area, the footer link beside its siblings under `consent.footer`) and follow the current language; the Romanian summary, link and replies line are the owner-approved wording above and MUST be used verbatim.

_From 182-review-rules._

### 182-FR-009 — On a 320 px phone, in light and dark, Romanian and English, the page and the summary MUST use no text under 12 px and MUST NOT scroll sideways; the page uses the Cockpit theme's plain text page layout, as the terms page does. The link's tap target is at least 44 px high on phones, its text and the page's text meet WCAG AA contrast (4.5:1) in both themes, the rules are an ordered list, and the page reads in one column with no sideways scroll at tablet and desktop widths too.

_From 182-review-rules._

### 182-FR-010 — Tests MUST be written first: component tests for the page rendering in both languages with all eight rules, the replies line and the moderation section, for the summary on the write path and its absence when the form is replaced, and for the footer link; one end-to-end test that opens the rules page from the drawer, returns and finds the draft kept. Every test file names its requirements in a `// @traces` line.

_From 182-review-rules._

## Retired

- `022-FR-012` — superseded by `023-FR-015` (2026-10-21)
- `022-FR-019` — superseded by `023-FR-003` (2026-10-21)
- `022-FR-020` — superseded by `023-FR-004` (2026-10-21)
- `022-FR-021` — superseded by `023-FR-006` (2026-10-21)
- `022-FR-022` — superseded by `023-FR-009` (2026-10-21)
- `022-FR-026` — superseded by `023-FR-002` (2026-10-21)
- `022-FR-016` — superseded by `025-FR-001` (2026-10-23)

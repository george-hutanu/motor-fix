---
capability: reviews
updated: 2026-10-21
features:
  - 022-review-drawer
  - 023-review-confirmed-job
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

### 022-FR-016 — The service MUST save the review with source `job`, the job, its driver, its garage, the rating, the text (null when empty or whitespace), paid_bani (null when not given), status `published` and posted_at = now; the mechanic link stays empty (ST-25 sets it).

_From 022-review-drawer._

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

## Retired

- `022-FR-012` — superseded by `023-FR-015` (2026-10-21)
- `022-FR-019` — superseded by `023-FR-003` (2026-10-21)
- `022-FR-020` — superseded by `023-FR-004` (2026-10-21)
- `022-FR-021` — superseded by `023-FR-006` (2026-10-21)
- `022-FR-022` — superseded by `023-FR-009` (2026-10-21)
- `022-FR-026` — superseded by `023-FR-002` (2026-10-21)

---
capability: reviews
updated: 2026-10-21
features:
  - 022-review-drawer
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

### 022-FR-012 — When the job already has a live review, the drawer MUST show that review (rating with its words, amount if given, comment if given, posted date) in place of the form, on open and after a 409 on publish; a reported or removed review also shows a one-line note saying so.

_From 022-review-drawer._

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

### 022-FR-019 — The service MUST answer 404 `not_found` for a job that does not exist, whose driver is not the caller, or when the caller is not a driver (garage staff included): never 403.

_From 022-review-drawer._

### 022-FR-020 — The service MUST answer 409 `job_not_done` for the caller's job whose status is not `done`.

_From 022-review-drawer._

### 022-FR-021 — The service MUST answer 409 (code `review_exists`, with the existing review's status as `currentStatus` in the body; the drawer re-reads the read operation to show the review itself) when the job already has a live review (status published, reported or removed); a database-level uniqueness rule MUST make two concurrent posts yield exactly one review.

_From 022-review-drawer._

### 022-FR-022 — The service MUST answer 409 `email_not_confirmed` when the caller's e-mail is not confirmed or the account has no e-mail.

_From 022-review-drawer._

### 022-FR-023 — Every refusal MUST carry a machine code the drawer maps to words in the driver's language; an unknown code reads as the code itself.

_From 022-review-drawer._

### 022-FR-024 — The REVIEW row, its ACTIVITY_LOG entry and the `review.posted` event MUST be written in one transaction, so none exists without the others.

_From 022-review-drawer._

### 022-FR-025 — The operation MUST require a driver session (no public route) and MUST be covered by failing tests first: service tests on real PostgreSQL for FR-014..FR-024 and FR-026, component tests for FR-001..FR-013 (FR-012a included).

_From 022-review-drawer._

### 022-FR-026 — After the global pipe's 400 (wrong types, unknown members), the checks MUST run in this order: 404, `job_not_done`, `email_not_confirmed`, `review_exists`, then the 422 bounds, so a job that cannot be reviewed never answers a field error first.

_From 022-review-drawer._

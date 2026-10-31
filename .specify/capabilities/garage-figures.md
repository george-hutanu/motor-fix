---
capability: garage-figures
updated: 2026-10-30
features:
  - 143-profile-views
  - 243-terms-privacy
  - 144-profile-stats-weekly
  - 1397-dashboard-weekly-views
---

# Capability: garage-figures

What a garage can learn about its own traffic: profile views counted per visitor per day, closed nightly into daily rows, read per day or ISO week.

## Requirements

### 143-FR-001 — The API MUST accept `POST /api/v1/garages/{id}/views` with body `{ source }` from anyone, signed in or not, and answer 204 with no body for an `approved` garage; `{id}` is the garage's id. The route is public (no session needed) and joins the public-routes list; a bearer that is present but invalid or expired is ignored and the visitor counts as anonymous.

_From 143-profile-views._

### 143-FR-002 — A beacon for a garage whose status is `draft` or `suspended`, or for an unknown id, MUST be answered 404 `not_found` and count nothing.

_From 143-profile-views._

### 143-FR-003 — The system MUST count each visitor at most once per garage per Europe/Bucharest day, whatever the number of beacons that day; the day is cut at the Bucharest midnight, including on the nights the clocks change.

_From 143-profile-views._

### 143-FR-004 — The visitor key MUST be the account id when the request carries a session; otherwise an HMAC of the IP address and the browser string under a secret that changes every Bucharest day and is discarded after it. Neither the IP address, the browser string nor the key is ever written to PostgreSQL, to a log or to a metric label.

_From 143-profile-views._

### 143-FR-005 — A beacon MUST NOT be counted when the session's account is a member of the viewed garage (owner, receptionist or mechanic) or holds the `admin` role; a member of another garage is counted.

_From 143-profile-views._

### 143-FR-006 — A beacon whose browser string names a known bot (a short list held in code: the common crawler and fetcher names) MUST be dropped with 204 and not counted; the profile page sends the beacon only after it has rendered in the browser, never during server rendering or a prefetch.

_From 143-profile-views._

### 143-FR-007 — The counted source MUST be one of `search`, `map`, `home`, `shared_link`, `saved`, `profile_direct`, the same names REQUEST_RECIPIENT uses (220-FR-004); a missing, unknown or over-long value (longer than the longest source name) counts as `profile_direct`.

_From 143-profile-views._

### 143-FR-009 — The daily counter MUST live in Redis as a set-cardinality counter per garage per day plus one per garage per day per source, keyed `insights:pv:{garageId}:{day}` (and a source suffix), expiring at the Bucharest midnight that ends the second day after its day (so at 01:00 the two previous days are always alive); each source counter counts distinct visitors on its own, so the split may sum above the total; a Redis failure answers 204, logs an error and loses the view.

_From 143-profile-views._

### 143-FR-010 — At most 60 beacons a minute from one IP address MUST be accepted; the 61st is answered 429 with `Retry-After`, through the shipped address throttle, and not counted; the throttle is taken before the garage is read, so a throttled beacon for a draft garage answers 429.

_From 143-profile-views._

### 143-FR-011 — A night job in the `insights` queue MUST run at 01:00 Europe/Bucharest and write one GARAGE_DAILY_FIGURES row for the day before per approved garage and per garage holding a live counter for that day, whatever its status now (a counter whose garage no longer exists is skipped): `garage_id`, `day`, `profile_views` (the visitor count), `profile_views_by_source` (a map source → count), `written_at`; a garage with no counter gets 0 and an empty map. The write is an upsert on (garage, day), so a second run gives the same row.

_From 143-profile-views._

### 143-FR-012 — The job MUST retry 3 times on failure, and every run MUST upsert the days D-1 and D-2 (D the run's day) from the counters still alive, so a missed night is filled and a written day is replaced with the same values; a day whose counters have expired and has no row is logged as a gap and left empty (a day before the first row ever written is not a gap, so the first deploy is silent); if Redis is down the run fails and is retried like any failure.

_From 143-profile-views._

### 144-FR-006 — The garage MUST be the signed-in membership's; the path `garageId` is only compared with it, and any other id answers 404 `not_found` as an unknown id does. The owner and the receptionist (the `garage.requests` capability) are allowed; a mechanic of the garage is answered 403 whatever her permissions; a mechanic with no garage, a driver, an admin or a visitor get the shipped figures service's refusals (404 for the first three, 401 `sign_in_required` for a visitor). No assistant tool reads it.

_From 144-profile-stats-weekly._

### 143-FR-014 — The beacon's endpoint and the night job MUST be observable: beacons accepted, dropped (bot, staff, no key) and lost (Redis), and the job's rows written and gaps, as metrics in the API and worker, listed in `infra/observability/inventory.json` with the panel and alert they feed.

_From 143-profile-views._

### 143-FR-015 — A view is a read, not a change: no audit entry, no outbox event, no notification and no live update is produced by a beacon or by the job.

_From 143-profile-views._

### 243-FR-009 — The privacy notice MUST include a section on profile-view counts stating: that MotorFix counts how many distinct people see a garage's public profile per day, to show the garage its reach; that a signed-in visitor is counted by their account; that a visitor without an account is counted by a one-way key computed from the connection address and the browser description under a secret that is created fresh every day (Romanian time), is kept only in short-lived memory and is discarded at that day's end; that the address and browser description are used for that key and the abuse throttle of FR-006 only, and are not stored, logged or sent to the monitoring provider; that the key is kept only in daily counters that are discarded within two days, and only the daily totals per garage and arrival source are kept thereafter; that nothing is stored on the visitor's device and nothing is read from it, so no consent is asked; that the counting rests on MotorFix's legitimate interest (GDPR Art. 6(1)(f)) in showing garages how many people saw their profile; that bots, the garage's own staff and MotorFix's administrators are not counted; and that the person may object, by the contact route of FR-011.

_From 243-terms-privacy._

### 243-FR-010 — Every statement of FR-009 MUST be true of the running system, and an automated test MUST pin the code facts the notice relies on: the anonymous key is a keyed one-way hash of the connection address and the browser description and nothing else; a signed-in visitor's key is the account id; the daily secret is random, 32 bytes, lives only in the in-memory store and expires at the end of its Romanian day; the daily counters expire at the midnight that ends the second day after their day; the night job writes only daily totals per garage and source; the abuse throttle keeps a one-way hash of the address for 60 seconds and no longer; no cookie or device storage is used by the beacon. Should any code fact contradict a reasonable, accurate notice, the code changes in this story so the notice is true.

_From 243-terms-privacy._

### 243-FR-015 — Monitoring traces sent to the monitoring provider MUST NOT carry the client's connection address or browser description (the span attributes `client.address`, `network.peer.address`, `user_agent.original`, their older names and the request-header forms of the address and browser description are dropped from span, event and link attributes before export, and the browser error reports carry no user-agent string), so the profile-view section's statement that the address and browser description are used only for the daily key holds; a test MUST pin it.

_From 243-terms-privacy._

### 144-FR-001 — The API MUST offer `GET /api/v1/garages/{garageId}/figures/weekly` answering 200 with `{ weeks: [...] }`: exactly eight entries, oldest first, one per complete ISO week (Monday 00:00 to Sunday 24:00 Europe/Bucharest) ending before the current Bucharest day; the week holding today is never among them, whatever the time of day.

_From 144-profile-stats-weekly._

### 144-FR-002 — Each entry MUST carry the week's ISO key (`"2026-W40"`, the year of the week's Thursday), its first day and its last day as calendar days (`"2026-09-28"`, `"2026-10-04"`), `views`, `requests` and `conversion`.

_From 144-profile-stats-weekly._

### 144-FR-003 — `views` MUST be the sum of GARAGE_DAILY_FIGURES `profile_views` over the week's seven days (a day without a row counting 0) and `requests` the number of this garage's REQUEST_RECIPIENT rows whose `created_at` falls in the week on the Bucharest clock, counted live at read time, whatever their status now; the clock-change weeks of March and October are seven Bucharest days long like any other.

_From 144-profile-stats-weekly._

### 144-FR-004 — `conversion` MUST be `requests ÷ views × 100` rounded half up to one decimal, capped at 100, and null when `views` is 0; the rounding is exact on the decimal digit (6.25 → 6.3), not subject to binary floating-point error.

_From 144-profile-stats-weekly._

### 144-FR-005 — A week wholly before the week that holds the garage's approval date (`approvedAt`, its day taken on the Bucharest clock) MUST answer `views`, `requests` and `conversion` as null (the screen half draws no bar); the approval week and every later week carry numbers, the approval week whole. A garage never approved answers eight null weeks.

_From 144-profile-stats-weekly._

### 144-FR-007 — The answer's shape MUST be a DTO in the contracts library, the route documented in the OpenAPI document (`apps/api/openapi.json`) with its 200, 400 (`validation_failed`, a `garageId` that is not a UUID), 401, 403 and 404 answers (as the schedule route documents its own), and the `data-access` client regenerated from it, so the second half consumes a typed call.

_From 144-profile-stats-weekly._

### 144-FR-009 — The read MUST write nothing: no GARAGE_DAILY_FIGURES column, no audit entry, no outbox event, no notification, no live update and no new night-job work.

_From 144-profile-stats-weekly._

### 144-FR-010 — Jest tests MUST cover: the ISO-week bucketing in Europe/Bucharest with the Sunday 23:50 and Monday 00:05 edges and a clock-change week (unit); the conversion rounding (29 ÷ 472 = 6.1), zero views (null) and the 100 cap (unit); a request to several garages counting once per garage, the weeks before approval null and the never-approved garage (integration); the route's answers for the owner, the receptionist, the garage's mechanic (403) and another garage's owner (404) (integration); and the OpenAPI document carrying the operation.

_From 144-profile-stats-weekly._

### 1397-FR-001 — The garage overview MUST show the section "De la profil la cerere" (its existing title and position among the customisable sections) as a panel with two bar charts, "Vizualizări profil" / "Profile views" and "Cereri primite" / "Requests received", over the eight weeks the weekly figures read answers, oldest left, newest right; the two charts sit side by side on a desktop and stacked on a phone, and the panel replaces the section's "not built yet" sentence.

_From 1397-dashboard-weekly-views._

### 1397-FR-002 — Above each chart the panel MUST write the latest week's figure large, formatted with the language's grouping ("1.240" in Romanian, "1,240" in English), and the latest week's bar in each chart MUST carry its value as a label.

_From 1397-dashboard-weekly-views._

### 1397-FR-003 — Each chart MUST label its weeks under the bars from the read's week key: "S40" in Romanian, "W40" in English; a week whose `views` or `requests` is null MUST show its label but no bar and no value label.

_From 1397-dashboard-weekly-views._

### 1397-FR-004 — Hovering or tapping a bar MUST show a one-line tooltip of the week, its first and last day and the value: "S40 · 28 sept. – 4 oct.: 472" in Romanian, "W40 · 28 Sep – 4 Oct: 472" in English, the days from the read's `from` and `to`, the value with the language's grouping; the days are the calendar dates as the read writes them, never shifted by the viewer's time zone.

_From 1397-dashboard-weekly-views._

### 1397-FR-005 — Under the charts the panel MUST show one sentence computed from the latest week's `conversion`: with a number, "Săptămâna trecută, 6,1% din vizualizări au devenit cereri." / "Last week, 6.1% of views turned into requests.", the percentage with one decimal and the language's decimal mark; with null, "Săptămâna trecută nu a avut vizualizări." / "Last week had no views." with no percentage.

_From 1397-dashboard-weekly-views._

### 1397-FR-006 — The view "Profilul service-ului" MUST show the same panel (charts, figures, sentence, states) after the public profile panel and before the legal check panel, for whoever sees the public profile panel.

_From 1397-dashboard-weekly-views._

### 1397-FR-007 — While the read is pending the panel MUST show a skeleton of the charts' height; when all eight weeks are null it MUST show "Încă nu sunt date. Primele cifre apar după prima săptămână întreagă." / "No data yet. The first figures appear after the first full week." instead of charts, figures and sentence; when the read fails it MUST show "Nu am putut încărca cifrele." / "We could not load the figures." with a "Reîncearcă" / "Retry" button that repeats the read, and the failure MUST NOT affect any other panel of the screen; the failure text is announced to assistive technology when it appears (an alert), and the retry is a native button reachable by keyboard.

_From 1397-dashboard-weekly-views._

### 1397-FR-008 — The panel MUST be shown only to a person holding the garage's profile capability (the owner and the receptionist); a mechanic of the garage MUST see no panel on the overview and no profile view, and the weekly figures read MUST NOT be sent for her.

_From 1397-dashboard-weekly-views._

### 1397-FR-010 — The panel and the chart code it draws with MUST load deferred, after the dashboard shell, so they add nothing to the first-page bundle; the web app's initial budget (1 MB error, 500 kB warning) MUST NOT be raised.

_From 1397-dashboard-weekly-views._

### 1397-FR-011 — Every piece of text the panel shows (title, chart names, sentence, states, week prefix, tooltip) MUST come from translation keys present in Romanian and English, and every number MUST be written through the shared locale formats.

_From 1397-dashboard-weekly-views._

### 1397-FR-012 — Jest tests MUST cover the panel's states (loading, empty, error with retry, figures), the sentence and its no-views variant, Romanian and English formatting of figures, percentage and tooltip, null weeks without a bar, the latest bar's label, the panel's position in the profile view and its absence for a mechanic; a Playwright flow MUST seed eight weeks of figures, open the overview as the owner and check the two large figures, one tooltip and the sentence, then open the same garage as a mechanic and see no panel.

_From 1397-dashboard-weekly-views._

## Retired

- `143-FR-013` — superseded by `144-FR-006` (2026-10-30)

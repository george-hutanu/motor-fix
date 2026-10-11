---
capability: garage-figures
updated: 2026-10-11
features:
  - 143-profile-views
  - 243-terms-privacy
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

### 143-FR-013 — The garage figures MUST offer a read of profile views for one garage over a span by day or by ISO week (Monday to Sunday, Europe/Bucharest): each bucket covers only the span's days, is labelled by its ISO week (`YYYY-Www`), and answers the sum of `profile_views` and the summed `profile_views_by_source` of its days, a day without a row counting 0. It is reachable only through the garage figures (the garage's owner and receptionist; a mechanic gets 404, as the figures give today); the admin performance views are a later story; the raw counters are never readable.

_From 143-profile-views._

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

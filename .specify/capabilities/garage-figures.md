---
capability: garage-figures
updated: 2026-10-10
features:
  - 143-profile-views
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

---
capability: admin-dashboard
updated: 2026-10-09
features:
  - 160-admin-dashboard-menu
  - 161-headline-numbers
  - 258-platform-rules-switches
  - 162-growth-12-months
  - 001-admin-recent-accounts
  - 260-rule-off-confirm
  - 163-figures-period-city
  - 384-response-rate
---

# Capability: Admin dashboard

The admin dashboard's shell, open to admin accounts only: the `admin/*` API surface and its 404 policy, the overview counters of the work waiting for an admin, the view list with release marks, the header line and the live counters.

## Requirements

### 163-FR-001 — The overview read (`GET /api/v1/admin/overview`) and the growth read (`GET /api/v1/admin/growth`) MUST accept two optional query parameters: `city` (a city key from the list of FR-003, or `all` for the whole country; the default for both reads is `all`) and, on the overview only, `period` (`default`, `today`, `7d`, `30d`, `month`, `12m`; default `default`); an unknown value answers 400 `validation_failed`. The DTOs live in the contracts library and the generated client is regenerated. Both reads keep the `admin/*` access policy (161-FR-003), and nothing in an answer is personal data.

_From 163-figures-period-city._

### 161-FR-003 — The overview route MUST keep ST-160's access policy: an admin reads it, any other role answers 404 `not_found`, a missing token 401 `sign_in_required`, a suspended account 403 `account_suspended`; nothing in the answer is personal data, every value is a count.

_From 161-headline-numbers._

### 160-FR-003 — The `admin/*` routes MUST NOT be refused by maintenance mode: an admin signed in during maintenance (082-FR-006) reads the overview as when maintenance is off.

_From 160-admin-dashboard-menu._

### 001-FR-006 — The admin "Utilizatori" view (`users`, capability `admin.users`) MUST be released (its "în curând" mark removed) and get its body: the three totals as the body's first line, directly under the view header (the admin frame renders no per-view subtitle; research.md D7), then a two-column grid (the list panel wider than the growth panel, as design.md records) that stacks into one column below 900 px.

_From 001-admin-recent-accounts._

### 163-FR-007 — The admin header MUST show the chosen city in its line in place of the fixed "București" (160-FR-008; "Toată țara" / "Whole country" for `all`), with its waiting count from `cityGaragesWaiting` for a city and `garagesWaiting` for `all`; the "Service‑uri" counter (160-FR-010) MUST keep counting every garage waiting on the platform.

_From 163-figures-period-city._

### 160-FR-009 — The header MUST show the label "ADMINISTRATOR" (the same word in English) next to the line, and the language switch with RO and EN that every dashboard header carries; switching the language re-renders the line, the label, the menu and the counters in that language without a reload (MF-1).

_From 160-admin-dashboard-menu._

### 163-FR-007 — The admin header MUST show the chosen city in its line in place of the fixed "București" (160-FR-008; "Toată țara" / "Whole country" for `all`), with its waiting count from `cityGaragesWaiting` for a city and `garagesWaiting` for `all`; the "Service‑uri" counter (160-FR-010) MUST keep counting every garage waiting on the platform.

_From 163-figures-period-city._

### 161-FR-007 — While the first overview read is on its way, each tile MUST show a skeleton in place of its number and line; when a read fails, including a re-read after numbers were shown, every computed tile MUST read "—" with the same info tip "Cifrele nu au putut fi citite" / "The figures could not be read", never 0 and never the last number, until a later read succeeds (ST-160's rule for the counters, applied to the tiles).

_From 161-headline-numbers._

### 160-FR-012 — The admin shell MUST re-read the overview, through the dashboards' shared live re-read (one re-read per 300 ms burst), on every `verification.submitted`, `verification.decided` and `verification.reopened` message of the admin's stream (matched by event kind, not by object id), and on every reconnect of the stream; the re-read MUST update the header line and the counters without a reload. The stream joins `admin` for an admin as it does today (253-FR-004 unchanged); this story adds no event. `review.reported` and `review.decided` join the list with the reports counter (MF-45).

_From 160-admin-dashboard-menu._

### 160-FR-013 — The seed MUST add, outside production and only once (a second run changes nothing), one `submitted` verification file to the seeded garage `service-dobre` and one `in_review` file to `atelier-dinamo`, both `draft` garages, so a development or test database has 2 garages waiting and the end-to-end check reads a known count; `atelier-test` keeps no file.

_From 160-admin-dashboard-menu._

### 161-FR-011 — Every text of the tiles MUST exist in Romanian and English in the shared i18n files; a Romanian word joined by a hyphen MUST use U+2011 ("Service‑uri"); the label, number and line of a tile MUST be 12 px or larger on a phone.

_From 161-headline-numbers._

### 161-FR-002 — Quote requests today, answer rate, bookings and reported reviews MUST NOT be computed or carried in the answer until the entities they count exist (MF-15, MF-45); their tiles read "—" with the line "în curând" / "coming soon". When those entities arrive, the figures join the same answer with the brief's rules: requests created since 00:00 today Europe/Bucharest counted once per request, the share of recipients' passed 24-hour windows answered (quoted or declined) within 24 hours over the last 30 days, bookings confirmed this month with those confirmed today, and reports waiting for a decision with the oldest waiting time in days.

_From 161-headline-numbers._

### 161-FR-004 — "Panou" of the admin dashboard MUST show, above its other content, six tiles in this order: "Service‑uri listate", "Cereri de ofertă azi", "Rată de răspuns", "Programări", "Șoferi activi", "Recenzii raportate" (English "Garages listed", "Quote requests today", "Answer rate", "Bookings", "Active drivers", "Reported reviews"), each with its number and one line under it.

_From 161-headline-numbers._

### 163-FR-011 — In a period other than `default`, the garages tile's line MUST read "+{n} {period}" / "+{n} {period}" from `garagesApprovedInPeriod` with the period's line form ("azi", "în ultimele 7 zile", "în ultimele 30 de zile", "luna asta", "în ultimele 12 luni" / "today", "in the last 7 days", "in the last 30 days", "this month", "in the last 12 months"), and the active-drivers tile's line the change since `activeDriversPeriodStart` with 161-FR-005's sign rule, absent when that figure is absent; the tiles' accessible names (161-FR-013) carry the new lines.

_From 163-figures-period-city._

### 161-FR-006 — Every number in a tile MUST be written through the language's plain-number format ("12.480" in Romanian, "12,480" in English), in the Cockpit digits face the shared gauges use; a change line keeps the same grouping; a percentage, when it exists, follows the percentage format ("92%").

_From 161-headline-numbers._

### 161-FR-008 — The tiles MUST read from the same overview resource the admin shell keeps for its header and counters, so one call feeds the shell and the tiles, and the shell's existing re-read on `verification.submitted`, `verification.decided` and `verification.reopened` and on reconnect updates the garages tile without a reload; the tiles add no event, no polling and no cache.

_From 161-headline-numbers._

### 163-FR-006 — The daily snapshot (161-FR-009) MUST be keyed by day and city: each night it writes the `all` row and one row per city with at least one approved garage, each holding that city's `garagesListed` and `garagesApprovedThisMonth` as FR-004 counts them and no `activeDrivers` value (only the `all` row holds one); existing rows become `all` rows; the one-schedule rule (161-FR-010) is unchanged. The growth read for a city reads that city's rows with 162-FR-002's month-end rule and computes the current month live for the city.

_From 163-figures-period-city._

### 161-FR-010 — The worker MUST run the snapshot job every night at 01:00 Europe/Bucharest through the worker's existing queue mechanism, once per night across every worker instance (one schedule under a fixed job id); a job that fails is logged, not retried that night, and runs again the next night, and the job never back-fills a missed day.

_From 161-headline-numbers._

### 161-FR-012 — Below 768 px the tiles MUST wrap two to a row; at 320 px the page MUST NOT scroll sideways; from 768 px to 1023 px they lay out three to a row, and from 1024 px six in one row.

_From 161-headline-numbers._

### 161-FR-013 — Each tile MUST have one accessible name made of its label, its number and its line (for example "Service‑uri listate, 214, +9 luna asta"; an unreleased tile "Cereri de ofertă azi, în curând"), with the info tip's text joining the name when it shows, and the info tip MUST be reachable by keyboard focus and by touch, not by hover alone.

_From 161-headline-numbers._

### 161-FR-014 — Tests MUST cover, against seeded data on a real database: each figure's count, a suspended garage excluded from listed and from the month's approvals, the month boundary in Europe/Bucharest, the 30-day edge for an active driver, an account without the `driver` role excluded, a `deleted` account excluded, the snapshot's one-row-per-day rule, the month-start delta with and without a snapshot row, and 404 for each non-admin role; an end-to-end check opens "Panou" as the seeded admin and reads the six tiles, their lines and the "în curând" tiles, on a phone and a desktop, in both languages.

_From 161-headline-numbers._

### 258-FR-001 — The system MUST keep the platform rules on the server, one row per rule key, the same for every admin, each with its current value, its default value, whether changing it needs two admins, who changed it last and when.

_From 258-platform-rules-switches._

### 258-FR-002 — A fresh database MUST hold the rules for the environment the server runs in: `reviews_only_after_confirmed_job` (true, needs two admins) and `maintenance_mode` (false) everywhere, created by the schema migration; `skip_manual_approval` (false) and `skip_rar_check` (false: the checks are required) only when the environment is not `production`, created by the seed. Running the seed again MUST NOT overwrite a value an admin changed; in production it neither creates nor deletes the test-only rules.

_From 258-platform-rules-switches._

### 258-FR-003 — An admin MUST be able to list the rules: key, value, default, whether it needs two admins, when and by whom it was last changed, and, from the server, whether the environment is production. The two test-only keys MUST never appear in production, whatever the database holds.

_From 258-platform-rules-switches._

### 258-FR-004 — An admin MUST be able to change one rule by key, sending the new value and the value they saw. The checks run in this order: 404 when the key is unknown or test-only in production; 400 when the value is not of the rule's shape; 409 `stale_value` when the value they saw is no longer the current one; 200 with the unchanged rule and nothing written when the new value equals the current one; 409 `two_admins_required` when the rule needs two admins and the new value is false.

_From 258-platform-rules-switches._

### 258-FR-005 — A change MUST write the new value, its audit entry (actor, role `admin`, rule key, old value, new value) and the `platform_rule.changed` event (rule key, old, new) in one transaction, so that none of the three exists without the others. A change to the current value MUST write nothing.

_From 258-platform-rules-switches._

### 258-FR-007 — The rules list and the rule change MUST be admin-only: 404 for every other role, 401 without a session, as every `admin/*` route; the existing admin-route guard test MUST cover both routes with its guard loop unchanged; only its list of known routes gains the two routes.

_From 258-platform-rules-switches._

### 258-FR-008 — The admin's Setări view MUST open with the heading "Setări platformă" / "Platform settings" and the line "Regulile care se aplică tuturor service-urilor" / "The rules that apply to every garage", followed by one line per rule with its name, one sentence saying what it means, and its control, in the admin's language; the existing push panel and notification choices MUST follow, unchanged.

_From 258-platform-rules-switches._

### 258-FR-009 — The rule lines MUST be, in this order: "Autorizație RAR obligatorie" / "RAR licence required", "Recenzii doar după o lucrare confirmată" / "Reviews only after a confirmed job", "Aprobare manuală pentru service-uri noi" / "Manual approval for new garages", "Mod mentenanță" / "Maintenance mode". In production the first and third MUST be locked lines (no control) marked "Mereu active în producție" / "Always on in production"; elsewhere they MUST be switches marked "Doar în testare" / "Test only", shown on when their `skip_*` value is false. The view holds these four lines itself; the list supplies their values and whether the environment is production, and list keys it does not know are ignored.

_From 258-platform-rules-switches._

### 260-FR-010 — In the admin's Setări view, switching off a rule that needs two admins MUST NOT send a change; the switch stays where it is and a dialog opens with the title "Oprești regula „Recenzii doar după o lucrare confirmată”?" / "Switch off \"Reviews only after a confirmed job\"?", the text "Șoferii conectați vor putea lăsa recenzii și din profilul unui service, fără o lucrare prin MotorFix. Aceste recenzii vor fi marcate „nu prin MotorFix”. Un alt administrator trebuie să aprobe." / "Signed-in drivers will also be able to review a garage from its profile, without a MotorFix job. Those reviews will be marked \"not through MotorFix\". Another admin has to approve.", a reason field labelled "Motiv" / "Reason" with the range shown, and the buttons "Trimite cererea" / "Send the request" and "Renunță" / "Cancel". Confirming sends the request; cancelling sends nothing. The direct change of that rule to `false` stays refused by the API (258-FR-004) and the view's existing error line for 409 `two_admins_required` remains as the fallback.

_From 260-rule-off-confirm._

### 258-FR-011 — When the rules cannot be read, the block MUST show an error line with a way to try again; the rest of the view still shows.

_From 258-platform-rules-switches._

### 258-FR-012 — The view MUST read at 320 px, 390 px, tablet and desktop, in light and dark, Romanian and English, with no sideways scroll.

_From 258-platform-rules-switches._

### 258-FR-013 — Each switch MUST be operable by keyboard and carry its rule's name as its accessible name; while its change is in flight the switch MUST ignore a second change of the same rule. While the rules are first being read, the block MUST show its heading and line with the four rule lines as placeholders, and no control is operable.

_From 258-platform-rules-switches._

### 163-FR-001 — The overview read (`GET /api/v1/admin/overview`) and the growth read (`GET /api/v1/admin/growth`) MUST accept two optional query parameters: `city` (a city key from the list of FR-003, or `all` for the whole country; the default for both reads is `all`) and, on the overview only, `period` (`default`, `today`, `7d`, `30d`, `month`, `12m`; default `default`); an unknown value answers 400 `validation_failed`. The DTOs live in the contracts library and the generated client is regenerated. Both reads keep the `admin/*` access policy (161-FR-003), and nothing in an answer is personal data.

_From 163-figures-period-city._

### 163-FR-006 — The daily snapshot (161-FR-009) MUST be keyed by day and city: each night it writes the `all` row and one row per city with at least one approved garage, each holding that city's `garagesListed` and `garagesApprovedThisMonth` as FR-004 counts them and no `activeDrivers` value (only the `all` row holds one); existing rows become `all` rows; the one-schedule rule (161-FR-010) is unchanged. The growth read for a city reads that city's rows with 162-FR-002's month-end rule and computes the current month live for the city.

_From 163-figures-period-city._

### 162-FR-003 — The growth read MUST follow the `admin/*` access policy (161-FR-003): an admin reads it, any other role answers 404 `not_found`, a missing token 401 `sign_in_required`, a suspended account 403 `account_suspended`; the route joins the admin-route guard test's list of known routes. A failure inside the read answers the API's standard error body (no partial answer, no figures), which the panel treats as a failed read (FR-008).

_From 162-growth-12-months._

### 162-FR-004 — "Panou" of the admin dashboard MUST show, under the six tiles, one panel titled "Creștere, ultimele 12 luni" / "Growth, last 12 months" holding two line charts in this order: "Șoferi activi" / "Active drivers" and "Service‑uri listate" / "Garages listed", drawn in the shared Cockpit chart style (cockpit-charts) with the count unit. The panel is a labelled section whose heading is that title, and each chart carries its own title as its accessible name beside the shared chart's summary and table.

_From 162-growth-12-months._

### 162-FR-005 — Above each chart the panel MUST write the chart's latest value (always the current month's live count), in the language's plain-number format ("12.480" / "12,480") and the Cockpit digits face the tiles use; under each chart it MUST write the first and the last month of the twelve, as the language's short month and year ("nov. 2025" – "oct. 2026" / "Nov 2025" – "Oct 2026").

_From 162-growth-12-months._

### 162-FR-006 — Each point's label MUST be the language's full month name and year ("martie 2026" / "March 2026"), so the shared chart's tooltip, summary and table name the month and its grouped value ("martie 2026" and "9.870"; "March 2026" and "9,870"); the labels re-write when the language changes, without a reload.

_From 162-growth-12-months._

### 162-FR-007 — A month without a value MUST show no point: the line starts at the first month with data, breaks at a gap between two months with data rather than bridging it, and does not pass through zero; the chart's table writes the shared dash for that month; the twelve months stay on the axis so the period under the chart is still twelve months.

_From 162-growth-12-months._

### 162-FR-008 — While the growth read is on its way the charts MUST show the shared chart skeleton; when the read fails they MUST show the shared retry button, and pressing it MUST read again; the tiles and the rest of "Panou" are not affected by the panel's loading or failure. When no past month has a snapshot value (only the live current month), each chart MUST show "Încă nu sunt date" / "No data yet", with the latest value above it still written.

_From 162-growth-12-months._

### 162-FR-009 — The panel MUST read the growth once when "Panou" opens and again on retry; it adds no event, no polling and no cache. One read feeds both charts, so a failure shows the retry button on both and pressing either one re-reads once and redraws both.

_From 162-growth-12-months._

### 162-FR-010 — Every text of the panel MUST exist in Romanian and English in the shared i18n files, with U+2011 in Romanian hyphenated words ("Service‑uri"); the latest value and the month labels MUST be 12 px or larger on a phone.

_From 162-growth-12-months._

### 162-FR-011 — Below 768 px the two charts MUST stack one under the other; from 768 px they MUST sit side by side; at 320 px the page MUST NOT scroll sideways, and each chart MUST fit its panel with the shared chart's label skipping.

_From 162-growth-12-months._

### 162-FR-012 — Tests MUST cover, against seeded snapshot rows on a real database: the month-end selection (the following month's first-day row, the last-day fallback, neither); the live current month; months before the first snapshot empty; a garage approved mid-range and suspended later counted only while listed (the snapshot write run at simulated month ends, the garage's status changed between runs); the Europe/Bucharest month boundary; and 404 for each non-admin role. An end-to-end check answers the growth read with twelve months of figures (stubbed in the browser, since the end-to-end suite also runs against a deployed address and writes no database rows; the real-database path is the integration tests above), opens "Panou" as the seeded admin and reads the first and last labels, the latest values (the seeded live counts) and one tooltip, on a phone and a desktop, in both languages.

_From 162-growth-12-months._

### 001-FR-001 — `GET /api/v1/admin/accounts?cursor` MUST answer the accounts whose status is `active` or `suspended` (never `deleted`), newest first by creation time, then id, 20 per page as `{ items, nextCursor }`, with an opaque cursor for the next page (base64url of the last item's creation time and id; the next page holds the items older than it, or as old with a smaller id), so no account is repeated or skipped between two consecutive pages of a list to which accounts are only added; `nextCursor` is null when no account follows the page. A cursor that does not decode (not base64url, or not a valid creation time and id once decoded) MUST answer 400 `invalid_cursor`; a cursor that decodes always answers what follows it, even if its account is gone. The list carries no `total` (A30 is proposed; the view shows none).

_From 001-admin-recent-accounts._

### 001-FR-002 — Each item MUST carry `id`, `name`, `roles` (the account's roles, in the order driver, garage, receptionist, mechanic, admin), `garageName` (the name of the garage of the account's owner or receptionist membership, or of its mechanic card, or null), `carsCount` (the account's cars, for a driver), `status` (`active` or `suspended`), `since` (the time the state began: for `active` the creation time; for `suspended` the time of the last recorded change of the account's status to `suspended` in the activity log, or null when none is recorded; the entry matched is `subjectType: 'account'`, `field: 'status'`, `newValue` `"suspended"`, the way platform-figures matches a garage's approval), `createdAt`, and `count`: `{ kind: 'requests' | 'reviews' | 'age', value }` — `requests` with the driver's number of requests for an account whose first role is driver, `reviews` with the garage's number of reviews for a garage owner, with the number of reviews naming the mechanic for a mechanic, and `age` with the account's age in whole days (rounded down, so an account created today reads 0) for a receptionist, an admin and any account whose creation time is later than now minus 7 × 24 hours, whatever its role. The first role in the order above decides `count` and the source of `garageName` (driver+garage counts `requests`; garage takes the owner membership, receptionist its membership, mechanic its card); `roles` come from the account's roles only. An item MUST NOT carry the e-mail, the phone, a plate or anything else about the person.

_From 001-admin-recent-accounts._

### 001-FR-003 — Requests and reviews do not exist on the platform yet (no story has built them): `requests` and `reviews` counts MUST be answered as 0 by the one read that will later count them, so the rows read "0 cereri" / "0 recenzii" until those stories land, and the DTO does not change when they do.

_From 001-admin-recent-accounts._

### 001-FR-004 — `GET /api/v1/admin/accounts/summary` MUST answer `{ activeDrivers, garagesListed, mechanics }`: `activeDrivers` and `garagesListed` by the overview's definitions (161-FR-001: driver-role accounts with status `active` whose last activity is within 30 days; garages whose status is `approved`), read through the same platform-figures code, and `mechanics` the number of mechanic cards that carry an account (`accountId` set) at `approved` garages (story ST-1 scenario 1, MF-46 rule 2). The answer MUST be served from a Redis cache (key `admin:accounts:summary`, TTL 60 seconds, the same for every language), the database being read again after it expires and when Redis cannot be reached; the cache never holds the only copy of anything (Constitution VI).

_From 001-admin-recent-accounts._

### 001-FR-005 — Both reads MUST be admin-only through the actor check (ST-160's policy, 161-FR-003): any other role answers 404 `not_found`, a missing token 401 `sign_in_required`, a suspended account 403 `account_suspended`, every error as RFC 9457 problem details with a `code` (A28, contracts/admin-accounts.md); they are not refused by maintenance mode (160-FR-003). The DTOs live in the contracts library and the generated client is regenerated.

_From 001-admin-recent-accounts._

### 001-FR-006 — The admin "Utilizatori" view (`users`, capability `admin.users`) MUST be released (its "în curând" mark removed) and get its body: the three totals as the body's first line, directly under the view header (the admin frame renders no per-view subtitle; research.md D7), then a two-column grid (the list panel wider than the growth panel, as design.md records) that stacks into one column below 900 px.

_From 001-admin-recent-accounts._

### 001-FR-007 — The subtitle MUST read the three totals joined by " · " (drivers, garages, mechanics), each phrase in its number's plural form (the rules below win; every Romanian "service‑uri" uses U+2011 as FR-013 says) (Romanian `one` "1 șofer activ" / "1 service" / "1 mecanic", `few` "{n} șoferi activi" / "{n} service‑uri" / "{n} mecanici", `other` "{n} de șoferi activi" / "{n} de service‑uri" / "{n} de mecanici"; English `one` "1 active driver" / "1 garage" / "1 mechanic", `other` "{n} active drivers" / "{n} garages" / "{n} mechanics"), numbers grouped by the language (locale-formats: "12.480" / "12,480"). While the totals load the subtitle shows a skeleton line; when the read fails it reads "—" with the overview's info tip (161-FR-007), never 0 and never a number kept from an earlier failed read.

_From 001-admin-recent-accounts._

### 001-FR-008 — The panel "Conturi recente" / "Recent accounts" MUST show one row per item: the name over the detail; a lamp and the state; the count right-aligned. The detail MUST read the roles joined by " + " ("șofer", "service", "recepție", "mecanic", "admin" / "driver", "garage", "reception", "mechanic", "admin"), then " · " and, for a driver with no other role, the cars ("1 mașină", "{n} mașini", "fără mașină" / "1 car", "{n} cars", "no car"); for an account with a garage name, that name; for an admin or an account with neither, nothing after the roles.

_From 001-admin-recent-accounts._

### 001-FR-009 — The state MUST read, for `active`, a green lamp and "activ · din {month year}" / "active · since {Month year}" from `since` in the language's month names; for `suspended`, a red lamp and "suspendat · din {d mon. yyyy}" / "suspended · since {d Mon yyyy}" from `since`, or "suspendat" / "suspended" alone when `since` is null. The lamp colours are the Cockpit lamp tokens, and the state text is readable without the colour (the word carries the meaning).

_From 001-admin-recent-accounts._

### 001-FR-010 — The count MUST read, by `count.kind`: `requests` "{n} cereri" (`one` "1 cerere", `few` "{n} cereri", `other` "{n} de cereri" / EN "1 request", "{n} requests"); `reviews` "{n} recenzii" (`one` "1 recenzie", `few` "{n} recenzii", `other` "{n} de recenzii" / EN "1 review", "{n} reviews"); `age` "cont de {n} zile" (`one` "cont de 1 zi", `few` "cont de {n} zile", `other` "cont de {n} de zile" / EN "{n}-day-old account", "1-day-old account"); numbers grouped by the language.

_From 001-admin-recent-accounts._

### 001-FR-011 — The list MUST load its next page when a sentinel after the last loaded row comes into view (so pages chain without a scroll while the sentinel stays in view), appending the rows below, until `nextCursor` is null; a page load in flight is never doubled. While the first page loads the panel shows skeleton rows; with no account at all it reads "Niciun cont încă." / "No accounts yet."; when the first page fails it shows "Lista nu s-a încărcat" / "The list did not load" with a "Reîncearcă" / "Try again" button (a native button, reachable and activated by keyboard) that reads it again; when a later page fails the loaded rows stay and the same button sits at the foot of the list. The charts load and show whatever the list does.

_From 001-admin-recent-accounts._

### 001-FR-012 — The panel "Creștere, ultimele 12 luni" / "Growth, last 12 months" MUST render the overview's growth component (ST-162) unchanged: same read, same labels, latest values, tooltips, loading and failure behaviour.

_From 001-admin-recent-accounts._

### 001-FR-013 — On a 320 px phone the view MUST NOT scroll sideways; below 900 px each row is one column (name and detail, then lamp and state, then the count, left-aligned); the lamp, state and count MUST be 12 px or larger; light and dark follow the theme's tokens. Every text MUST exist in Romanian and English in the shared i18n files, a Romanian hyphenated word using U+2011 ("Service‑uri"), and switching the language re-renders the view without a reload or a re-read of the list.

_From 001-admin-recent-accounts._

### 001-FR-014 — The two new routes MUST ship their observability in the same change: request count, duration and error metrics by route and status, a structured log line per failure (route and status, never an account's name or cursor), a dashboard panel for the two routes and an alert on their error rate, listed in `infra/observability/inventory.json`; where `infra/observability/dashboards/` and `alerts/` do not exist yet (ST-879, ST-880), the entry records `none` with that reason and the metric and labels to chart, as the plan's Observability section says.

_From 001-admin-recent-accounts._

### 001-FR-015 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the newest-first order and the 20-row page; a stable cursor across an insert between pages; 400 for a cursor that does not decode; a `deleted` account left out; each role's detail and count (driver with and without cars, owner, mechanic, receptionist, admin, driver-and-garage); the 7-day age rule; a suspended account with and without a recorded suspension time; the absence of e-mail, phone and plate in every item; the three totals, the 60-second cache (a changed count within the window not shown, shown after it); 404 for each non-admin role, 401 without a token, 403 suspended; and the inventory check. A Playwright end-to-end test opens "Utilizatori" as the seeded admin, reads the subtitle, the seeded rows (the suspended driver red, the driver-and-garage row, the mechanic's garage name), scrolls to load a second page (the list stubbed in the browser with 25 rows, since the end-to-end suite also runs against a deployed address), and reads the two charts, on a phone and a desktop, in both languages; a non-admin opening the address lands on their own dashboard.

_From 001-admin-recent-accounts._
### 260-FR-001 — The system MUST keep platform rule change requests on the server, each with the rule key, the old and the new value, the reason, who asked and when, who decided and when, and a status among `requested`, `approved`, `refused` and `cancelled`. At most one request per rule MUST be in `requested` at a time, enforced by the database (a partial unique index), the losing insert answering 409 `change_pending`. The row MUST store the asker's and the decider's first names at write time; the asker and decider ids are kept without a foreign key, as the rule's last changer is, so a deleted account's request still shows its stored name.

_From 260-rule-off-confirm._

### 260-FR-002 — An admin MUST be able to ask to switch off a rule that needs two admins, sending only the rule key and a reason of 5–300 characters after trimming (no seen value, no `Idempotency-Key`). The checks run in this order: 404 when the key is unknown, test-only in production, or does not need two admins; 400 `validation_failed` when the reason is missing or out of range; 409 `stale_value` when the rule's current value is not `true`; 409 `change_pending` when a request for the rule already waits. The rule's value MUST NOT change on a request.

_From 260-rule-off-confirm._

### 260-FR-003 — An admin other than the asker MUST be able to approve or refuse a waiting request by its id. The asker MUST get 403 `own_request`. A request that is no longer `requested` MUST answer 409 `already_decided`, naming in its detail the admin who decided (or withdrew) and how. An unknown id MUST answer 404.

_From 260-rule-off-confirm._

### 260-FR-004 — The asker MUST be able to withdraw their own waiting request, being recorded as its decider; another admin MUST get 403 `not_requester`; a request no longer `requested` MUST answer 409 `already_decided`.

_From 260-rule-off-confirm._

### 260-FR-005 — An approval MUST, in one transaction: set the request to `approved` with the approver and the time; set the rule's value to `false` with the approver as who changed it last; write the request's decision audit entry and the rule's change audit entry; record `platform_rule.change_decided` and `platform_rule.changed`. A refusal or a withdrawal MUST, in one transaction, set the status, write its audit entry and record `platform_rule.change_decided`; the rule's value MUST stay as it is. Two decisions on the same request MUST serialise so that exactly one is saved.

_From 260-rule-off-confirm._

### 260-FR-006 — A request MUST, in one transaction, write the request row, its audit entry (actor the asker, action `create`, subject the request, kind `platform_rule.change_requested`, the rule key, old `true`, new `false` and the reason) and record `platform_rule.change_requested`. A decision's audit entry MUST be action `update`, subject the request, field `status`, old `requested`, new `approved`, `refused` or `cancelled`, actor the admin who decided or withdrew.

_From 260-rule-off-confirm._

### 260-FR-009 — An admin MUST be able to list a rule's requests: the waiting one, if any, and the last 5 others newest first by decision time (`decided_at`), each with its status, reason, the asker's first name and time, and the decider's first name and time when decided. The list, the request, the decision and the withdrawal routes MUST be admin-only: 404 for every other role, 401 without a session, as every `admin/*` route; the admin-route guard test's list of known routes gains them, its guard loop unchanged.

_From 260-rule-off-confirm._

### 260-FR-011 — While a request waits, the rule line MUST show the switch on and disabled, the mark "Așteaptă aprobarea altui admin" / "Waiting for another admin's approval", and a card with the asker's first name, the time (in the admin's language and Europe/Bucharest) and the reason. For an admin other than the asker the card MUST carry "Aprobă" / "Approve" and "Refuză" / "Refuse"; for the asker, "Retrage cererea" / "Withdraw the request". A button in flight MUST ignore a second press; on a refusal of the call the view MUST re-read and show an error line (for 409 `already_decided` and `change_pending`: no error line, the re-read shows the saved state). While the first read of the requests is in flight the rule line shows no waiting card and no history, and the switch keeps its last known state; when that read fails the view shows the existing rules error line and no card (a waiting request is then not shown, and the API still refuses a direct change).

_From 260-rule-off-confirm._

### 260-FR-012 — Under the rule line the view MUST show the last decided or withdrawn requests from the list (FR-009) as one line each: "Aprobată de {name} · {time}" / "Approved by {name} · {time}", "Refuzată de {name} · {time}" / "Refused by {name} · {time}", "Retrasă de {name} · {time}" / "Withdrawn by {name} · {time}", each with its reason; nothing when there are none.

_From 260-rule-off-confirm._

### 260-FR-013 — The `admin` module MUST expose one in-process read, `reviewPolicy()`, from the rule's current value: `{ mode: 'job_only' }` while `reviews_only_after_confirmed_job` is `true`; `{ mode: 'profile_allowed', source: 'profile' }` while it is `false`. It is read from the database at each call and exposes no HTTP route; the reviews stories call it.

_From 260-rule-off-confirm._

### 260-FR-014 — Switching the rule back on, and every other rule's change, MUST keep working with one admin through the existing change (258-FR-004); the test-only rules and maintenance take no requests.

_From 260-rule-off-confirm._

### 260-FR-015 — The dialog, the waiting card and the history lines MUST read at 320 px, 390 px, tablet and desktop, in light and dark, Romanian and English, with no sideways scroll; the dialog MUST be operable by keyboard, trap focus while open and return focus to the switch when closed; every text MUST live in the shared i18n files. The waiting state MUST be conveyed by text and not by colour alone; a live region MUST announce "waiting" and each decision to assistive technology when the live message re-reads the state; the dialog's reason field MUST name its range and its error through `aria-describedby`; every button and the switch MUST have a touch target of at least 44 × 44 px at 320 px and 390 px.

_From 260-rule-off-confirm._

### 260-FR-016 — The seed MUST hold a second admin account, so the end-to-end suite can ask as one admin and approve as another.

_From 260-rule-off-confirm._

### 163-FR-001 — The overview read (`GET /api/v1/admin/overview`) and the growth read (`GET /api/v1/admin/growth`) MUST accept two optional query parameters: `city` (a city key from the list of FR-003, or `all` for the whole country; the default for both reads is `all`) and, on the overview only, `period` (`default`, `today`, `7d`, `30d`, `month`, `12m`; default `default`); an unknown value answers 400 `validation_failed`. The DTOs live in the contracts library and the generated client is regenerated. Both reads keep the `admin/*` access policy (161-FR-003), and nothing in an answer is personal data.

_From 163-figures-period-city._

### 163-FR-002 — With a period other than `default`, the overview MUST compute, over the Europe/Bucharest range the period names (`today` from 00:00 today; `7d` and `30d` the 7 and 30 calendar days ending with today, today included, starting six and twenty-nine days before it; `month` from the 1st of the month; `12m` the 12 calendar months ending with the current one, starting on the 1st of the month eleven months back; each range ends now), `garagesApprovedInPeriod` (garages first approved in the range, counted as 161-FR-001 counts the month's approvals) and `activeDriversPeriodStart` (the active drivers from the snapshot row of the range's first day, absent when that row does not exist and always absent for `today`); `garagesListed`, `garagesWaiting` and `activeDrivers` (30 days ending on the range's last day) stay counts of now; the figures of 161-FR-002 join the period's rules when their entities exist (requests created in the range, the answer rate over the range, bookings confirmed in the range). With `default`, the answer is 161-FR-001's, unchanged.

_From 163-figures-period-city._

### 163-FR-003 — The overview answer MUST carry `cities`: `all` first, then every city with at least one approved garage, each with its key, its display name and its approved-garage count, ordered by that count, highest first, ties by name; a key is the city name's lower-case ASCII slug (`bucuresti`, `cluj-napoca`), stable across languages.

_From 163-figures-period-city._

### 163-FR-004 — With a city other than `all`, every count of garages in the overview and the growth read (`garagesListed`, `garagesApprovedThisMonth`, `garagesApprovedInPeriod`, the charts' listed garages) MUST cover only garages placed in that city, and the overview MUST add `cityGaragesWaiting`, the garages placed in that city waiting for verification, while `garagesWaiting` stays the platform total; `activeDrivers` and the charts' active drivers MUST count only drivers who sent a quote request to a garage in that city within the 30-day window, which is 0 (and `activeDriversMonthStart` / `activeDriversPeriodStart` absent) until quote requests exist on the platform; a city's snapshot rows hold no active-drivers value, so its active-drivers chart has no points. With `all`, every count is the whole platform's.

_From 163-figures-period-city._

### 163-FR-005 — The platform MUST record each garage's city: a workshop's from its address and a mobile mechanic's from its registered seat. The address look-up's suggestion MUST carry its locality, the place step MUST send the chosen suggestion's locality with the address, and the server MUST turn it into a city (key and display name), Bucharest's six sectors and "Bucharest" becoming "București"; a locality that is missing, not text, empty after trimming, longer than 80 characters or with no letter or digit to slug leaves the city unknown and never refuses the save. A garage with an address or seat and no city MUST be placed by the nightly snapshot job before it counts, up to 25 per night, from the look-up's first suggestion for its saved address; one the look-up cannot place keeps no city and is tried again the next night. A garage whose city is not known counts under `all` only.

_From 163-figures-period-city._

### 163-FR-006 — The daily snapshot (161-FR-009) MUST be keyed by day and city: each night it writes the `all` row and one row per city with at least one approved garage, each holding that city's `garagesListed` and `garagesApprovedThisMonth` as FR-004 counts them and no `activeDrivers` value (only the `all` row holds one); existing rows become `all` rows; the one-schedule rule (161-FR-010) is unchanged. The growth read for a city reads that city's rows with 162-FR-002's month-end rule and computes the current month live for the city.

_From 163-figures-period-city._

### 163-FR-007 — The admin header MUST show the chosen city in its line in place of the fixed "București" (160-FR-008; "Toată țara" / "Whole country" for `all`), with its waiting count from `cityGaragesWaiting` for a city and `garagesWaiting` for `all`; the "Service‑uri" counter (160-FR-010) MUST keep counting every garage waiting on the platform.

_From 163-figures-period-city._

### 163-FR-008 — From 768 px the header's city name MUST be a drop-down listing the cities of FR-003 ("Toată țara" first, each city with its name), the current one marked, and a segmented period control to its right with the six periods in order: "Implicit", "Azi", "Ultimele 7 zile", "Ultimele 30 de zile", "Luna aceasta", "Ultimele 12 luni" (English "Default", "Today", "Last 7 days", "Last 30 days", "This month", "Last 12 months"); below 768 px the header MUST show one filter button, whose accessible name names the current city and period, opening the shared bottom sheet (`overlays`) with the same city list and period choice. The drop-down and the sheet are reachable by keyboard, the periods are a radio group, and Escape closes without a change, focus returning to the control that opened it.

_From 163-figures-period-city._

### 163-FR-009 — The chosen city and period MUST live in the page's query string (`?city=<key>&period=<key>`; a default is not written) on the "Panou" route and be applied on its load and reload; leaving "Panou" for another admin view drops the choice, and the shell's header and counter read the whole country there; an unknown city falls back to `all` and an unknown period to `default`, the address corrected to what was applied, with no error shown.

_From 163-figures-period-city._

### 163-FR-010 — Changing a choice MUST re-read the overview and the growth with the new parameters, showing the tiles' skeletons (161-FR-007) and the charts' skeletons (162-FR-008) while the reads are on their way, the rest of the page, the menu and the controls unchanged, the figures region marked busy for assistive technology until the reads settle; only the answer to the latest choice is shown (an older, slower answer is dropped); a failed read keeps 161-FR-007's "—" with the info tip and 162-FR-008's retry; the shell's live re-read (160-FR-012) carries the current choice. With no data for the choice each computed tile reads 0 and each chart "Încă nu sunt date" / "No data yet".

_From 163-figures-period-city._

### 163-FR-011 — In a period other than `default`, the garages tile's line MUST read "+{n} {period}" / "+{n} {period}" from `garagesApprovedInPeriod` with the period's line form ("azi", "în ultimele 7 zile", "în ultimele 30 de zile", "luna asta", "în ultimele 12 luni" / "today", "in the last 7 days", "in the last 30 days", "this month", "in the last 12 months"), and the active-drivers tile's line the change since `activeDriversPeriodStart` with 161-FR-005's sign rule, absent when that figure is absent; the tiles' accessible names (161-FR-013) carry the new lines.

_From 163-figures-period-city._

### 163-FR-012 — Every new text MUST exist in Romanian and English in the shared i18n files (U+2011 in hyphenated Romanian words); city names are shown as recorded except "București" / "Bucharest"; the controls use the Cockpit type tokens (12, 13 and 16 px; headings 20, 24, 32, 40 px), and on a phone their buttons, list items and options are 16 px or larger, labels 12–13 px, the theme's default buttons and tabs (16 px) used as they are; at 320 px the page MUST NOT scroll sideways.

_From 163-figures-period-city._

### 163-FR-013 — Tests MUST cover, against seeded data on a real database: each period's Europe/Bucharest range (the first and last instant of `today`, `7d`, `30d`, `month`, `12m`); the period's approvals and the period-start row with and without a row; city filtering of listed, approved, waiting garages and of the charts; the active-driver city rule (0 while no requests exist; a request to a garage in the city counts the driver once requests exist is the later story's test); a garage with no city under `all` only; the per-city snapshot rows and the `all` row; 400 for an unknown key; 404 for each non-admin role; an unknown city in the address falling back. An end-to-end check, as the seeded admin: pick "Ultimele 7 zile" and a city with seeded data, read the tiles' lines and the header, reload the page and find the choice kept, at a phone (the sheet) and a desktop (the drop-down and the segments), in both languages.

_From 163-figures-period-city._

### 384-FR-001 — The system MUST compute, for every approved garage, a public response rate over the garage's REQUEST_RECIPIENT rows created (the moment the request reached the garage, `request_recipient.created_at`) in the last RESPONSE_RATE_PERIOD_DAYS (30) days before the job's start instant (one `now` taken when the attempt's processor starts), counting all hours of every day. Counted rows exclude: a recipient whose request is `closed` with `closed_reason` `cancelled` or `account_closed` while the recipient never answered (status `closed`); a recipient with status `closed` for any reason (a suspension closed it); and a recipient with status `waiting` created less than RESPONSE_RATE_WINDOW_HOURS (24) hours before the job's start instant.

_From 384-response-rate._

### 384-FR-002 — A counted row is answered within a day when its status is `quoted` or `declined` and `answered_at` − the recipient's `created_at` ≤ RESPONSE_RATE_WINDOW_HOURS hours. A `quoted`/`declined` row with no `answered_at` counts as not answered. Every other counted row (`waiting` 24 hours or older, `expired`, or `quoted`/`declined` later than 24 hours) counts as not answered. An undone decline returns the row to `waiting`, so it counts as not answered unless answered again.

_From 384-response-rate._

### 384-FR-003 — The rate MUST be answered-within-a-day ÷ counted, expressed as a whole percent rounded down (11 of 12 → 91; 46 of 50 → 92; 0 of 5 → 0; 5 of 5 → 100); with 0 counted rows there is no rate.

_From 384-response-rate._

### 384-FR-004 — The system MUST store per garage one GARAGE_RESPONSE_STATS row: `garage_id`, `requests_30d` (counted rows), `answered_within_day_30d`, `lifetime_requests` (all REQUEST_RECIPIENT rows of the garage, ever, no exclusion: `closed` rows count toward the 10 too), `rate` (null when `requests_30d` is 0), `computed_at`; PostgreSQL is the only copy (Principle VI). No audit history: it is a computed figure.

_From 384-response-rate._

### 384-FR-005 — The job MUST run every night at 01:00 Europe/Bucharest in the existing `insights` queue as its own job name, beside `platform-daily`, with 3 attempts and exponential backoff from 60 seconds; each garage's row and its event are written in one transaction of their own, so a failed attempt never leaves a garage with a partial write, keeps the last stored value of every garage it had not reached, and the retry (the same computation) writes only what still differs; the final failed attempt writes one error log line with the job id (876-FR-007, the existing `logFinalFailure`), an earlier failed attempt none. The three constants RESPONSE_RATE_PERIOD_DAYS, RESPONSE_RATE_WINDOW_HOURS and RESPONSE_RATE_MIN_REQUESTS MUST be read from one module.

_From 384-response-rate._

### 384-FR-006 — The job MUST write only the garages whose stored figures (`requests_30d`, `answered_within_day_30d`, `lifetime_requests`, `rate`) differ from the stored row, inserting a row for a garage with none, and MUST emit `response_stats.updated` (object id = garageId, audience `public:garage:{garageId}`) through the outbox, in the same transaction as the write, once per garage whose shown value (FR-008's state and rate) changed; a write with no change to the shown value emits nothing. `response_stats.updated` is already listed in the contracts library's event kinds (`libs/contracts/src/events.ts`).

_From 384-response-rate._

### 384-FR-010 — Observability ships with the change: the job reports through the worker's existing `motorfix_jobs_total` and `motorfix_job_duration_seconds` by queue and job name (876-FR-009) and logs, per run, the count of garages computed and written at info level with the job id and no garage id; the `insights` queue's entry in `infra/observability/inventory.json` names the new job, its panel on `motorfix-queues` and its alert or the reason there is none; `node scripts/observability-inventory.ts` passes.

_From 384-response-rate._

### 384-FR-011 — Tests MUST cover, in Jest with fixtures on real PostgreSQL: within 24 hours, 25 hours across a Sunday, a decline, an undone decline, an expiry, a cancellation before answer, a fresh waiting request (left out) and a 30-hour waiting one (counted against), a suspension-closed recipient, 9 and 10 lifetime requests, 10+ lifetime with none in 30 days, rounding down (11/12 → 91), the unchanged garage not written and no event, the changed garage's event in the write's transaction, the profile answer's `responseRate` in each of the three states, and the job's retry setting; in Playwright: a garage seeded with 12 requests, 11 answered within a day, the job run, and the profile reading "Răspunde la 91% din cereri într-o zi" in Romanian, at the four sizes, light and dark, with no sideways scroll at 320 px.

_From 384-response-rate._

## Retired

- `160-FR-001` — superseded by `161-FR-001` (2026-10-07)
- `160-FR-002` — superseded by `161-FR-003` (2026-10-07)
- `160-FR-011` — superseded by `161-FR-007` (2026-10-07)
- `160-FR-014` — superseded by `161-FR-011` (2026-10-07)

- `160-FR-006` — superseded by `001-FR-006` (2026-10-08)
- `258-FR-010` — superseded by `260-FR-010` (2026-10-08)

- `160-FR-008` — superseded by `163-FR-007` (2026-10-09)
- `160-FR-010` — superseded by `163-FR-007` (2026-10-09)
- `161-FR-001` — superseded by `163-FR-001` (2026-10-09)
- `161-FR-005` — superseded by `163-FR-011` (2026-10-09)
- `161-FR-009` — superseded by `163-FR-006` (2026-10-09)
- `162-FR-001` — superseded by `163-FR-001` (2026-10-09)
- `162-FR-002` — superseded by `163-FR-006` (2026-10-09)

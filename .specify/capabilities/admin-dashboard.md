---
capability: admin-dashboard
updated: 2026-10-17
features:
  - 160-admin-dashboard-menu
  - 161-headline-numbers
  - 258-platform-rules-switches
  - 162-growth-12-months
  - 261-maintenance-mode
  - 001-admin-recent-accounts
  - 260-rule-off-confirm
  - 163-figures-period-city
  - 384-response-rate
  - 002-find-account-search
  - 250-launch-analytics-events
  - 301-verification-queue
  - 103-demand-brands-jobs
  - 066-suspended-garages
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

### 301-FR-009 — Every open queue MUST re-read its rows and counts on `verification.submitted`, `verification.opened`, `verification.check_recorded`, `verification.decided` and `verification.reopened` from the admin's stream, through the dashboards' shared live re-read (one re-read per 300 ms burst), and on every reconnect, each re-read asking from offset 0 for as many rows as are loaded (at least one page); the admin shell's re-read list (160-FR-012) gains `verification.opened` and `verification.check_recorded`.

_From 301-verification-queue._

### 160-FR-013 — The seed MUST add, outside production and only once (a second run changes nothing), one `submitted` verification file to the seeded garage `service-dobre` and one `in_review` file to `atelier-dinamo`, both `draft` garages, so a development or test database has 2 garages waiting and the end-to-end check reads a known count; `atelier-test` keeps no file.

_From 160-admin-dashboard-menu._

### 161-FR-011 — Every text of the tiles MUST exist in Romanian and English in the shared i18n files; a Romanian word joined by a hyphen MUST use U+2011 ("Service‑uri"); the label, number and line of a tile MUST be 12 px or larger on a phone.

_From 161-headline-numbers._

### 250-FR-008 — The admin overview MUST show the four S9 figures as database counts: garages live (approved now, suspended left out, as today), requests sent (quote requests created in the chosen period, a request to several garages once), answer rate (share of garage recipients of the last 30 days that quoted or declined within 24 hours, over all hours; none when no recipient; rounded down to a whole percent) and bookings (bookings confirmed in the chosen period), each scoped by the overview's period (default: the current Bucharest month, as garages approved this month) and city as the existing figures are; the answer rate's 30-day window is fixed and does not follow the period. The reported-reviews tile keeps "—" and "în curând" until MF-45.

_From 250-launch-analytics-events._

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

### 261-FR-001 — While the platform rule `maintenance_mode` is on, every API call by a visitor or by a session not holding the `admin` role MUST be answered 503 with code `maintenance` and the header `Retry-After: 300`, before any handler runs, so nothing is read or written for it. A call with a valid session whose account holds `admin` (whatever role the session has switched to) MUST be answered as when maintenance is off. A call with no session, or a valid session of a non-admin account, gets 503 `maintenance`, ahead of any 403 or 404 the route's guard would otherwise answer (an address no route matches stays 404). A token that does not resolve (expired, invalid, a suspended account) answers 401 or 403 as usual, so the app can renew an admin's session; a renewed non-admin session then gets the 503.

_From 261-maintenance-mode._

### 261-FR-002 — These MUST stay open to everyone during maintenance: `GET /api/v1/platform-status`; the live streams (public and signed in), so the `system` channel reaches every open connection; the sign-in calls (e-mail, phone code and phone sign-in, the OAuth routes), which open a session only for an account holding `admin` as the accounts capability already requires; session refresh and sign-out, which open nothing new; sign-up, whose own check refuses a valid request after counting it against the hourly limit (080-FR-006); and the password reset (ask, check, complete), where completing refuses anyone but an admin (569-FR-002), so an admin can still reset a forgotten password; asking for a link behaves as before this feature; the health checks under `/health`; and the e-mail provider's callbacks under `/webhooks/brevo`. Sign-out-everywhere is not among them.

_From 261-maintenance-mode._

### 261-FR-003 — `GET /api/v1/platform-status` MUST be public and answer `{ maintenance: boolean }`, the current value of the rule, with no cache beyond the flag's own freshness (FR-004).

_From 261-maintenance-mode._

### 261-FR-004 — The flag MUST be read on each call from the shared fast store (Redis), which the change of `maintenance_mode` writes right after its transaction commits (not through the worker), so a change takes effect on every running copy of the API within 2 seconds, with no restart (if that write is lost, the stored value expires within 60 seconds and is read afresh from the database); when the store holds no value it is filled from the database, and when it cannot be read the rule MUST be read from the database instead. A store failure MUST never decide a call either way. The database stays the truth.

_From 261-maintenance-mode._

### 261-FR-006 — Existing non-admin sessions MUST NOT be ended by maintenance: the same session works again when maintenance ends, and its refresh keeps working meanwhile.

_From 261-maintenance-mode._

### 261-FR-007 — The worker MUST keep running during maintenance: reminders, timers, e-mails and the outbox continue, and no deadline is paused or extended.

_From 261-maintenance-mode._

### 261-FR-008 — While maintenance is on, every page for a visitor or a non-admin session MUST show the maintenance page instead of its content: the MotorFix wordmark, the heading and the message "MotorFix este în mentenanță. Revenim în curând." (EN "MotorFix is down for maintenance. We'll be back soon."), the RO / EN language switch, and a quiet link "Administrator? Intră în cont" (EN "Admin? Sign in") to `/admin`; no other sign-in or sign-up control. The texts MUST come from i18n keys in both languages.

_From 261-maintenance-mode._

### 261-FR-010 — A 503 `maintenance` answer to any call MUST show the maintenance page even when the live connection is lost, and the app MUST read `GET /api/v1/platform-status` at boot so a visitor who opens the site during maintenance sees the page before any other call.

_From 261-maintenance-mode._

### 261-FR-011 — The server-rendered response for every server-rendered page (the public pages search engines read) during maintenance MUST carry status 503 and `Retry-After: 300` with the maintenance page as its body; the server does not read the session. The client-rendered `/app/**` addresses keep answering their shell, and the browser shows the page. The app in the browser then shows the real page only for an admin session.

_From 261-maintenance-mode._

### 261-FR-012 — `/admin` MUST open the admin sign-in page: the existing sign-in dialog (e-mail and password, with the phone and provider options the dialog already has) over the maintenance page while maintenance is on, and over the home page when it is off. After an admin signs in it MUST open the admin dashboard; a non-admin sign-in MUST show the existing `maintenance` message in the dialog and leave the maintenance page.

_From 261-maintenance-mode._

### 261-FR-013 — For a signed-in admin while maintenance is on, every page MUST show a thin banner "Mentenanță activă" (EN "Maintenance on") at the top, announced to screen readers as a status, in the warning colour tokens, and the page otherwise unchanged; the banner MUST appear and go within 5 seconds of the change, without a reload. The `admin/*` routes keep working as 160-FR-003 requires.

_From 261-maintenance-mode._

### 261-FR-014 — The maintenance page and the banner MUST read at 320 px, 390 px, tablet and desktop, in light and dark, Romanian and English, with no sideways scroll, the smallest text at the label size and tap targets of 44 px.

_From 261-maintenance-mode._

### 261-FR-015 — The MCP app reads the stored maintenance state itself (`storedMaintenance`, the `MAINTENANCE` provider in `apps/mcp/src/mcp.module.ts`), and its tool registry (`libs/mcp-tools/src/registry.ts`) refuses every acting tool while maintenance is on with the `maintenance` tool error, which names maintenance and says reading still works; read tools keep answering and nothing is changed.

_From 261-maintenance-mode._

### 261-FR-016 — The guard's refusals MUST be counted (a metric with the route and role class), a switch on or off MUST be logged, and the new endpoint and the guard MUST be listed in `infra/observability/inventory.json` with their panel and alert (or why not), as the observability rule requires.

_From 261-maintenance-mode._

### 261-FR-017 — Tests MUST cover, in Jest on real PostgreSQL and Redis: 503 `maintenance` with `Retry-After` for a visitor, a driver and a garage owner on several calls and 200 for an admin; the status call, the live streams, the health checks and the Brevo callback staying open; sign-in opening a session only for an admin; the flag taking effect after a change and the database fallback when the fast store fails; the MCP part holding by absence (no tool exists; a future tool's pass-through is that tool's own test). A Playwright end-to-end test MUST, with a driver tab open on results, switch maintenance on as an admin, check the driver tab shows the maintenance page without a reload, sign in as an admin through `/admin`, switch it off and check the driver tab comes back.

_From 261-maintenance-mode._

### 002-FR-001 — `GET /api/v1/admin/accounts` MUST accept, beside `cursor`, the optional query parameters `q` (the search text), `role` (one or more of `driver`, `garage`, `receptionist`, `mechanic`, `admin`, repeated or comma-separated) and `status` (one of `active`, `watch`, `suspended`), and answer the accounts that satisfy every given one, with ST-1's order (newest first by creation time, then id), page size (20), cursor and item shape unchanged (001-FR-001, 001-FR-002); `nextCursor` chains within the same search and filters. A deleted account MUST never be answered, whatever it once held, for any search or filter.

_From 002-find-account-search._

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

### 002-FR-011 — With a search or a filter in force the panel MUST show, above the rows, the count line from `total` in the number's plural form (Romanian `one` "1 cont găsit", `few` "{n} conturi găsite", `other` "{n} de conturi găsite"; English `one` "1 account found", `other` "{n} accounts found"; numbers grouped by the language), in a live region so a screen reader hears each new result; with neither, no count line and the panel exactly as ST-1 built it (001-FR-008 to 001-FR-011: rows, scroll paging, loading, empty "Niciun cont încă.", failure with "Reîncearcă").

_From 002-find-account-search._

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

### 002-FR-001 — `GET /api/v1/admin/accounts` MUST accept, beside `cursor`, the optional query parameters `q` (the search text), `role` (one or more of `driver`, `garage`, `receptionist`, `mechanic`, `admin`, repeated or comma-separated) and `status` (one of `active`, `watch`, `suspended`), and answer the accounts that satisfy every given one, with ST-1's order (newest first by creation time, then id), page size (20), cursor and item shape unchanged (001-FR-001, 001-FR-002); `nextCursor` chains within the same search and filters. A deleted account MUST never be answered, whatever it once held, for any search or filter.

_From 002-find-account-search._

### 002-FR-002 — `q` MUST be trimmed and its inner whitespace collapsed to one space; after that, a `q` of fewer than 2 characters MUST be treated as absent, and one longer than 80 characters MUST answer 400 `invalid_query`. A `role` value outside the five, a `status` outside the three, or a repeated `status` MUST answer 400 `invalid_filter`. Every error is RFC 9457 problem details with a `code`, as the route already does.

_From 002-find-account-search._

### 002-FR-003 — A text `q` MUST match an account when it is contained (case-insensitive, accent-insensitive) in the account's name, or in the name of any garage the account works at (every owner or receptionist membership and the mechanic card, whichever garage the row itself names), or when it is contained, case-insensitive, in the account's e-mail. Accent folding MUST map at least ș, ş, ț, ţ, ă, â, î (upper and lower) to s, t, a, i, and is applied to the stored text and to the query alike; the query is first normalised to NFC, so a letter typed as a base letter plus a combining mark matches as the precomposed one. The query is literal text: `%`, `_` and `\` in it match themselves and are never wildcards.

_From 002-find-account-search._

### 002-FR-004 — A phone `q` — one that, after removing spaces, dots, dashes, parentheses and a leading `+` or `00`, consists of 4 to 15 digits — MUST also be matched against the account's phone: the query is rewritten as sign-in rewrites a number (393-FR-001: separators dropped, a leading `0` becomes `+40`, a leading `00` becomes `+`, a `+` keeps its country) but without sign-in's E.164 check, so a partial such as "0722" becomes `+40722`, and an account matches when its stored phone, digits only, contains the normalised query's digits. The text match of FR-003 still applies to the same `q`, so a phone-looking query also finds a name or e-mail containing those digits.

_From 002-find-account-search._

### 002-FR-005 — The `role` filter MUST answer the accounts holding at least one of the given roles, each account once; the `status` filter MUST answer, for `active` and `suspended`, the accounts with that status, and for `watch`, the accounts with an open watch, of which there are none until ST-4 defines one (an empty page with `total` 0, never an error). A `role` given as an empty value (`role=`) or repeating a role is read as the roles named once each; an empty `role` alone is no role filter. The filters combine with each other and with `q` by intersection.

_From 002-find-account-search._

### 002-FR-006 — When `q`, `role` or `status` is given, every page MUST carry `total`, the number of accounts the whole search and filters match (deleted ones excluded), counted at that page's read; a read with none of them MUST carry no `total`, as today. The search MUST use indexes so that its cost does not grow in proportion to the number of accounts for the name, e-mail and phone matches (the plan chooses them; SC-005 is the target).

_From 002-find-account-search._

### 002-FR-007 — The route's admin-only policy MUST be unchanged for every parameter (001-FR-005: 404 `not_found` for any other role, 401 `sign_in_required` without a token, 403 `account_suspended`); the query parameters MUST be validated at the edge from the contracts library, with the generated client regenerated. Searching is a read: it MUST write no audit entry, and no log line (failure or otherwise) MUST carry `q`, an e-mail or a phone (001-FR-014's failure log carries the route and status only), and neither the web server's request logs nor any client-side telemetry event MUST carry the view's address `q`.

_From 002-find-account-search._

### 002-FR-008 — The "Utilizatori" view MUST show, above the panel "Conturi recente", a search box labelled "Caută după nume, e‑mail sau telefon" / "Search by name, e‑mail or phone" (the label as the placeholder and the accessible name; `type=search`, `autocomplete=off`, a clear control), a role filter and a state filter, in one row from 768 px (the search box, then a role drop-down in which several roles can be ticked, then a state drop-down with "Toate stările" / "All states", "activ" / "active", "sub observație" / "under watch", "suspendat" / "suspended"; the role drop-down reads "Toate rolurile" / "All roles" with none ticked, the one role's name with one, "{n} roluri" / "{n} roles" with more) and, below 768 px, the search box over one filter button that opens a bottom sheet with the same roles (as ticks) and states (as one choice), "Aplică" / "Apply" closing it with the choice and Escape or the close button with no change, the same pattern as the admin header's filters. Role labels: "șofer", "service", "recepție", "mecanic", "admin" / "driver", "garage", "reception", "mechanic", "admin".

_From 002-find-account-search._

### 002-FR-009 — The view MUST read the list 300 ms after the last change to the search box's text (a change within that time restarts the wait), and at once when a filter changes; a search text of fewer than 2 characters after trimming MUST be sent as no search. A read in flight when another starts MUST be discarded, as MUST a next-page read in flight when the search or filters change; the list never mixes two reads' rows.

_From 002-find-account-search._

### 002-FR-010 — The search text and the filters MUST live in the view's address as `q`, `role` (comma-separated) and `status`, written as the admin changes them (a history entry per applied change: each filter apply and each search text committed after the 300 ms wait, so the browser's back button restores the previous state), without touching the shell's other address values; opening the view with them in the address MUST fill the controls and read the narrowed list; an unknown `role` or `status` value in the address MUST be dropped from the address and not sent. The view MUST keep the first 80 characters of a longer search text.

_From 002-find-account-search._

### 002-FR-011 — With a search or a filter in force the panel MUST show, above the rows, the count line from `total` in the number's plural form (Romanian `one` "1 cont găsit", `few` "{n} conturi găsite", `other` "{n} de conturi găsite"; English `one` "1 account found", `other` "{n} accounts found"; numbers grouped by the language), in a live region so a screen reader hears each new result; with neither, no count line and the panel exactly as ST-1 built it (001-FR-008 to 001-FR-011: rows, scroll paging, loading, empty "Niciun cont încă.", failure with "Reîncearcă").

_From 002-find-account-search._

### 002-FR-012 — With a search or a filter in force and no match the panel MUST read "Niciun cont nu se potrivește." / "No account matches." with a native button "Șterge filtrele" / "Clear the filters" that empties the search box, unticks every role, sets the state to all, writes the address and reads the unfiltered list, then puts focus in the search box. While a search reads its first page the panel shows the skeleton rows under the controls, the controls staying usable; when the read fails it shows ST-1's failure state with "Reîncearcă", which reads the same search again.

_From 002-find-account-search._

### 002-FR-013 — On a 320 px phone the view MUST NOT scroll sideways; the search box, filter button, drop-downs and sheet MUST follow the Cockpit theme's tokens in light and dark, with a visible focus ring, every control reachable and operable by keyboard (the role drop-down's ticks included), and the controls' text 12 px or larger and every tap target on a phone at least 44 px high. The search box is in a landmark with the accessible name of its label, the drop-down's and sheet's controls are named by their visible labels, the sheet moves focus into itself when it opens and returns it to the filter button when it closes, and no state is conveyed by colour alone. Every text MUST exist in Romanian and English in the shared i18n files, a Romanian hyphenated word using U+2011 ("e‑mail"), and switching the language re-renders the controls, count line and empty state without a reload or a re-read.

_From 002-find-account-search._

### 002-FR-014 — No new route, service, queue or outside call is added, so no new inventory entry is owed; the existing route's request, duration and error metrics (001-FR-014) MUST cover the parameterised reads, and the PR's Observability section says so.

_From 002-find-account-search._

### 002-FR-015 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the name match with and without accents in the query and in the stored name, upper and lower case; a partial e-mail; every phone form of scenario 1.3, a foreign country code and a 4-digit partial ("0722"); a 2-digit query not matching a phone; the garage-name match for an owner, a mechanic and a receptionist, and an account working at two garages found by either name; `role` with one and with two values, an account holding both counted once; `status` for each value, `watch` answering none; each filter combined with `q`; `total` present and right with a filter, absent without; the cursor chaining within a search; a deleted account never matching by name, e-mail or phone; a one-character `q` reading as none; 400 for a `q` over 80 characters and for an unknown role or status; 404 for each non-admin role, 401 without a token; and that the failure log carries no query. Web unit tests cover the 300 ms wait and its restart, the 2-character minimum, the discarded in-flight read, the address round trip (write, read, unknown values dropped), the count line's plural forms and the clear button. A Playwright end-to-end test, as the seeded admin, searches for a seeded driver by phone written with spaces and reads that one row, then filters the mechanics by "activ" and reads them, on a phone (through the sheet) and a desktop, in both languages, and reloads to read the same state.

_From 002-find-account-search._

### 250-FR-007 — The night job MUST write, on the whole-country row of the previous Europe/Bucharest day, the funnel counts of that day: requests whose first quote was sent that day, requests whose quote was accepted that day, bookings confirmed that day (whatever happened to them after), jobs that reached done that day, reviews posted that day (0 until reviews exist); a request counted once however many garages it went to; the counts written onto that day's existing row with its other fields untouched (a day whose row the night job missed gets no funnel counts: the job never back-fills a missed day, 161-FR-010), and a rerun replacing the day's counts.

_From 250-launch-analytics-events._

### 103-FR-001 — An admin MUST be able to read the demand of the last 30 days (`GET /api/v1/admin/demand`): the window's first and last Europe/Bucharest day, the window's total requests, every brand with at least one request in the window (its name from the car snapshot and its request count) and every job type with at least one request (its key, its Romanian and English names and its request count), each list ordered by count descending, then brands by their stored name and jobs by their key, in plain code-point order. Nothing in the answer is personal data; every value is a count or a catalogue name. The DTO lives in the contracts library and the generated client is regenerated.

_From 103-demand-brands-jobs._

### 103-FR-002 — The demand read MUST follow the `admin/*` access policy (161-FR-003): an admin reads it, any other role answers 404 `not_found`, a missing token 401 `sign_in_required`, a suspended account 403 `account_suspended`; the route joins the admin-route guard test's list of known routes. A failure inside the read answers the API's standard error body (no partial answer).

_From 103-demand-brands-jobs._

### 103-FR-003 — A request MUST count once for its brand (the exact brand string stored in its car snapshot, not normalised; an empty string is its own brand, labelled as stored) and once for each of its REQUEST_JOB rows, in the calendar day of its creation in Europe/Bucharest, whatever its status today and however many garages it was sent to; so the brand counts add up to the window's total requests and the job counts add up to the window's request-job rows.

_From 103-demand-brands-jobs._

### 103-FR-004 — The window MUST be the 30 Europe/Bucharest calendar days ending today: today, counted live from the requests at every read, and the 29 closed days before it, read from DEMAND_DAILY; a closed day of the window that has no DEMAND_DAILY total row MUST be counted live too, so the answer is complete before the first night and after a missed one. Days before the first Europe/Bucharest day of the window are never counted.

_From 103-demand-brands-jobs._

### 103-FR-005 — The `insights` nightly job (01:00 Europe/Bucharest, `0 1 * * *`, beside the existing schedulers with its own id) MUST write to DEMAND_DAILY, for every closed day of the last 30 that has no total row yet, one row per brand with at least one request (dimension `brand`, key the snapshot's brand name, requests), one row per job type with at least one request-job row (dimension `job`, key the job type's key, requests) and always one total row (dimension `total`, key `all`, the day's requests, 0 included), in one transaction per day; running it again for a written day changes nothing. The job and the new route are listed in the observability inventory with their dashboard and alerts.

_From 103-demand-brands-jobs._

### 103-FR-006 — The admin dashboard MUST get the view "Mărci și lucrări" / "Brands and jobs" (the existing unreleased placeholder: path `catalogue`, capability `admin.catalogue`, tab "Mărci" / "Brands", in the side menu and the tab bar as the other admin views, released by this story), whose body opens with the subtitle "Ce au cerut șoferii în ultimele 30 de zile" / "What drivers asked for in the last 30 days" as its first line under the view header, then two panels in this order: "Cereri pe marcă, 30 de zile" / "Requests by brand, 30 days" and "Cereri pe lucrare, 30 de zile" / "Requests by job, 30 days". Each panel is a labelled section whose heading is its title and holds one bar chart in the shared Cockpit chart style (cockpit-charts) with the count unit, one bar per brand or job, most first, labelled with the brand name or the job's name in the interface language.

_From 103-demand-brands-jobs._

### 103-FR-007 — Each report MUST show at most 10 bars; when the read holds more than 10 brands (jobs), the panel MUST show under the chart a button "Vezi toate mărcile" / "See all brands" ("Vezi toate lucrările" / "See all jobs") that reveals, in the panel, the full list of brands (jobs) with their counts, most first, and becomes "Arată mai puține" / "Show fewer", which hides it again; with 10 or fewer the button is not rendered.

_From 103-demand-brands-jobs._

### 103-FR-008 — "Panou" MUST show, under the growth panel (162-FR-004), one panel "Cereri pe marcă, 30 de zile" / "Requests by brand, 30 days" with the top 8 brands of the same demand read as a bar chart in the shared chart style, and no "Vezi toate" button; "Panou" shows no requests-by-job report. The tiles and the growth panel are not affected by this panel's loading or failure.

_From 103-demand-brands-jobs._

### 103-FR-009 — Every count on screen MUST be formatted through the shared locale formatters for the current language (Romanian grouping "2.140", English grouping "2,140") in the chart's bars, tooltips, summary, table and the full list, and the subtitle, titles, job names and numbers MUST re-render in the other language when the admin switches it, without a reload; every text exists in Romanian and English in the shared i18n files.

_From 103-demand-brands-jobs._

### 103-FR-010 — While the demand read is on its way, each report, and the overview panel, MUST show the shared chart skeleton; when the read fails, each report MUST show its own shared retry button "Reîncearcă" / "Retry", and each press sends one read and redraws both reports from it; when the read succeeds with no request in the window, each report MUST show "Încă nu sunt cereri în ultimele 30 de zile." / "No requests in the last 30 days yet." in place of its chart. The view and the overview panel read the demand once when they open and again on retry; no event, polling or cache is added.

_From 103-demand-brands-jobs._

### 103-FR-011 — Below 768 px the two panels of "Mărci și lucrări" MUST stack one under the other; from 768 px they MUST sit side by side; at 320 px neither the view nor "Panou" scrolls sideways, every rendered label is 12 px or larger, and a brand or job whose axis label is skipped stays reachable through the shared chart's tooltip and "Vezi ca tabel" table, and the subtitle and counts are 12 px or larger on a phone.

_From 103-demand-brands-jobs._

### 103-FR-012 — Tests MUST cover, on a real database: one request with two jobs counted once per brand and once per job; a request sent to several garages counted once; the Europe/Bucharest day edge at 00:00 and the window's first day; today counted live beside DEMAND_DAILY rows; a closed day without rows counted live; the nightly job's rows and its idempotence; brand counts adding up to the total; ties ordered by stored brand name and job key; an empty brand string counted as its own brand; top 10 with the full list and top 8 on the overview; 404 for each non-admin role. An end-to-end check answers the demand read for three brands and two jobs (stubbed in the browser, as the growth check does, since the suite also runs against a deployed address), opens "Mărci și lucrări" as the seeded admin and reads both reports and then the overview panel, on a phone and a desktop, in both languages.

_From 103-demand-brands-jobs._

### 103-FR-013 — Accessibility: the "Vezi toate" / "Arată mai puține" buttons are native buttons reachable and operable by keyboard, in the page's tab order after their chart, and carry `aria-expanded` for the list they reveal; each retry button is a native button; each chart keeps the shared chart's text alternative (its summary line and the "Vezi ca tabel" table, so no figure is conveyed by bar length or colour alone); bar colours meet the shared chart's contrast in light and dark; after a retry press focus stays on the control that was pressed or moves to the redrawn panel's heading, never to the page top; loading and error changes are announced through the shared chart's live region. A brand or job name too long for its label at 320 px wraps or is truncated with the full name in the tooltip and the table, never widening the page.

_From 103-demand-brands-jobs._

### 066-FR-006 — The admin "Service-uri" view MUST show the counts line as the body's first line, directly under the view header, before the queue: "{listed} listate · {waiting} de verificat · {suspended} suspendat" ("{listed} listed · {waiting} to verify · {suspended} suspended"), the Romanian forms "1 listat / 2 listate / 21 de listate", "1 suspendat / 2 suspendate / 21 de suspendate" and the invariant "de verificat", with the numbers in the admin's language; while the summary read is on its way the line MUST show a skeleton, and when it fails (first read or a re-read) it MUST read "—" with the info tip "Cifrele nu au putut fi citite" / "The figures could not be read", as the "Utilizatori" totals line does (001-FR-006, 161-FR-007), never 0 and never the last number. The waiting figure MUST equal the queue panel's, the menu's and the header's platform-wide count (301-FR-006). The overview and the other views show no such line.

_From 066-suspended-garages._

### 066-FR-007 — The "Service-uri" view MUST show, under the queue, the panel "Service-uri suspendate · {n}" / "Suspended garages · {n}" with every suspended garage, 20 at a time with the button "Mai multe" / "More" for the next 20 (one read of every row shown, as the queue reads), read in reads of at most 200 rows as the queue's are; the heading's {n} is the list read's `total`; each row MUST show a red lamp whose text alternative is the state, the name, the area, the state of FR-004 ("suspendat" alone for a garage with no open suspension), the reason as a second line (none without a suspension), "din {date}" / "since {date}" with the date in the admin's language and Europe/Bucharest ("din 12 sept. 2026" / "since 12 Sep 2026"), "{n} programări anulate" / "{n} bookings cancelled" (singular "1 programare anulată" / "1 booking cancelled") and the button "Deschide dosarul" / "Open the file" (text alternative "Deschide dosarul {name}"), linking to the garage's newest verification file where the queue's button links (`/app/admin/garages/{file id}`), and absent when the garage has no file; with no suspended garage it MUST read "Niciun service suspendat" / "No garage is suspended"; while the read is on its way it MUST show skeleton rows; when it fails, "Lista nu a putut fi citită" / "The list could not be read" with "Reîncearcă" / "Retry"; a failed re-read keeps the rows with the heading marked "(neactualizat)" / "(stale)", as the queue does (301-FR-008). The button "Repune pe hartă" is #106's and is not shown.

_From 066-suspended-garages._

### 066-FR-008 — The counts line and the panel MUST re-read on `garage.suspended`, `garage.restored`, `verification.submitted`, `verification.opened`, `verification.check_recorded`, `verification.decided` and `verification.reopened` from the admin's stream, through the dashboards' shared live re-read (one re-read per 300 ms burst), and on every reconnect, the panel's re-read asking from offset 0 for as many rows as are loaded (at least one page); the admin shell's re-read list (160-FR-012) is unchanged.

_From 066-suspended-garages._

### 066-FR-009 — Every new text MUST exist in the shared i18n files in Romanian and English; the reason and the garage name MUST never be rendered as markup; the line and the panel MUST read at 320 px, 390 px, tablet and desktop, in light and dark, with no sideways scroll; the suspended state MUST be conveyed by text, not by the lamp's colour alone; every row's button MUST be reachable and operable by keyboard, in the reading order line, queue, suspended panel, with the queue's touch-target size and focus ring and its announcement behaviour for live changes (no new live region); switching the language re-renders every text, number and date without a reload.

_From 066-suspended-garages._

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

- `001-FR-001` — superseded by `002-FR-001` (2026-10-10)
- `001-FR-011` — superseded by `002-FR-011` (2026-10-10)

- `161-FR-002` — superseded by `250-FR-008` (2026-10-15)

- `160-FR-012` — superseded by `301-FR-009` (2026-10-16)

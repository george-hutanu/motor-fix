---
capability: admin-dashboard
updated: 2026-10-08
features:
  - 160-admin-dashboard-menu
  - 161-headline-numbers
  - 258-platform-rules-switches
  - 162-growth-12-months
  - 260-rule-off-confirm
---

# Capability: Admin dashboard

The admin dashboard's shell, open to admin accounts only: the `admin/*` API surface and its 404 policy, the overview counters of the work waiting for an admin, the view list with release marks, the header line and the live counters.

## Requirements

### 161-FR-001 — The admin overview answer (`GET /api/v1/admin/overview`, the route ST-160 serves) MUST carry, beside `garagesWaiting`, the platform figures: `garagesListed` (the number of garages whose status is `approved` now), `garagesApprovedThisMonth` (approved garages whose first approval falls in the current calendar month, Europe/Bucharest), `activeDrivers` (accounts holding the `driver` role, with status `active`, whose last activity is within the last 30 days of the moment of the read), and `activeDriversMonthStart` (the active drivers from the snapshot row of the first day of the current month, or absent when that row does not exist). Every figure is read from the database at each call, as `garagesWaiting` is. The DTO lives in the contracts library and the generated client is regenerated.

_From 161-headline-numbers._

### 161-FR-003 — The overview route MUST keep ST-160's access policy: an admin reads it, any other role answers 404 `not_found`, a missing token 401 `sign_in_required`, a suspended account 403 `account_suspended`; nothing in the answer is personal data, every value is a count.

_From 161-headline-numbers._

### 160-FR-003 — The `admin/*` routes MUST NOT be refused by maintenance mode: an admin signed in during maintenance (082-FR-006) reads the overview as when maintenance is off.

_From 160-admin-dashboard-menu._

### 160-FR-006 — The admin dashboard's one view list MUST hold, in this order, "Panou" (`''`), "Service‑uri" (`garages`, capability `admin.garages`), "Utilizatori" (`users`, `admin.users`), "Recenzii raportate" (`reviews`, `admin.reviews`), "Mărci și lucrări" (`catalogue`, `admin.catalogue`), "Asistent AI" (`assistant`, `admin.settings`) and "Setări" (`settings`, `admin.settings`); the side menu (from 768 px), the tab bar (below 768 px) and the routes MUST all read that list, and the tab bar MUST show the short labels "Panou", "Service‑uri", "Utilizatori", "Raportate", "Mărci", "Asistent", "Setări" (English: "Dashboard", "Garages", "Users", "Reported", "Brands", "Assistant", "Settings").

_From 160-admin-dashboard-menu._

### 160-FR-008 — The admin frame's header MUST show the line "MotorFix · București · {n} service‑uri așteaptă verificarea" (English "MotorFix · Bucharest · {n} garages are waiting for verification"), where `{n}` is `garagesWaiting` from the overview, written in the language's plural forms: Romanian `one` "1 service așteaptă verificarea", `few` "{n} service‑uri așteaptă verificarea", `other` "{n} de service‑uri așteaptă verificarea", zero "niciun service nu așteaptă verificarea"; English `one` "1 garage is waiting for verification", `other` "{n} garages are waiting for verification", zero "no garage is waiting for verification". The city is the fixed text "București" / "Bucharest" until the period-and-city story (https://app.notion.com/p/3ee607bff0d281bcba2fe16979f909fc) makes it a choice.

_From 160-admin-dashboard-menu._

### 160-FR-009 — The header MUST show the label "ADMINISTRATOR" (the same word in English) next to the line, and the language switch with RO and EN that every dashboard header carries; switching the language re-renders the line, the label, the menu and the counters in that language without a reload (MF-1).

_From 160-admin-dashboard-menu._

### 160-FR-010 — The menu entry "Service‑uri" and its tab MUST carry a counter equal to `garagesWaiting` when it is above zero, and none when it is zero; the entry's accessible name MUST include the count ("Service‑uri, 4 în așteptare" / "Garages, 4 waiting"). "Recenzii raportate" carries a counter only once it is released (MF-45); no other entry carries one. A count above 99 MUST read "99+" in the chip (the accessible name keeps the full number), so the chip never widens the tab past its 66 px minimum.

_From 160-admin-dashboard-menu._

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

### 161-FR-005 — The garages tile MUST show `garagesListed` with the line "+{n} luna asta" / "+{n} this month" from `garagesApprovedThisMonth`; the active-drivers tile MUST show `activeDrivers` with the line "{sign}{n} luna asta" / "{sign}{n} this month" where the value is `activeDrivers − activeDriversMonthStart`, written with "+" for zero or more and "−" (U+2212) for less, and no line at all when `activeDriversMonthStart` is absent.

_From 161-headline-numbers._

### 161-FR-006 — Every number in a tile MUST be written through the language's plain-number format ("12.480" in Romanian, "12,480" in English), in the Cockpit digits face the shared gauges use; a change line keeps the same grouping; a percentage, when it exists, follows the percentage format ("92%").

_From 161-headline-numbers._

### 161-FR-008 — The tiles MUST read from the same overview resource the admin shell keeps for its header and counters, so one call feeds the shell and the tiles, and the shell's existing re-read on `verification.submitted`, `verification.decided` and `verification.reopened` and on reconnect updates the garages tile without a reload; the tiles add no event, no polling and no cache.

_From 161-headline-numbers._

### 161-FR-009 — The platform MUST keep a daily snapshot, one row per day keyed by the Europe/Bucharest date of the run (the 01:00 run on the 1st writes the first-of-month row), holding `garagesListed`, `garagesApprovedThisMonth` and `activeDrivers` as FR-001 counts them at the time of the job; the row for a day is written or replaced by the job, never duplicated. Fields for the figures of FR-002 join the row when their entities exist.

_From 161-headline-numbers._

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

### 162-FR-001 — An admin MUST be able to read the platform's growth (`GET /api/v1/admin/growth`): twelve entries, one per Europe/Bucharest calendar month ending with the current month, oldest first, each with its month (`"YYYY-MM"`) and, when known, its active drivers and its listed garages as optional fields; a month with no figure omits the field, never 0. Nothing in the answer is personal data; every value is a count. The DTO lives in the contracts library and the generated client is regenerated.

_From 162-growth-12-months._

### 162-FR-002 — A past month's figures MUST be the daily snapshot's closing values for that month: the row dated the first day of the following month, or, when that row does not exist, the row dated the month's last day; with neither, the month has no value. The current month's figures MUST be computed live at the read, with the same definitions as the overview's `activeDrivers` and `garagesListed` (161-FR-001). The read reconstructs nothing before the first snapshot and writes nothing.

_From 162-growth-12-months._

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

## Retired

- `160-FR-001` — superseded by `161-FR-001` (2026-10-07)
- `160-FR-002` — superseded by `161-FR-003` (2026-10-07)
- `160-FR-011` — superseded by `161-FR-007` (2026-10-07)
- `160-FR-014` — superseded by `161-FR-011` (2026-10-07)

- `258-FR-010` — superseded by `260-FR-010` (2026-10-08)

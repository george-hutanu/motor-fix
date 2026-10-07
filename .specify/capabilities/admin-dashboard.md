---
capability: admin-dashboard
updated: 2026-10-07
features:
  - 160-admin-dashboard-menu
  - 161-headline-numbers
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

## Retired

- `160-FR-001` — superseded by `161-FR-001` (2026-10-07)
- `160-FR-002` — superseded by `161-FR-003` (2026-10-07)
- `160-FR-011` — superseded by `161-FR-007` (2026-10-07)
- `160-FR-014` — superseded by `161-FR-011` (2026-10-07)

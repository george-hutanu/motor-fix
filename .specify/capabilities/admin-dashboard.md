---
capability: admin-dashboard
updated: 2026-10-07
features:
  - 160-admin-dashboard-menu
---

# Capability: Admin dashboard

The admin dashboard's shell, open to admin accounts only: the `admin/*` API surface and its 404 policy, the overview counters of the work waiting for an admin, the view list with release marks, the header line and the live counters.

## Requirements

### 160-FR-001 — The API MUST answer `GET /api/v1/admin/overview` for an actor whose role in use is `admin` with the counters of the work waiting for an admin: `garagesWaiting`, the number of verification files whose status is `submitted` or `in_review`, read from the database at each call. The answer MUST carry no reports counter until the review report entity exists (MF-45), when it joins the same answer. The DTO lives in the contracts library, the route is REST with OpenAPI, and the generated client is regenerated.

_From 160-admin-dashboard-menu._

### 160-FR-002 — Every route under `admin/*` MUST answer 404 `not_found` for an actor whose role in use is `driver`, `garage`, `receptionist` or `mechanic`, through the capability policy, before any body is read; without a valid token it MUST answer 401 `sign_in_required`, and for a suspended account 403 `account_suspended`. A test MUST call every `admin/*` route the API serves as each of the four non-admin roles and fail when any answers other than 404.

_From 160-admin-dashboard-menu._

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

### 160-FR-011 — While the first overview read is on its way, the header's count and the counters MUST show a skeleton; when any read fails, including a re-read after a number was shown, the counters MUST be hidden and the header MUST read "MotorFix · București" with no count, never 0 and never the last number, until a later read succeeds.

_From 160-admin-dashboard-menu._

### 160-FR-012 — The admin shell MUST re-read the overview, through the dashboards' shared live re-read (one re-read per 300 ms burst), on every `verification.submitted`, `verification.decided` and `verification.reopened` message of the admin's stream (matched by event kind, not by object id), and on every reconnect of the stream; the re-read MUST update the header line and the counters without a reload. The stream joins `admin` for an admin as it does today (253-FR-004 unchanged); this story adds no event. `review.reported` and `review.decided` join the list with the reports counter (MF-45).

_From 160-admin-dashboard-menu._

### 160-FR-013 — The seed MUST add, outside production and only once (a second run changes nothing), one `submitted` verification file to the seeded garage `service-dobre` and one `in_review` file to `atelier-dinamo`, both `draft` garages, so a development or test database has 2 garages waiting and the end-to-end check reads a known count; `atelier-test` keeps no file.

_From 160-admin-dashboard-menu._

### 160-FR-014 — Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011 ("service‑uri"), and the smallest text of the shell on a phone MUST be 12 px or larger; the header line MUST wrap rather than scroll sideways at 320 px. The tab bar's labels and chips use the 12 px label size (`--mf-size-label`) and keep the tab bar's 48 px tall touch targets (ST-288, unchanged).

_From 160-admin-dashboard-menu._

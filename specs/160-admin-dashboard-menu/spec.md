# Feature Specification: Open the admin dashboard and its menu, admins only

**Feature Branch**: `160-admin-dashboard-menu`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "ST-160 Open the admin dashboard and its menu, admins only — https://app.notion.com/p/3ee607bff0d281bcb229eaf763d5d51c"

**Sources**: Notion story ST-160 (https://app.notion.com/p/3ee607bff0d281bcb229eaf763d5d51c, Story, Highest, 3 points, Labels front end + backend + real-time, Role Admin), read 2026-10-07 with its discussions (none); its Build brief (current as of 2026-10-03) wins over the criteria and notes above it. Epic Garage onboarding and verification (EP-2, https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf); feature MF "Admin dashboard: platform numbers and growth" (https://app.notion.com/p/3ee607bff0d28145803ee93091505ae5). Screens: Dashboard · Admin (DashAdmin.dc.html) and Mobile · Admin dashboard (MDashAdmin.dc.html), recorded by the design check in `design.md`. Repo: `.specify/capabilities/accounts.md` (roles, the capability table, the 404 policy, "who am I" with `landing` `/app/admin`, the menu rule 079-FR-018, the signed-out redirect 082-FR-021, maintenance 082-FR-006); `apps/web/src/app/dashboard/views.ts` (the one view list per dashboard, the admin one already holding Panou, Service‑uri, Utilizatori, Recenzii raportate, Mărci și lucrări and Setări), `area.guard.ts` (a non-admin sent to its own landing), `frame.ts` and `tab-bar.ts` (the side menu from 768 px, the tab bar below), `live.ts` and `live-in-place.ts` (the live stream, re-read on reconnect, a 300 ms burst is one re-read); `.specify/capabilities/live-updates.md` (an admin's stream joins `admin`; `verification.*` events carry the audience `admin`); `.specify/capabilities/garage-verification.md` (the verification file, statuses `submitted` and `in_review`; no submit endpoint until ST-116); `libs/domain/src/auth/capabilities.ts` (`admin.*` capabilities); `libs/domain/src/seed.ts` (three seeded garages, `draft`, no file; one seeded admin); `libs/i18n` (`Intl.PluralRules` forms per key). No review report entity exists yet (MF-45).

## Clarifications

### Session 2026-10-07

- Q: When a re-read fails after a number was already shown, is the counter hidden or does it keep the last number? → A: Hidden: a kept number is a stale one, and a stale count sends an admin to an empty queue (US3 motive). FR-011, US3 scenario 5.
- Q: Does the shell re-read on `review.reported` and `review.decided` before the reports counter exists, and is the re-read matched by event kind rather than by object id? → A: No review re-read until MF-45 adds the reports counter (Constitution I); the re-read is matched by event kind (`verification.submitted`, `verification.decided`, `verification.reopened`), one re-read per 300 ms burst, using the dashboards' live re-read helper. FR-012.
- Q: When FR-007 says an unreleased view's address opens "Panou" for every role, which roles does that cover? → A: Every role the admin area admits (today `admin` only); any other role is sent to its own dashboard by FR-005 first. FR-007; FR-005 loses the untestable "without downloading the admin shell" clause, which the existing `canMatch` guard already gives.
- Q: Is "within 2 seconds" a measured outcome of this story? → A: No: this story asserts the re-read happens within one 300 ms burst of the event (Jest); the end-to-end "within 2 s" rise is measured once ST-116's submit endpoint exists. SC-003.
- Q: Does the story ship the end-to-end live rise with a garage sending its file in another browser, as the brief's Tests say? → A: Not yet: no submit endpoint exists until ST-116, so the live behaviour is covered by Jest re-read tests here and the Playwright rise is recorded as a deviation from the brief and a check for ST-116, on the PR and in the Notion finish comment. FR-015.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An admin lands on the admin dashboard, nobody else can (Priority: P1)

Mihai holds the `admin` role. He signs in through the same dialog as everyone and lands on "Panou" of the admin dashboard, with the admin menu beside it. Ana, a driver, types the admin address and ends up on her own driver dashboard; a direct call to the admin's data answers "not found" for her. A visitor who is not signed in is sent to Home with the sign-in dialog open.

**Why this priority**: The dashboard is the admins' place to run the platform; keeping it to admin accounts is the story's security rule, and every later admin view sits behind this gate.

**Independent Test**: Sign in as the seeded admin and reach `/app/admin` on "Panou"; sign in as each other role and open `/app/admin` (own dashboard) and `GET /api/v1/admin/overview` (404); open `/app/admin` signed out (Home with the dialog).

**Acceptance Scenarios**:

1. **Given** an account holding `admin`, **When** sign-in completes, **Then** the admin dashboard opens on "Panou" in the account's language.
2. **Given** a signed-in driver, garage owner, receptionist or mechanic, **When** they open the admin address, **Then** they land on their own dashboard, and **When** they call `GET /api/v1/admin/overview` directly, **Then** the answer is 404 `not_found`, the same body a missing resource gives.
3. **Given** nobody is signed in, **When** `/app/admin` or `GET /api/v1/admin/overview` is opened, **Then** the page ends on Home with the sign-in dialog open, and the call answers 401 `sign_in_required`.
4. **Given** maintenance mode reads as on, **When** an admin signs in, **Then** sign-in succeeds and the admin dashboard, its menu and its counters work as when maintenance is off.
5. **Given** any account, **When** any screen or endpoint of the platform is used, **Then** there is no way to grant `admin`: the role is given by MotorFix only, outside the product's screens.

---

### User Story 2 - The menu and the header show the work waiting (Priority: P1)

Mihai opens the dashboard: the menu lists the admin views; "Service‑uri" carries the number of garage files waiting for an admin, and the header line reads "MotorFix · București · 4 service‑uri așteaptă verificarea" beside the label "ADMINISTRATOR" and the RO / EN switch. A view whose feature is not released yet is not in the menu.

**Why this priority**: The counters are what makes the shell useful before the views behind it are built; the header line is the admin's first glance at the day.

**Independent Test**: With a known number of waiting files in the database, sign in as the admin and read the header line, the "Service‑uri" counter and the menu entries at phone and desktop widths, in Romanian and English.

**Acceptance Scenarios**:

1. **Given** the menu renders for an admin, **When** every view is released, **Then** it lists, in this order, "Panou", "Service‑uri", "Utilizatori", "Recenzii raportate", "Mărci și lucrări", "Asistent AI" and "Setări" (English: Dashboard, Garages, Users, Reported reviews, Brands and jobs, AI assistant, Settings).
2. **Given** a view whose feature is not released, **When** the menu, the tab bar or its address is used, **Then** the view is absent from the menu and the bar, and its address opens "Panou".
3. **Given** 4 verification files are `submitted` or `in_review`, **When** the header renders, **Then** it reads "MotorFix · București · 4 service‑uri așteaptă verificarea" (English "MotorFix · Bucharest · 4 garages are waiting for verification"), the label "ADMINISTRATOR" shows, the language switch offers RO and EN, and "Service‑uri" carries 4 in the menu.
4. **Given** 1 file waits, **When** the header renders, **Then** the line follows the language's plural form ("1 service așteaptă verificarea"); **given** none waits, the line reads "MotorFix · București · niciun service nu așteaptă verificarea" and "Service‑uri" carries no counter.
5. **Given** a phone width (below 768 px), **When** the dashboard opens, **Then** the views are reached from the bottom tab bar, the "Service‑uri" tab carries the same counter, the header line is readable with no sideways scroll at 320 px, and no text is smaller than 12 px.
6. **Given** the language switch is set to EN, **When** the shell renders, **Then** every text of the menu, the header line, the label and the counters is in English, and back in Romanian on RO.

---

### User Story 3 - The counters move live (Priority: P2)

Two admins have the dashboard open. A garage sends its file: both see "Service‑uri" and the header go from 4 to 5 without a reload. One of them decides a file: both drop to 4. The connection drops for a minute; when it is back, the counters read the current number again.

**Why this priority**: The count is only useful when it is true; a stale count sends an admin to an empty queue or leaves a file waiting.

**Independent Test**: Open the dashboard as the admin, record a verification event on the `admin` channel (submit, decide, reopen through the domain use cases), and watch the counter and the header change without a reload; cut the stream and see the re-read on reconnect.

**Acceptance Scenarios**:

1. **Given** the dashboard is open and 4 files wait, **When** a garage's file becomes `submitted`, **Then** within 2 seconds the header and the "Service‑uri" counter read 5, with no reload, in every admin's open dashboard.
2. **Given** an admin decides a waiting file (approved, more requested or rejected), **When** the decision is relayed, **Then** every admin's counter and header drop by one.
3. **Given** an admin reopens a decided file, **When** the reopening is relayed, **Then** every admin's counter and header rise by one.
4. **Given** the live connection is lost, **When** it reconnects, **Then** the counters are read again and show the current number.
5. **Given** the counter read fails (the first read or any later re-read), **When** the shell renders, **Then** the counter is hidden and the header reads "MotorFix · București" without a count, never "0"; the next successful read (a live event, a reconnect, a reload) brings it back.
6. **Given** the first read is on its way, **When** the shell renders, **Then** the header's count and the counters show a skeleton, not a number.

---

### Edge Cases

- A file opened by an admin (`submitted` → `in_review`) keeps waiting: the counter does not change on `verification.opened`.
- Two events arrive within a burst (a decision and a new submission inside 300 ms): one re-read, the counter ends on the true number.
- An admin whose access token expires while the dashboard is open: the stream renews and reconnects as it does for every dashboard, then re-reads the counters; the sign-in dialog does not open for the stream.
- An account holding `admin` and another role, using the other role: the admin address sends it to that role's dashboard; switching to `admin` opens the admin dashboard with the counters.
- A suspended account holding `admin`: 403 `account_suspended` on sign-in and on the overview, as every gated route answers.
- A count the database cannot give (the query fails or times out): the counter is hidden (US3 scenario 5), the rest of the shell works.
- "Recenzii raportate" is unreleased until MF-45: it is absent from the menu and carries no counter; no review report is counted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The API MUST answer `GET /api/v1/admin/overview` for an actor whose role in use is `admin` with the counters of the work waiting for an admin: `garagesWaiting`, the number of verification files whose status is `submitted` or `in_review`, read from the database at each call. The answer MUST carry no reports counter until the review report entity exists (MF-45), when it joins the same answer. The DTO lives in the contracts library, the route is REST with OpenAPI, and the generated client is regenerated.
- **FR-002**: Every route under `admin/*` MUST answer 404 `not_found` for an actor whose role in use is `driver`, `garage`, `receptionist` or `mechanic`, through the capability policy, before any body is read; without a valid token it MUST answer 401 `sign_in_required`, and for a suspended account 403 `account_suspended`. A test MUST call every `admin/*` route the API serves as each of the four non-admin roles and fail when any answers other than 404.
- **FR-003**: The `admin/*` routes MUST NOT be refused by maintenance mode: an admin signed in during maintenance (082-FR-006) reads the overview as when maintenance is off.
- **FR-004**: The role `admin` MUST remain grantable only outside the product's screens and endpoints (079-FR-009 unchanged): this story adds no screen, endpoint or command that grants it; the seed's admin account (082-FR-023) is the only admin outside production.
- **FR-005**: `/app/admin` MUST open only for an account whose landing is `/app/admin`: a signed-in account with another landing is sent to its own dashboard, and a signed-out visit ends on Home with the sign-in dialog open (082-FR-021 unchanged); after an admin's sign-in, sign-up return or role switch to `admin`, "Panou" of the admin dashboard opens in the account's language (082-FR-017 unchanged).
- **FR-006**: The admin dashboard's one view list MUST hold, in this order, "Panou" (`''`), "Service‑uri" (`garages`, capability `admin.garages`), "Utilizatori" (`users`, `admin.users`), "Recenzii raportate" (`reviews`, `admin.reviews`), "Mărci și lucrări" (`catalogue`, `admin.catalogue`), "Asistent AI" (`assistant`, `admin.settings`) and "Setări" (`settings`, `admin.settings`); the side menu (from 768 px), the tab bar (below 768 px) and the routes MUST all read that list, and the tab bar MUST show the short labels "Panou", "Service‑uri", "Utilizatori", "Raportate", "Mărci", "Asistent", "Setări" (English: "Dashboard", "Garages", "Users", "Reported", "Brands", "Assistant", "Settings").
- **FR-007**: Each view MUST carry a release mark; an unreleased view MUST be absent from the menu and the tab bar, and its address MUST open "Panou" (the existing fall-through) for every role the admin area admits (today `admin` only; any other role is sent to its own dashboard by FR-005). At this story's release "Panou", "Service‑uri" and "Setări" are released and "Utilizatori", "Recenzii raportate", "Mărci și lucrări" and "Asistent AI" are not; the story that builds a view flips its mark. The mark is one line per view in the view list, with a test for a hidden entry (modifies 079-FR-018: the menu shows only the entries the role may open and that are released).
- **FR-008**: The admin frame's header MUST show the line "MotorFix · București · {n} service‑uri așteaptă verificarea" (English "MotorFix · Bucharest · {n} garages are waiting for verification"), where `{n}` is `garagesWaiting` from the overview, written in the language's plural forms: Romanian `one` "1 service așteaptă verificarea", `few` "{n} service‑uri așteaptă verificarea", `other` "{n} de service‑uri așteaptă verificarea", zero "niciun service nu așteaptă verificarea"; English `one` "1 garage is waiting for verification", `other` "{n} garages are waiting for verification", zero "no garage is waiting for verification". The city is the fixed text "București" / "Bucharest" until the period-and-city story (https://app.notion.com/p/3ee607bff0d281bcba2fe16979f909fc) makes it a choice.
- **FR-009**: The header MUST show the label "ADMINISTRATOR" (the same word in English) next to the line, and the language switch with RO and EN that every dashboard header carries; switching the language re-renders the line, the label, the menu and the counters in that language without a reload (MF-1).
- **FR-010**: The menu entry "Service‑uri" and its tab MUST carry a counter equal to `garagesWaiting` when it is above zero, and none when it is zero; the entry's accessible name MUST include the count ("Service‑uri, 4 în așteptare" / "Garages, 4 waiting"). "Recenzii raportate" carries a counter only once it is released (MF-45); no other entry carries one. A count above 99 MUST read "99+" in the chip (the accessible name keeps the full number), so the chip never widens the tab past its 66 px minimum.
- **FR-011**: While the first overview read is on its way, the header's count and the counters MUST show a skeleton; when any read fails, including a re-read after a number was shown, the counters MUST be hidden and the header MUST read "MotorFix · București" with no count, never 0 and never the last number, until a later read succeeds.
- **FR-012**: The admin shell MUST re-read the overview, through the dashboards' shared live re-read (one re-read per 300 ms burst), on every `verification.submitted`, `verification.decided` and `verification.reopened` message of the admin's stream (matched by event kind, not by object id), and on every reconnect of the stream; the re-read MUST update the header line and the counters without a reload. The stream joins `admin` for an admin as it does today (253-FR-004 unchanged); this story adds no event. `review.reported` and `review.decided` join the list with the reports counter (MF-45).
- **FR-013**: The seed MUST add, outside production and only once (a second run changes nothing), one `submitted` verification file to the seeded garage `service-dobre` and one `in_review` file to `atelier-dinamo`, both `draft` garages, so a development or test database has 2 garages waiting and the end-to-end check reads a known count; `atelier-test` keeps no file.
- **FR-014**: Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011 ("service‑uri"), and the smallest text of the shell on a phone MUST be 12 px or larger; the header line MUST wrap rather than scroll sideways at 320 px. The tab bar's labels and chips use the 12 px label size (`--mf-size-label`) and keep the tab bar's 48 px tall touch targets (ST-288, unchanged).
- **FR-015**: Tests: Jest — 404 on every `admin/*` route for the four non-admin roles; the redirect of a non-admin and of a visitor; the overview count for files in each of the five statuses; the hidden entry for an unreleased view; the plural forms of the header line; the counter hidden on a failed read; the re-read on each listed event and on reconnect. Playwright — sign in as the seeded admin, see the header line with the seeded count on a phone and on a desktop, in Romanian and English, and the counter on "Service‑uri"; a driver who opens `/app/admin` ends on `/app/driver`. The live rise driven by a garage sending its file in another browser waits for the submit endpoint (ST-116) and is covered until then by the Jest re-read tests.

### Key Entities

- **Overview counters**: the numbers of items waiting for an admin, read on demand, never stored: `garagesWaiting` now; a reports counter when MF-45 lands.
- **Verification file**: as 207-FR-001; the ones in `submitted` or `in_review` are "waiting".
- **Dashboard view**: an entry of the one view list (path, menu label, tab label, capability, release mark, counter key where it has one).

## Spec Delta

### Capability: `admin-dashboard` (new)

- **Adds**: FR-001, FR-002, FR-003, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014
- **Modifies**: none
- **Removes**: none

### Capability: `accounts`

- **Adds**: none
- **Modifies**: 079-FR-018 (by FR-007: the menu also hides a view whose feature is not released); 082-FR-023 (by FR-013: the seed also adds two waiting verification files)
- **Removes**: none

FR-004, FR-005 and FR-015 restate rules the accounts capability already holds or name tests; they add no requirement to a capability.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each of the four non-admin roles, every `admin/*` route answers 404, and `/app/admin` ends on that role's own dashboard; for a visitor, on Home with the sign-in dialog (Jest on a real database, Playwright for the redirect).
- **SC-002**: The seeded admin sees "MotorFix · București · 2 service‑uri așteaptă verificarea", "ADMINISTRATOR", RO / EN, and "Service‑uri" with 2, at 320 px, 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll at 320 px (the PR QA sweep).
- **SC-003**: After a `verification.submitted`, `verification.decided` or `verification.reopened` message on the admin's stream, the overview is re-read within one 300 ms burst and the header and the counter show the new number without a reload (Jest). The end-to-end rise within 2 seconds (an assumption, no source) is measured once ST-116's submit endpoint exists.
- **SC-004**: The menu lists exactly the released views in the fixed order, in both languages; an unreleased view's address opens "Panou" (Jest).
- **SC-005**: With the overview read failing, the shell renders with no counter and no "0" (Jest).

## Assumptions

- Admin access stays given by MotorFix only through the existing rule (no endpoint grants `admin`) and the seed; the Build brief's proposed "operations command run by the build team, with no screen" is not built by this story and is flagged to the owner as an open decision (autonomous default: a 3-point shell story ships no command; the command, when wanted, is a task of its own).
- A "release flag" is a per-view mark in the one view list, flipped by the story that releases the view, not an environment variable or a stored switch (autonomous default: the smallest change; no flag mechanism exists in the repo).
- "Utilizatori", "Recenzii raportate", "Mărci și lucrări" and "Asistent AI" are unreleased at this story (their features are other features, per the story's notes); "Service‑uri" is released because it carries the counter, with the placeholder body until the queue story; "Setări" is released because it already holds the push and notification panels (autonomous default).
- "Asistent AI" is a new view `assistant` under `admin.settings` until MF-50 names a capability of its own (autonomous default: the capability table is not changed for a hidden view).
- The header label is "ADMINISTRATOR", as the Build brief says, not "ADMIN" from the acceptance criteria above it (the brief wins).
- The counter is omitted when the number is zero and the header's zero form is "niciun service nu așteaptă verificarea" / "no garage is waiting for verification" (autonomous default: the brief gives the 4 form only).
- Romanian plural forms follow `Intl.PluralRules` (`one`, `few`, `other`), as the shared i18n already does for other counts (autonomous default).
- The overview is one endpoint carrying every counter, `GET /api/v1/admin/overview`, the brief's proposed route; the reports counter joins it with MF-45 (autonomous default).
- The overview is guarded by `admin.garages` (its only counter is the garages queue); every `admin.*` capability belongs to `admin` alone, so the 404 rule holds for all four non-admin roles whichever capability a route names (autonomous default).
- The seed gives `service-dobre` and `atelier-dinamo` a waiting file each (2 waiting), so the end-to-end check reads a known count; the mock's "4" is a sample number (autonomous default).
- The end-to-end live rise waits for ST-116's submit endpoint; until then the live behaviour is proven by Jest (autonomous default; recorded as a deferred check for ST-116).
- SC-003's 2 seconds is an assumption, not a number from the brief, and is not measured by this story.
- The city is fixed to București until the city story; the header line's layout beside the view title, the label's styling and the counter's shape follow the mock as `design.md` records them.
- Customising the dashboard's panels (ST-15), the overview's panels, the queue view (its own story), reported reviews (MF-45), performance (MF-44), demand (MF-47), system status and the log (MF-49), the views behind Utilizatori (MF-46), Mărci și lucrări, Asistent AI (MF-50) and Setări (MF-48), and admin roles with different rights (X21) are out of scope.

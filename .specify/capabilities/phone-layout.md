---
capability: phone-layout
updated: 2026-10-09
features:
  - 286-phone-layout
  - 287-public-tab-bar
  - 082-sign-in
  - 288-dashboard-tab-bar
  - 461-list-row-labels
  - 028-driver-dashboard-views
  - 097-garage-dashboard
  - 343-live-quote-requests
---

# Capability: Phone layout and installable web app

The rules every screen of the web app inherits on a phone — the viewport, the breakpoints and the shared layout signal, 44 px targets, the 12 px text floor, 16 px field text, safe-area insets, tables that collapse to list rows — and the web app manifest and Angular service worker that make MotorFix installable.

## Requirements

### 286-FR-001 — The page MUST declare the viewport `width=device-width, initial-scale=1, viewport-fit=cover`, and MUST NOT disable zoom.

_From 286-phone-layout._

### 286-FR-002 — At 320 px wide, no route of the app may scroll sideways (`document.documentElement.scrollWidth` ≤ 320), including at 200 % text size at 375 px; long words wrap.

_From 286-phone-layout._

### 286-FR-003 — Every button, standalone link, field, tab, chip and switch MUST be at least 44 px tall at every width. A standalone link is one not inside a paragraph or list item (running text keeps inline links at text height).

_From 286-phone-layout._

### 286-FR-004 — No text on a phone may be smaller than 12 px.

_From 286-phone-layout._

### 286-FR-005 — Every text field (input, select, textarea) MUST use a text size of at least 16 px.

_From 286-phone-layout._

### 286-FR-006 — On a phone, button labels MUST wrap rather than being cut or overflowing: no button's content is wider than the button.

_From 286-phone-layout._

### 461-FR-002 — The shared table MUST let each column be named main or key; below 768 px a table that names a main column MUST show each row as the main text, then the key value on the same line (main at the start, key at the end), with every other column hidden, its header cells as well as its cells, and the header row visually hidden (clipped to 1 px, out of the layout) rather than `display: none`, so it stays in the accessibility tree and each shown cell's column header is the header of its own column; from 768 px every column and the header row show. A table that names only a key column is unnamed. Nothing adds horizontal scroll at 320 px.

_From 461-list-row-labels._

### 286-FR-008 — One shared layout signal MUST say `phone` below 768 px, `tablet` from 768 to 1023 px and `desktop` from 1024 px, follow the width live, and say `phone` where there is no width (the server). It is driven by the same media queries as the CSS breakpoints, so the two never disagree.

_From 286-phone-layout._

### 286-FR-009 — The theme MUST offer the safe-area insets as tokens, the page body MUST add the left and right insets, a fixed bar adds the inset of the edge it sits on, and the sheet (full height) adds the top and bottom insets.

_From 286-phone-layout._

### 286-FR-010 — The app MUST serve a web app manifest named "MotorFix" with `display: standalone`, start URL `/`, icons of 192 and 512 px plus a maskable icon, and the dark theme colour; the page MUST carry one `theme-color` for the dark scheme and one for the light scheme, equal to the theme's page background `--mf-bg` in that scheme.

_From 286-phone-layout._

### 286-FR-011 — The production build MUST register the Angular service worker, which caches the app shell and static assets, never caches API answers, and sends navigations to the server first; development builds and browsers without service workers run without it.

_From 286-phone-layout._

### 287-FR-001 — Below 768 px, every public screen — Home and the results, garage, mechanic and account screens under a language prefix — MUST show a bar at the bottom of the screen with three tabs, in this order: "Caută", "Service-uri", "Cont" (English "Search", "Garages", "Account"), each an icon with its label, never an icon alone.

_From 287-public-tab-bar._

### 287-FR-002 — The bar MUST be a navigation landmark named "Navigare principală" (English "Main navigation"); the icons MUST be hidden from assistive technology.

_From 287-public-tab-bar._

### 287-FR-003 — Exactly one tab MUST be active, chosen by the current screen: Home → "Caută"; results, garage and mechanic screens → "Service-uri"; the account screen → "Cont". The active tab MUST carry `aria-current="page"` and the theme's amber ink (`--mf-amber-ink`); the other two MUST carry neither and use the secondary text colour.

_From 287-public-tab-bar._

### 287-FR-004 — "Caută" MUST lead to Home in the current language.

_From 287-public-tab-bar._

### 287-FR-005 — "Service-uri" MUST lead to the results screen with the brand of the last results address opened in this visit (its non-empty `brand` query parameter), and to the results screen without a brand when none was; the brand is held in memory until the page reloads.

_From 287-public-tab-bar._

### 082-FR-012 — Signed out, the "Cont" tab of the phone tab bar and an "Autentificare" button at the top of every public screen on tablets and computers (≥ 768 px) MUST open the sign-in dialog over the current screen without changing the address; signed in, both MUST open the person's dashboard.

_From 082-sign-in._

### 287-FR-007 — The bar's bottom padding MUST be at least the device's bottom safe-area inset; each tab MUST be at least 44 px tall; each label at least 12 px; and no public screen may scroll sideways at 320 px with the bar shown.

_From 287-public-tab-bar._

### 287-FR-008 — From 768 px wide the bar MUST be hidden.

_From 287-public-tab-bar._

### 287-FR-009 — While a text field has focus — a textarea, an editable element, or an input of any type but button, checkbox, color, file, image, radio, range, reset and submit — the bar MUST be hidden (not shown, not announced, not focusable); it MUST show again when that focus leaves.

_From 287-public-tab-bar._

### 287-FR-010 — The bar MUST sit at the bottom of the screen on a page shorter than the screen, and MUST NOT cover the end of a longer page: the last content of a public screen stays visible above the bar when scrolled to the bottom.

_From 287-public-tab-bar._

### 287-FR-011 — Until EP-4 and ST-82 build them, the results (`garages`), garage (`garages/<garage>`), mechanic (`mechanics/<mechanic>`) and account (`account`) screens MUST exist under each language prefix as placeholders: a heading naming the section and one line saying the screen comes later, in both languages; they are not added to the sitemap.

_From 287-public-tab-bar._

### 287-FR-012 — The bar's texts MUST exist in Romanian and English with the same keys; switching the language MUST change the labels and the landmark name in place, and the tabs MUST lead to the addresses of the new language.

_From 287-public-tab-bar._

### 288-FR-001 — Each dashboard (driver, garage, admin; the mechanic uses the garage dashboard in release 1) MUST have exactly one ordered list of views, each view with its menu label, its short tab label (the mock's: "Cereri" for "Cereri de ofertă") and, where it has one, the capability it requires.

_From 288-dashboard-tab-bar._

### 288-FR-002 — Each view MUST have its own language-neutral address under its dashboard (the segments in Clarifications), covering its sub-paths, and the dashboard view MUST be the dashboard's own address.

_From 288-dashboard-tab-bar._

### 288-FR-003 — Opening the address of a view the session's capabilities do not allow, or of a view that does not exist, MUST redirect the person to their dashboard's own address before the view loads; the decision MUST read the same view list as the menus.

_From 288-dashboard-tab-bar._

### 288-FR-004 — Below 768 px, the dashboard MUST show a bottom tab bar instead of the side menu, with one tab per view the session allows, in list order; the bar and the side menu MUST both be rendered from that one filtered list.

_From 288-dashboard-tab-bar._

### 288-FR-005 — At 768 px and wider, the dashboard MUST show the side menu and hide the bar; the side menu MUST offer the same views as the bar.

_From 288-dashboard-tab-bar._

### 288-FR-006 — The open view's tab and menu entry MUST be marked as the current page (`aria-current="page"`, amber), and the active tab MUST be scrolled into sight in the bar.

_From 288-dashboard-tab-bar._

### 288-FR-007 — When the tabs do not fit, the bar MUST scroll sideways on its own; the page MUST never scroll sideways at 320 px.

_From 288-dashboard-tab-bar._

### 288-FR-008 — Each tab MUST be at least 44 px tall with a label of at least 12 px; labels MUST never be cut — a tab grows to fit its label.

_From 288-dashboard-tab-bar._

### 288-FR-009 — The bar MUST sit above the safe-area inset at the bottom of the screen.

_From 288-dashboard-tab-bar._

### 288-FR-010 — The bar MUST be a navigation landmark named after the dashboard.

_From 288-dashboard-tab-bar._

### 288-FR-011 — The bar and the side menu MUST follow the session: when its role or capabilities change, the tabs change, and a view that is no longer allowed is left for the dashboard view.

_From 288-dashboard-tab-bar._

### 288-FR-012 — On a phone the account controls (the person's name, sign out, the language switch) MUST remain reachable without the side menu.

_From 288-dashboard-tab-bar._

### 097-FR-003 — Every garage view MUST have its own `h1` title and, under it, a subtitle, both in the interface language: Panou — "Panou service" / "Garage dashboard", the line under it the garage's name (FR‑006); Cereri de ofertă — "Cereri de ofertă" / "Quote requests", "Răspunde în mai puțin de o oră ca să apari primul la șofer." / "Answer within the hour to show up first for the driver." (the mock's); Programări — "Programări" / "Schedule", "Programările pe zile, pe mecanici și pe elevatoare" / "Bookings by day, mechanic and lift"; Mecanici — "Mecanici" / "Mechanics", "Echipa ta și ce poate face fiecare" / "Your team and what each one may do"; Prețuri — "Prețuri" / "Prices", "Intervalele pe care le văd șoferii pe profilul tău" / "The ranges drivers see on your profile"; Recenzii — "Recenzii" / "Reviews", "Ce spun șoferii despre service" / "What drivers say about your garage"; Profilul service‑ului — "Profilul service‑ului" / "Garage profile", "Așa te văd șoferii pe hartă" / "This is how drivers see you on the map" (the mock's); Setări — "Setări" / "Settings", "Contul, notificările și funcțiile service‑ului" / "Account, notifications and garage features"; Istoric modificări — "Istoric modificări" / "Change history", "Cine a schimbat ce și când" / "Who changed what and when". The design check confirmed the mock's "Schedule" (`design.md`): the title and the English menu label of Programări are both "Schedule", replacing the existing menu label "Bookings". Modifies 028‑FR‑002 for the garage views (a view with no title kept its menu label).

_From 097-garage-dashboard._

### 461-FR-001 — Every element of the shared table (`libs/ui-cockpit` helm table) MUST carry its explicit ARIA role: the table `table`, its header and body `rowgroup`, each row `row`, each header cell `columnheader`, each data cell `cell`, so assistive technology keeps the table semantics whatever display the phone stylesheet gives them.

_From 461-list-row-labels._

### 028-FR-001 — The driver dashboard's view list MUST hold seven views in this order: Panou (`''`), Cererile mele (`requests`), Mașinile mele (`cars`), Recenziile mele (`reviews`), Service‑uri salvate (`saved`), Asistent AI (`assistant`), Setări (`settings`), each under `/app/driver/<path>`; Asistent AI MUST carry the release mark (160‑FR‑007), so it is absent from the menu and the bar and its address opens Panou, with a test for the hidden entry. Its labels exist in both languages for the day it is released: menu "Asistent AI" / "AI assistant", tab "AI" / "AI". Adds the view to 288‑FR‑001's list; the six others and their labels are unchanged.

_From 028-driver-dashboard-views._

### 028-FR-003 — Changing view MUST never reload the page, and a forward navigation to another view MUST start it at the top of the window; the browser's back button MUST return to the previous view. The window is what scrolls (the frame has no inner scrolling container). One router‑wide setting does this (forward: top; back and forward buttons: the earlier position), so every dashboard and the public screens behave alike; a navigation that changes only the query or the fragment keeps the position.

_From 028-driver-dashboard-views._

### 028-FR-004 — The driver dashboard's account block MUST read "CONT ȘOFER" / "DRIVER ACCOUNT" as its account‑type line (the garage and admin lines stay as they are), and the account block of every dashboard (one shared frame, so no extra code per area) MUST show the person's initials beside the name: the first character (one Unicode code point, so an emoji or accented letter is never split) of the first and of the last whitespace‑separated word, upper‑cased for Romanian ("Ana-Maria Pop" → "AP", "ștefan" → "Ș"), at most two, one for a one‑word name, none for an empty name; the initials are hidden from assistive technology and the name stays the accessible text. "Ieși din cont" stays: it signs out on this device and opens Home.

_From 028-driver-dashboard-views._

### 343-FR-007 — The Cereri de ofertă view MUST replace its empty-state placeholder with the waiting rows, newest first, 20 at a time, the next page loading when the list's end comes into view until `nextCursor` is null, and the closed rows of the last 24 hours greyed under the waiting rows loaded so far, each with its FR-004 label; the closed rows come from one `closed` read (its first page, not paged further) made with the first waiting read and re-read on the same events. Its title and subtitle stay as 097-FR-003 gives them. The view's menu entry and bottom tab MUST show the FR-001 count in the counter slot 097-FR-001 reserved, with no number at zero.

_From 343-live-quote-requests._

### 097-FR-002 — Asistent AI MUST carry the release mark, as the driver's does (160‑FR‑007, 028‑FR‑001): absent from the menu, the bar and the routes, its address redirecting to `/app/garage`, with its labels present in both languages ("Asistent AI" / "AI assistant", tab "AI", title "Asistentul tău AI" / "Your AI assistant", the mock's). Istoric modificări MUST read "Istoric modificări" / "Change history", tab "Istoric" / "History"; the tab bar's short labels of the eight others are the existing ones (Panou, Cereri, Program, Mecanici, Prețuri, Recenzii, Profil, Setări).

_From 097-garage-dashboard._

### 343-FR-006 — Panou MUST gain a section "Cereri de ofertă" / "Quote requests" above its empty state, replacing that empty state once the section exists: its heading, the counter "N fără răspuns" / "N unanswered", the four newest waiting rows and, when there are more than four, a link "Vezi toate" / "See all" to the Cereri de ofertă view. The section is present for the owner, the receptionist and a mechanic with `can_answer_quotes` (the session's `garageAccess` permissions, 097-FR-005), absent for a mechanic without it, and absent while the garage is `draft` (097-FR-008's line stays).

_From 343-live-quote-requests._

### 097-FR-006 — The garage the dashboard shows MUST come from `garageAccess`, matched on the session's `garageId`, never from the address: the header line under Panou's title is that garage's name alone, with nothing after it until the stories that deliver the two counts; with no membership, or a session `garageId` that matches no entry, the line is absent and Panou shows its FR‑004 empty state. The aside's account‑type line, under the logo where the driver's "CONT ȘOFER" sits, MUST read "CONT SERVICE" / "GARAGE ACCOUNT" (replaces "Service" / "Garage"; the admin's stays). Shell and menu render at once from the session already loaded by the area guard: no extra call, no skeleton on the header line.

_From 097-garage-dashboard._

### 097-FR-007 — A menu entry whose feature is switched off in `garageAccess.features` (`features[key] === false`) MUST be absent from the menu, the bar and the routes (its address redirects to `/app/garage`), as an entry without its capability is today: Mecanici needs `team_mechanics`. Every feature with no row, or a row with `enabled` true, counts as on. This story reads `features` once from the session the area guard loaded; the feature‑switches story owns the screen that changes them and, through the existing `garage.features_changed` live event, the re‑read of an open menu.

_From 097-garage-dashboard._

### 097-FR-008 — When the garage of the matched membership is `draft`, Panou's body MUST show the one line "Profilul tău e în verificare." / "Your profile is being checked." instead of its empty state; the shell, the header line and the menu stay. The verification‑page story replaces that line with its page. An `approved` or `suspended` garage shows Panou's empty state (FR‑004).

_From 097-garage-dashboard._

## Retired

- `287-FR-006` — superseded by `082-FR-012` (2026-10-04)

- `286-FR-007` — superseded by `461-FR-002` (2026-10-06)

- `288-FR-013` — superseded by `028-FR-002` (2026-10-07)

- `028-FR-002` — superseded by `097-FR-003` (2026-10-08)

- `097-FR-001` — superseded by `343-FR-007` (2026-10-09)
- `097-FR-004` — superseded by `343-FR-006` (2026-10-09)

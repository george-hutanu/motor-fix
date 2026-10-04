---
capability: phone-layout
updated: 2026-10-04
features:
  - 286-phone-layout
  - 287-public-tab-bar
  - 082-sign-in
  - 288-dashboard-tab-bar
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

### 286-FR-007 — The shared table MUST let each column be named main or key; below 768 px a table that names a main column MUST show each row as the main text, then the key value on the same line (main at the start, key at the end, as the mock's results list), with every other column and the header row hidden; from 768 px every column shows. A table that names only a key column is unnamed.

_From 286-phone-layout._

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

### 288-FR-013 — Each view MUST show its title and a placeholder body until the epic that owns the view builds it.

_From 288-dashboard-tab-bar._

## Retired

- `287-FR-006` — superseded by `082-FR-012` (2026-10-04)

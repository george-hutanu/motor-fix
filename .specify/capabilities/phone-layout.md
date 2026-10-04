---
capability: phone-layout
updated: 2026-10-04
features:
  - 286-phone-layout
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

## Retired

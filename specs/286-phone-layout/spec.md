# Feature Specification: Set up the shared phone layout rules

**Feature Branch**: `286-phone-layout`

**Created**: 2026-10-04

**Status**: Archived (2026-10-04)

**Input**: User description: "ST-286 — Set up the shared phone layout rules: the shared phone layout rules every screen uses, plus the installable web app's manifest and service worker (ST-196 Web Push extends that service worker later), built on the merged Cockpit theme in libs/ui-cockpit. Notion story: https://app.notion.com/p/3ee607bff0d281df9a9ef85c0725362c. Spec folder and branch: 286-phone-layout."

**Sources**: Notion story ST-286 https://app.notion.com/p/3ee607bff0d281df9a9ef85c0725362c (read 2026-10-04, page edited 2026-10-03; no comments) — its Build brief wins over the story body · epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (Build plan, slice 2) · ST-285 decision A19 https://app.notion.com/p/3ee607bff0d281299a1ae6725b9aec68 · ST-196 https://app.notion.com/p/3ee607bff0d28156a023d73a7262de80 (extends the service worker) · mock v22, page Mobile (design.md)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every screen fits a phone (Priority: P1)

A driver opens MotorFix on a small phone, 320 px wide. Nothing on any screen
scrolls sideways, every button, link, tab and switch is big enough to tap, no text
is too small to read, and tapping a text field does not zoom the page.

**Why this priority**: It is the story's purpose: the rules every later screen
inherits without per-screen work.

**Independent Test**: Open every route at 320 px and 375 px; measure the page
width, the text sizes, the target heights and the field text size.

**Acceptance Scenarios**:

1. **Given** any route of the app at 320 px wide, **when** it renders, **then**
   `document.documentElement.scrollWidth` is at most 320.
2. **Given** a phone (below 768 px), **when** any screen renders, **then** no text
   is below 12 px and every button, link, tab, chip and switch is at least 44 px
   tall.
3. **Given** an iPhone in Safari, **when** the person taps a text field, **then**
   the page does not zoom: field text is at least 16 px.
4. **Given** text zoom at 200 %, **when** a screen renders at 375 px, **then**
   nothing scrolls sideways and labels wrap rather than being cut.

---

### User Story 2 - Tables become list rows on a phone (Priority: P1)

A garage owner looks at a list on a phone: each row shows the main text, then the
key value; the other columns are hidden. On a tablet or desktop the same list is a
table.

**Why this priority**: A table with several columns cannot fit 320 px; every list
in later epics is built on the shared table.

**Independent Test**: Render the shared table with named main and key columns at
375 px and at 1024 px.

**Acceptance Scenarios**:

1. **Given** a phone, **when** a list built on the shared table renders, **then**
   each row shows the main text, then the key value; secondary columns and the
   header row are hidden.
2. **Given** a tablet or desktop, **when** the same list renders, **then** every
   column and the header row show.

---

### User Story 3 - Views know their layout, live (Priority: P2)

A view that needs to behave differently on a phone (a later bottom sheet, a tab
bar) reads one shared layout signal: `phone`, `tablet` or `desktop`. Resizing the
window or rotating the phone switches it at once, without losing what was typed.

**Why this priority**: Needed by the bottom sheet and tab bar stories; nothing on
today's screens reads it yet.

**Independent Test**: Read the signal at widths 320, 767, 768, 1023, 1024; resize
across a breakpoint with text typed in a field.

**Acceptance Scenarios**:

1. **Given** the window is resized or the phone rotates, **when** the width
   crosses a breakpoint, **then** the layout switches at once, without losing
   input.

---

### User Story 4 - MotorFix can be installed (Priority: P2)

A driver on Android Chrome who uses MotorFix twice is offered "Instalează
aplicația" by the browser. Once installed, MotorFix opens full screen with its
icon and theme colour. On an iPhone with a home indicator, a bottom bar or sheet
keeps clear of the indicator.

**Why this priority**: The installable web app is the launch decision (A19), and
Web Push (ST-196) needs its service worker.

**Independent Test**: Load the app's production build; the manifest loads with
its icons and the service worker registers.

**Acceptance Scenarios**:

1. **Given** Chrome on Android, **when** a person uses MotorFix twice, **then**
   the browser can offer to install it; installed, it opens full screen with its
   icon and theme colour.
2. **Given** an iPhone with a home indicator, **when** a bottom bar or sheet
   shows, **then** it adds the safe-area inset at the bottom.
3. **Given** a browser without service worker support, **when** the app opens,
   **then** it works as a normal website.

### Edge Cases

- The server has no width: server-rendered pages lay out from CSS alone (the
  table collapse and every rule above are media queries), so the first paint is
  already right; the layout signal reads `phone` until the browser reports its
  width.
- Landscape on a notched iPhone: with `viewport-fit=cover` the page reaches under
  the notch, so the page body adds the left and right safe-area insets.
- A long word (an e-mail address, a garage name) at 320 px wraps instead of
  pushing the page wider.
- Running text links inside a paragraph keep their inline size; the 44 px rule
  applies to standalone links, buttons, fields, tabs and switches.
- The service worker never answers API requests from a cache, and navigations go
  to the server first so server-rendered pages stay current; the cached app shell
  is the offline fallback.
- A table that names no main column keeps all its columns on a phone and scrolls
  inside its own container, never the page.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The page MUST declare the viewport `width=device-width,
  initial-scale=1, viewport-fit=cover`, and MUST NOT disable zoom.
- **FR-002**: At 320 px wide, no route of the app may scroll sideways
  (`document.documentElement.scrollWidth` ≤ 320), including at 200 % text size at
  375 px; long words wrap.
- **FR-003**: Every button, standalone link, field, tab, chip and switch MUST be
  at least 44 px tall at every width. A standalone link is one not inside a
  paragraph or list item (running text keeps inline links at text height).
- **FR-004**: No text on a phone may be smaller than 12 px.
- **FR-005**: Every text field (input, select, textarea) MUST use a text size of
  at least 16 px.
- **FR-006**: On a phone, button labels MUST wrap rather than being cut or
  overflowing: no button's content is wider than the button.
- **FR-007**: The shared table MUST let each column be named main or key; below
  768 px a table that names a main column MUST show each row as the main text,
  then the key value on the same line (main at the start, key at the end, as the
  mock's results list), with every other column and the header row hidden; from
  768 px every column shows. A table that names only a key column is unnamed.
- **FR-008**: One shared layout signal MUST say `phone` below 768 px, `tablet`
  from 768 to 1023 px and `desktop` from 1024 px, follow the width live, and say
  `phone` where there is no width (the server). It is driven by the same media
  queries as the CSS breakpoints, so the two never disagree.
- **FR-009**: The theme MUST offer the safe-area insets as tokens, the page body
  MUST add the left and right insets, a fixed bar adds the inset of the edge it
  sits on, and the sheet (full height) adds the top and bottom insets.
- **FR-010**: The app MUST serve a web app manifest named "MotorFix" with
  `display: standalone`, start URL `/`, icons of 192 and 512 px plus a maskable
  icon, and the dark theme colour; the page MUST carry one `theme-color` for the
  dark scheme and one for the light scheme, equal to the theme's page background
  `--mf-bg` in that scheme.
- **FR-011**: The production build MUST register the Angular service worker,
  which caches the app shell and static assets, never caches API answers, and
  sends navigations to the server first; development builds and browsers without
  service workers run without it.

### Key Entities

- **Layout**: `phone`, `tablet` or `desktop`, derived from the viewport width.
- **Column role**: `main`, `key`, or none (secondary), set on a table's header
  and data cells.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 routes scroll sideways at 320 px.
- **SC-002**: 0 visible texts under 12 px and 0 visible FR-003 targets under
  44 px on every route at 375 px.
- **SC-003**: On the production build the manifest and its three icons answer
  200 and `navigator.serviceWorker.ready` resolves. Whether Chrome offers to
  install is the browser's heuristic and is not asserted.

## Clarifications

### Session 2026-10-04

- Q: How is "text zoom at 200 %" tested? → A: By doubling the theme's type
  tokens and the body size at 375 px (what a 200 % text size does to a px-based
  type scale) and asserting no sideways scroll and no cut button label; browser
  automation exposes no text-only zoom (context P1).
- Q: Which routes are "every route"? → A: `/`, `/cockpit`, and the three
  dashboard frames with a stubbed session (`/app/driver`, `/app/garage`,
  `/app/admin`), as the dashboards e2e already does (context P2).
- Q: What does the layout signal say on the server? → A: `phone` (mobile first);
  the rendered layout itself comes from CSS media queries and is right on first
  paint (context P3).
- Q: Which columns are "secondary"? → A: Every column not named main or key, and
  only in a table that names a main column; an unnamed table keeps its columns
  and scrolls inside its container (Build brief: "Each table names its main and
  key columns").
- Q: Navigations: cached shell first or server first? → A: Server first
  (`freshness`), so server-rendered pages and their language stay current; the
  cached shell is the offline fallback (Principle I: one rendering path online).
- Q: What is a "standalone" link, and are inline links counted by SC-002? → A: A
  link not inside a paragraph or list item; SC-002 counts only FR-003 targets
  (spec-challenger #1).
- Q: List row: main above key, or side by side? → A: Side by side, main at the
  start and key at the end, as the results board; a table naming only a key
  column is unnamed (challenger #2).
- Q: How does the signal follow the width? → A: Media queries mirroring the CSS
  breakpoints (CDK `BreakpointObserver`), so fractional widths follow the same
  rule as the CSS (challenger #3).
- Q: What proves SC-003? → A: One Playwright test on the production build:
  manifest and three icons answer 200, the service worker becomes ready; the
  install offer is not asserted (challenger #4).
- Q: Which background is the theme colour? → A: `--mf-bg` of each scheme; the
  constants are tested equal to the tokens in `cockpit.css` (challenger #5).
- Q: Which insets does a bar add? → A: The inset of the edge it sits on; the
  full-height sheet adds top and bottom; no fixed bar exists yet, so only the
  tokens, the body and the sheet are built here (challenger #6).

## Assumptions

- The brief's `LayoutService` *(proposed name)* is named `Layout`, with a
  `current` signal, matching the repo's service names (`Session`, `I18n`,
  `LanguageChoice`) (autonomous default).
- The page's two `theme-color` tags are added by `provideCockpitTheme()` from
  constants beside `cockpit.css`, because a colour literal in `index.html` would
  fail the theme's colour-literal check (autonomous default).
- The app icon has no board; it is drawn from the Cockpit tokens: an amber ring
  on the near-black ground (autonomous default).
- `@angular/service-worker` (22.2.1, same as `@angular/core`) is added: the
  Build brief names the Angular service worker, and it carries the push handling
  ST-196 needs (autonomous default; the only new dependency).
- The end-to-end suite blocks service workers, so `page.route` stubs keep
  reaching the page; the service worker test allows them for itself (autonomous
  default).
- "Uses MotorFix twice" and the install prompt are Chrome's own heuristics; the
  app's part is a valid manifest and a service worker with a fetch handler
  (autonomous default).

- The manifest also carries `lang: "ro"` (the default language, ST-16) and
  `scope: "/"` (the whole app), standard members the brief does not list;
  `/media/**` in the service worker's lazy group is where the build emits the
  self-hosted fonts (autonomous default).
- The service worker e2e test runs only against the production build
  (`BASE_URL`, as the release pipeline does); the local dev server has no
  worker (autonomous default).

## Spec Delta

### Capability: `phone-layout`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011

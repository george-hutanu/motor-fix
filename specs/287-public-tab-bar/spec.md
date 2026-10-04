# Feature Specification: Move between public screens with a bottom tab bar on a phone

**Feature Branch**: `287-public-tab-bar`

**Created**: 2026-10-04

**Status**: Implemented

**Input**: User description: "ST-287 \"Move between public screens with a bottom tab bar on a phone\" — Notion story https://app.notion.com/p/3ee607bff0d281e1bf91cd25024ee64e (EP-1 Foundations, Phone experience feature; timeline row https://app.notion.com/p/3ee607bff0d281c2b8aac5ff4a90f456, Lane B · i18n & shell, wave W3, 3 points). A bottom tab bar on the public screens on a phone (below 768 px) with three tabs Caută / Service-uri / Cont (EN: Search / Garages / Account), safe-area aware, 44 px tabs, 12 px labels, active tab amber with aria-current, nav landmark \"Navigare principală\". The public screens it links to arrive in EP-4, so build it against placeholder routes. Blocked by ST-286 and ST-17, both merged."

**Sources**: Notion story ST-287 https://app.notion.com/p/3ee607bff0d281e1bf91cd25024ee64e (read 2026-10-04, page edited 2026-10-03; no comments) — its Build brief wins over the story body · timeline row https://app.notion.com/p/3ee607bff0d281c2b8aac5ff4a90f456 ("build the bar against placeholder routes") · epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (Build plan, slice 9) · ST-307 garage profile https://app.notion.com/p/3ee607bff0d281a097c8f64d3d995021 (the `brand` query parameter) · mock v22, page Mobile (design.md)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reach the three public sections with one thumb (Priority: P1)

A visitor on a phone sees a bar at the bottom of every public screen with
three tabs: "Caută", "Service-uri" and "Cont". The tab of the section they are
in is amber. Tapping a tab opens that section.

**Why this priority**: It is the story.

**Independent Test**: At 375 px, open Home and each placeholder screen, check
the bar, its active tab, and where each tab leads.

**Acceptance Scenarios**:

1. **Given** a visitor on Home on a phone 375 px wide, **when** the page
   renders, **then** a bottom bar shows "Caută", "Service-uri" and "Cont",
   and "Caută" is active and amber.
2. **Given** the visitor opened the results for a brand earlier in this
   visit, **when** they tap "Service-uri", **then** the results for that brand
   open; **given** they did not, **then** the results screen opens without a
   brand.
3. **Given** a visitor who is not signed in, **when** they tap "Cont",
   **then** the account screen opens (a placeholder until the sign-in sheet of
   ST-82 replaces it).
4. **Given** a signed-in person, **when** they tap "Cont", **then** their
   dashboard opens, in the role they used last.
5. **Given** a results, garage or mechanic screen, **when** it renders,
   **then** "Service-uri" is the active tab; on the account screen "Cont" is.

---

### User Story 2 - The bar fits every phone and every person (Priority: P1)

On an iPhone with a home indicator the bar sits above the indicator. Each tab
is big enough to tap, every label readable, and a screen reader announces the
bar as the main navigation and the current tab as the current page.

**Why this priority**: A bar under the home indicator or with small targets
cannot be used; the shared phone rules of ST-286 require it.

**Independent Test**: At 320 px and 375 px measure the tabs and labels and
the page width; read the bar's accessible names.

**Acceptance Scenarios**:

1. **Given** an iPhone with a home indicator, **when** the bar shows, **then**
   its bottom padding is at least the safe-area inset, and each tab is at
   least 44 px tall.
2. **Given** a phone, **when** the labels render, **then** they are at least
   12 px (the mock's 11 px is fixed).
3. **Given** a 320 px phone, **when** a public screen renders, **then** the
   page does not scroll sideways.
4. **Given** a screen reader, **when** it reaches the bar, **then** it hears a
   navigation landmark named "Navigare principală", each tab by its label, and
   the active tab as the current page.
5. **Given** a keyboard, **when** the person tabs through the bar, **then**
   each tab takes focus in order with the visible focus ring and opens with
   Enter.

---

### User Story 3 - Both languages, phone only (Priority: P2)

In English the bar reads "Search", "Garages" and "Account". On a tablet or a
desktop the bar is hidden and the desktop header is used. While someone types
in a field on a phone, the bar steps out of the keyboard's way.

**Why this priority**: The language and the breakpoint are part of the brief;
the keyboard rule is a proposed default.

**Independent Test**: Switch the language with the bar shown; open a public
screen at 768 px and 1024 px; focus a text field at 375 px.

**Acceptance Scenarios**:

1. **Given** the language is English, **when** the bar renders, **then** the
   labels read "Search", "Garages" and "Account" and the landmark is "Main
   navigation".
2. **Given** a screen 768 px wide or more, **when** a public page renders,
   **then** the bar is hidden.
3. **Given** a text field has focus on a phone, **when** the person types,
   **then** the bar is hidden until the field loses focus.

### Edge Cases

- The language switches while the bar shows: the labels change in place and
  every tab's address moves to the new language prefix.
- `/` without a language prefix: the browser moves straight on to a language
  address (ST-21), where the bar shows; the server's Romanian render of `/` is
  for search engines and has no bar.
- An unknown address under a language prefix answers the not-found page, which
  is not a public section screen and has no bar.
- The dashboards (`/app/*`) and the Cockpit sample (`/cockpit`) are not public
  screens and have no public bar (the dashboards get their own bar in ST-288).
- A results address with no `brand`, or an empty one, keeps the brand already
  remembered.
- A signed-in person's session that has expired: opening the account screen
  asks the server once per visit to that screen and, without an answer,
  behaves as signed out; a failed answer is not remembered.
- A short page (Home today is three lines): the bar still sits at the bottom
  of the screen, not under the last line.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Below 768 px, every public screen — Home and the results,
  garage, mechanic and account screens under a language prefix — MUST show a
  bar at the bottom of the screen with three tabs, in this order: "Caută",
  "Service-uri", "Cont" (English "Search", "Garages", "Account"), each an icon
  with its label, never an icon alone.
- **FR-002**: The bar MUST be a navigation landmark named "Navigare
  principală" (English "Main navigation"); the icons MUST be hidden from
  assistive technology.
- **FR-003**: Exactly one tab MUST be active, chosen by the current screen:
  Home → "Caută"; results, garage and mechanic screens → "Service-uri"; the
  account screen → "Cont". The active tab MUST carry `aria-current="page"` and
  the theme's amber ink (`--mf-amber-ink`); the other two MUST carry neither
  and use the secondary text colour.
- **FR-004**: "Caută" MUST lead to Home in the current language.
- **FR-005**: "Service-uri" MUST lead to the results screen with the brand of
  the last results address opened in this visit (its non-empty `brand` query
  parameter), and to the results screen without a brand when none was; the
  brand is held in memory until the page reloads.
- **FR-006**: "Cont" MUST lead to the account screen (the same address
  whether signed in or not). Opening the account screen MUST ask the session
  once and show the signed-in person's dashboard (the landing of the role they
  used last) when someone is signed in, and the account placeholder otherwise.
- **FR-007**: The bar's bottom padding MUST be at least the device's bottom
  safe-area inset; each tab MUST be at least 44 px tall; each label at least
  12 px; and no public screen may scroll sideways at 320 px with the bar shown.
- **FR-008**: From 768 px wide the bar MUST be hidden.
- **FR-009**: While a text field has focus — a textarea, an editable element,
  or an input of any type but button, checkbox, color, file, image, radio,
  range, reset and submit — the bar MUST be hidden (not shown, not announced,
  not focusable); it MUST show again when that focus leaves.
- **FR-010**: The bar MUST sit at the bottom of the screen on a page shorter
  than the screen, and MUST NOT cover the end of a longer page: the last
  content of a public screen stays visible above the bar when scrolled to the
  bottom.
- **FR-011**: Until EP-4 and ST-82 build them, the results (`garages`),
  garage (`garages/<garage>`), mechanic (`mechanics/<mechanic>`) and account
  (`account`) screens MUST exist under each language prefix as placeholders:
  a heading naming the section and one line saying the screen comes later, in
  both languages; they are not added to the sitemap.
- **FR-012**: The bar's texts MUST exist in Romanian and English with the
  same keys; switching the language MUST change the labels and the landmark
  name in place, and the tabs MUST lead to the addresses of the new language.

### Key Entities

- **Tab**: one of `search`, `garages`, `account`; a label, an icon and a
  destination address.
- **Last brand**: the non-empty `brand` of the last results address opened in
  this visit; in memory, lost on reload.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 375 px, a visitor on Home reaches each of the three sections
  in one tap (the end-to-end test taps each tab from Home and checks the
  address).
- **SC-002**: At 320 px, every public screen with the bar has
  `document.documentElement.scrollWidth` ≤ 320 and every tab is at least
  44 px tall.
- **SC-003**: At 768 px and 1024 px the bar is not visible on any public
  screen.
- **SC-004**: The en and ro text files of the bar have identical key sets
  (the i18n check passes).

## Clarifications

### Session 2026-10-04

- Q: The screens behind Service-uri and Cont do not exist (EP-4, ST-82). What
  do the tabs lead to? → A: Placeholder screens under the language prefix,
  named after the only addresses Notion gives (`/mechanics/:slug`, story "Update open garage profiles and search results live";
  `GET /api/v1/garages/:slug`, ST-307): `garages`, `garages/<garage>`,
  `mechanics/<mechanic>`, and `account` for Cont (autonomous default; the
  timeline row says "build the bar against placeholder routes").
- Q: With no remembered brand, does "Service-uri" open Home or the results
  screen? → A: The results screen without a brand: the mock links the tab to
  Results, and from Home a tab that reopens Home would look dead and leave
  "Caută" active (spec-challenger, recommended).
- Q: Is the signed-in redirect decided by the tab's address or by the account
  screen? → A: By the account screen's guard, as the dashboards' area guard
  does: one stable address for the tab, and no session call on every public
  page load (recommended).
- Q: Where does the bar live, and how does it stay at the bottom of a short
  page? → A: One public frame under the language prefix (Home and the
  placeholders), a full-height column with the bar last and sticky; the
  not-found page stays outside it (recommended).
- Q: Memory or session storage for the last brand, and does a results address
  without a brand clear it? → A: Memory, lost on reload; a missing or empty
  `brand` keeps the previous one; only the results address records it
  (recommended).
- Q: Which fields hide the bar, and how hidden? → A: Not displayed at all
  (out of the accessibility tree and the tab order); every input type that
  takes typed text, textareas and editable elements (recommended).

## Assumptions

- The sign-in sheet (ST-82) does not exist; until it does, "Cont" for a
  signed-out visitor opens the account placeholder instead of a sheet over the
  current screen (autonomous default; Build brief scenario 3 is *proposed* and
  names the sheet as out of scope).
- "Searched for a brand before in this session" (scenario 2) is read as "opened
  a results address with a `brand` in this visit", in memory, since no search
  exists yet; without one the tab opens the results placeholder, not "Home at
  the brand picker" (*proposed* in the Build brief), which EP-4 can revisit
  once the picker exists (autonomous default, see Clarifications).
- The placeholders accept any garage or mechanic slug, and get the canonical
  and hreflang tags every address under a language prefix gets; they are only
  left out of the sitemap, since EP-4 replaces them (autonomous default).
- The server's render of `/` has no bar: `/` exists for search engines and the
  browser moves on to the language address at once (ST-21) (autonomous
  default).
- The bar sits at the end of the public frame with `position: sticky`, as on
  the mock's Home and garage boards, so it never covers content (FR-010)
  (autonomous default).
- "Keyboard open" is detected as a text field having focus, since browsers do
  not report the on-screen keyboard reliably (autonomous default; Build brief
  scenario 9 is *proposed*).
- The bar's texts live in the `public` text area, which is loaded before any
  public screen renders, on the server and in the browser (autonomous default;
  the `public` files are empty today, and the shell file is being changed by
  ST-18).

## Spec Delta

### Capability: `phone-layout`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012

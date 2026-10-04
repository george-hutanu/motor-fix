# Feature Specification: Reach every dashboard view from a bottom tab bar on a phone

**Feature Branch**: `288-dashboard-tab-bar`

**Created**: 2026-10-04

**Status**: Archived (2026-10-04)

**Input**: User description: "ST-288 Reach every dashboard view from a bottom tab bar on a phone (Notion story https://app.notion.com/p/3ee607bff0d2816f83b1d10d181fc8f1, epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Scope: one shared mf-dashboard-tab-bar component that, below 768 px, replaces each dashboard's (driver, garage, mechanic, admin) side menu with a sideways-scrolling bottom tab bar fed by the same per-dashboard view list (role/permission/garage-feature filtered) as the side menu and route guard, with placeholder views, safe-area aware, active tab aria-current."

**Sources**: Notion story ST-288 https://app.notion.com/p/3ee607bff0d2816f83b1d10d181fc8f1 (read 2026-10-04, page edited 2026-10-04; Build brief wins over the story body; Open: none) · timeline row https://app.notion.com/p/3ee607bff0d281088e7ccbe92c50d14b ("build the bar and one per-dashboard view list with placeholder views"; blocked by ST-286, ST-82, ST-79, all merged) · the existing dashboard frame `apps/web/src/app/dashboard/frame.ts` and the capability table `libs/domain/src/auth/capabilities.ts`.

## Clarifications

### Session 2026-10-04

- Q: What is each view's address segment, and are dashboard addresses language-neutral? → A: Language-neutral English segments fixed in the view list: driver `requests, cars, reviews, saved, settings`; garage `requests, schedule, team, prices, reviews, profile`; admin `garages, users, reviews, catalogue, settings`; the dashboard view is the bare `/app/<area>` (the `/app/*` routes already skip the language prefix).
- Q: Does this story ship garage feature-switch filtering, or is it deferred to the EP-2 "Garage feature switches" story? → A: Deferred whole: nothing produces a garage's switched-off features yet (the session carries none), so a feature field would have no input (Principle I). Recorded in `deferred.md` for the story that introduces the switches, with the `garage.features_changed` / `mechanic.updated` live refresh.
- Q: Is a refused or unknown address redirected or rendered in place, and does a view's address cover its sub-paths? → A: Redirected, the address replaced by the dashboard's own, decided before the view is loaded; a view's address covers its sub-paths so owning epics can add detail pages.
- Q: Is the phone/tablet switch a style rule at 768 px or a conditional render? → A: A style rule at 768 px with both the side menu and the bar in the page, both rendered from the one filtered list; unit tests cover the list, the filter and menu = bar, end-to-end tests the visibility at 375 px and 768 px.
- Q: Is the mechanic's "own jobs" a view with its own tab in release 1? → A: No: it is the dashboard view's body for a mechanic, built by the workspace epic; `garage.own_jobs`, `garage.final_price` and `garage.audit_history` are actions, not views, and get no tab.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reach every view of my dashboard with one thumb (Priority: P1)

A signed-in person on a phone opens their dashboard. Instead of a side menu,
a bar at the bottom shows one tab per view their dashboard offers them. The
tab of the open view is amber. Tapping a tab opens that view; when the tabs do
not fit, the bar scrolls sideways and the page does not.

**Why this priority**: It is the story.

**Independent Test**: At 375 px, sign in as a driver, a garage owner, a
receptionist, a mechanic and an admin; tap every tab; each view opens, its tab
becomes active, and the page never scrolls sideways.

**Acceptance Scenarios**:

1. **Given** a driver on a phone 375 px wide, **when** the dashboard opens,
   **then** the side menu is gone and a bottom bar shows one tab per view of
   the driver dashboard, and the bar scrolls sideways when the tabs do not fit.
2. **Given** a view is open, **when** the bar renders, **then** that view's
   tab is active (amber, `aria-current="page"`) and scrolled into sight.
3. **Given** a mechanic (release 1: the limited garage dashboard), **when**
   they sign in, **then** the bar shows only the dashboard view plus the views
   their permissions allow (answer quotes → requests, move bookings →
   schedule).
4. **Given** a receptionist, **when** their garage dashboard opens, **then**
   there are no tabs for the team, the prices or the garage profile.
5. **Given** an admin on a phone, **when** the admin dashboard opens, **then**
   every admin view is reachable from the bar.
6. **Given** a garage owner, **when** the dashboard opens, **then** every
   garage view is reachable from the bar.

---

### User Story 2 - The side menu and the bar never disagree (Priority: P1)

The side menu on a tablet or desktop, the bar on a phone and the address bar
all describe the same set of views. A view that is not in a person's menu
cannot be opened by typing its address either.

**Why this priority**: The Build brief's first rule; without it the bar and
the menu drift apart as later epics add views.

**Independent Test**: For each role, compare the side menu's entries at
1024 px with the bar's tabs at 375 px; open a refused view's address directly.

**Acceptance Scenarios**:

1. **Given** any role, **when** the dashboard renders at 375 px and at 1024 px,
   **then** the bar's tabs and the side menu's entries are the same views in
   the same order (the bar uses each view's short label, the menu its long
   one).
2. **Given** a screen 768 px wide or more, **when** a dashboard renders,
   **then** the side menu is used and the bar is hidden; below 768 px the side
   menu is hidden and the bar is shown.
3. **Given** a receptionist, **when** they open the address of the team view
   directly, **then** they land on their dashboard view instead.
4. **Given** a person whose session changes role (ST-394, role switching),
   **when** the session's role changes, **then** the bar and the menu show
   the new role's views.

---

### User Story 3 - The bar fits every phone and every person (Priority: P2)

On an iPhone with a home indicator the bar sits above the indicator. Each tab
is big enough to tap and its label readable, Romanian labels are never cut
mid-word, and a screen reader announces the bar as the dashboard's navigation
and the open view as the current page.

**Why this priority**: The shared phone rules (ST-286) require it; a bar under
the home indicator or with small targets cannot be used.

**Independent Test**: At 320 px and 390 px measure the tabs, the labels and
the page width; read the bar's landmark name and the active tab's state.

**Acceptance Scenarios**:

1. **Given** an iPhone with a home indicator, **when** the bar shows, **then**
   its bottom padding is at least the safe-area inset, and each tab is at
   least 44 px tall with a label of at least 12 px.
2. **Given** the Romanian interface at 320 px, **when** the garage dashboard
   renders, **then** every tab shows its whole label (tabs grow to fit) and
   the page has no horizontal scroll.
3. **Given** a screen reader, **when** it reaches the bar, **then** it is a
   navigation landmark named after the dashboard (for example "Panou
   service"), and the active tab is announced as the current page.

### Edge Cases

- A person with only the dashboard view (a mechanic with no permissions):
  the bar shows that one tab; it is still present so the dashboard looks the
  same for every role.
- An unknown view address under a dashboard (`/app/driver/nope`): the person
  lands on their dashboard view.
- The open view is refused after a session change (role switch, a permission
  removed): the person is moved to their dashboard view.
- A slow view: its tab stays active while the view shows its loading state.
- Signing out from a phone: the account controls (name, sign out, language)
  stay reachable when the side menu is hidden.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each dashboard (driver, garage, admin; the mechanic uses the
  garage dashboard in release 1) MUST have exactly one ordered list of views,
  each view with its menu label, its short tab label (the mock's: "Cereri"
  for "Cereri de ofertă") and, where it has one, the capability it requires.
- **FR-002**: Each view MUST have its own language-neutral address under its
  dashboard (the segments in Clarifications), covering its sub-paths, and the
  dashboard view MUST be the dashboard's own address.
- **FR-003**: Opening the address of a view the session's capabilities do not
  allow, or of a view that does not exist, MUST redirect the person to their
  dashboard's own address before the view loads; the decision MUST read the
  same view list as the menus.
- **FR-004**: Below 768 px, the dashboard MUST show a bottom tab bar instead
  of the side menu, with one tab per view the session allows, in list order;
  the bar and the side menu MUST both be rendered from that one filtered list.
- **FR-005**: At 768 px and wider, the dashboard MUST show the side menu and
  hide the bar; the side menu MUST offer the same views as the bar.
- **FR-006**: The open view's tab and menu entry MUST be marked as the current
  page (`aria-current="page"`, amber), and the active tab MUST be scrolled
  into sight in the bar.
- **FR-007**: When the tabs do not fit, the bar MUST scroll sideways on its
  own; the page MUST never scroll sideways at 320 px.
- **FR-008**: Each tab MUST be at least 44 px tall with a label of at least
  12 px; labels MUST never be cut — a tab grows to fit its label.
- **FR-009**: The bar MUST sit above the safe-area inset at the bottom of the
  screen.
- **FR-010**: The bar MUST be a navigation landmark named after the
  dashboard.
- **FR-011**: The bar and the side menu MUST follow the session: when its
  role or capabilities change, the tabs change, and a view that is no longer
  allowed is left for the dashboard view.
- **FR-012**: On a phone the account controls (the person's name, sign out,
  the language switch) MUST remain reachable without the side menu.
- **FR-013**: Each view MUST show its title and a placeholder body until the
  epic that owns the view builds it.

### Key Entities

- **Dashboard view**: one entry of a dashboard's list — its address segment,
  its label, and the capability it requires (none for the dashboard view).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every role, 100% of the views in the side menu are reachable
  from the bar on a 375 px phone, and the two lists are identical.
- **SC-002**: On 320 px and 390 px phones, the dashboards have zero
  horizontal page scroll in Romanian and English, light and dark.
- **SC-003**: Every tab measures at least 44 px tall with a label of at least
  12 px.
- **SC-004**: A refused or unknown view address never shows that view: it
  lands on the dashboard view every time.

## Assumptions

- Out of scope, deferred: the Build brief's scenario 3 (switched-off day
  sheets / team lose their tab) and the `garage.features_changed` /
  `mechanic.updated` live refresh. Nothing produces a garage's feature
  switches yet (EP-2 "Garage feature switches"; ST-254's note "GARAGE_FEATURE
  arrives with EP-2: every feature counts as on until then"), so every view
  is on; `deferred.md` carries the work for that story. (autonomous default)
- A mechanic's "own jobs" is the dashboard view's body, not a tab; their bar
  is the dashboard tab plus the requests / schedule tabs their permissions
  grant. (autonomous default — Notion W01, `capabilitiesOf`)
- The views behind the tabs are placeholders (title + "nothing here yet"),
  built by their epics. (timeline note: "build the bar and one per-dashboard
  view list with placeholder views")
- The mechanic uses the garage dashboard in release 1 (Notion decision
  2026-10-03, W01); their bar is the garage list filtered by their
  capabilities, which already fold in their permissions
  (`capabilitiesOf`). (autonomous default)
- Role switching itself is ST-394; this story only guarantees that the bar
  and menu follow a session whose role changes. (autonomous default)
- The view list, labels and order are the ones the dashboard frame already
  shows (ST-82), so existing translations are reused. (autonomous default —
  `apps/web/src/app/dashboard/frame.ts`)
- The mock's "AI" tab (Asistent AI) is left out: the AI assistant connection
  is its own epic (release 3) and adds its view to the list then. (autonomous
  default — design.md)
- On a phone the aside stays above the header as an account band (logo,
  area, the person's name, "Ieși din cont"); only its menu is hidden. The
  mock has no account controls on a phone; one copy of them is kept rather
  than a second set in the header. (autonomous default — design.md, review
  2026-10-04)
- A redirected address keeps its query string; only the path becomes the
  dashboard's own. (autonomous default — adversary review 2026-10-04)
- 768 px is the phone/tablet boundary of the shared phone rules
  (`libs/ui-cockpit/src/lib/layout.ts` `BREAKPOINTS.tablet`).

## Spec Delta

### Capability: `phone-layout`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013

# Feature Context: Dashboard bottom tab bar on a phone

- **Feature**: 288-dashboard-tab-bar
- **Anchor**: ST-288 Reach every dashboard view from a bottom tab bar on a phone — https://app.notion.com/p/3ee607bff0d2816f83b1d10d181fc8f1
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture partial (not needed: no tables, no new flow; Security excerpt only) | decisions partial (decisions repeated in the story brief, feature page and epic; Open decisions page not fetched, too big)
- **Overall confidence**: high

## Story

- **ST-288 Reach every dashboard view from a bottom tab bar on a phone** — status Planning, priority High, role Driver, epic EP-1 Foundations, feature MF-4 Mobile experience, 3 points, PR #63 linked, page edited 2026-10-04T19:08.
- Scope per the story: "On a phone each dashboard replaces the side menu with a bottom tab bar that scrolls sideways, one tab per view"; every view reachable; the bar respects the safe area; it "works the same in the driver, garage, mechanic and admin dashboards". Build brief (wins over the story body): one shared component, proposed name `mf-dashboard-tab-bar`, "fed by the same list of views as the desktop side menu, so the two can never differ"; the route guard reads the same list too.
- Comments that moved scope: none. The story page has no comments (`notion-get-comments` with all blocks returned only `suggested_edits_status: not_enabled`); the feature page showed no discussion markers either.

## Decisions

- Tabs are "the views their role, permission and garage feature switches allow"; one list per dashboard holds each view's required role, permission and garage feature, and the side menu, the bar and the route guard all read it — [ST-288 Build brief, Who can do it / Rules] (2026-10-04, confidence: high)
- Until the mechanic dashboard ships (release 2), a mechanic signs in to a limited garage dashboard showing "only their own jobs and what their permissions allow (W01)"; its bar shows only those views — [ST-288 Notes "Left for later", decided 2026-10-03; Build brief scenario 4; MF-4 Final rules 8] (2026-10-04, confidence: high)
- A receptionist's garage dashboard has no tabs for settings, prices or the team (W10) — [ST-288 scenario 5]; the role has "no access to settings, prices or the team" and no permission ticks, the scope being fixed — [Set up the account model, the roles and their rights; Security, performance and operations] (2026-10-03/04, confidence: high)
- Switching a garage feature off removes its tab (day sheets, team and mechanics, [25]); hiding a panel on a customisable dashboard never removes a tab (ST-15). `garage.features_changed` and `mechanic.updated` on `garage:{garageId}` refresh tabs on open screens — [ST-288 scenario 3, Rules, Events; MF-4 Final rules 8, Data and events (MF-52)] (2026-10-04, confidence: high)
- Touch and type floor [24]: every tab at least 44 px tall; the smallest text on a phone is 12 px, tab labels included (the mock's 11 px tab labels are fixed); bars respect the safe area with `env(safe-area-inset-bottom)` and `viewport-fit=cover` — [MF-4 Mobile experience, Final rules 2, 4, 5] (2026-10-03, confidence: high)
- Breakpoints: phone below 768 px, tablet 768–1023, desktop from 1024 (marked proposed on MF-4); the bar is hidden from 768 px up — [MF-4 Final rules 6; ST-288 scenario 9] (2026-10-03, confidence: medium)
- Role switch (ST-394): one account may hold driver and garage; the switch opens that role's dashboard without signing in again and stores `ACCOUNT.last_role`; the bar changes to that role's views — [ST-288 scenario 8; "Switch between my driver and garage roles in one account", edited 2026-10-04T15:43; EP-1 Risks, decided 2026-10-03] (confidence: high; the ST-394 page itself was not read in full)
- The bar is a `nav` landmark labelled with the dashboard's name; the active tab has `aria-current="page"`; Romanian labels are never cut mid-word (tabs grow, the bar scrolls) — [ST-288 Rules] (2026-10-04, confidence: high)

## Constraints

- Timeline row: "The dashboards' view lists come from ST-97 and ST-160 (other epics): build the bar and one per-dashboard view list with placeholder views." Blocked by ST-286, ST-82, ST-79; wave W4, 10–11 Nov 2026 — [Foundations (EP-1) build timeline, row ST-288] (2026-10-04, confidence: high)
- The views behind the tabs are out of scope (Driver account basics, Garage workspace, Garage onboarding and verification for admin, mechanic dashboard in release 2); customising panels and garage feature switches are their own stories — [ST-288 Out of scope] (2026-10-04, confidence: high)
- Front end only: the `apps/web` shell and layout parts in `libs/ui-cockpit`; no entities, no events emitted, nothing written, no audit history — [MF-4 Build brief; ST-288 Data] (2026-10-03, confidence: high)
- Tests named by the story: Jest for the tab list per role, permission and feature, side menu equals bar, hidden at 768 px and up; Playwright at 375 px opens each of the four dashboards with seeded accounts, taps every tab, and the bar never scrolls the page sideways — [ST-288 Tests] (2026-10-04, confidence: high)

## Prior Art

- ST-286 (shared phone rules, breakpoints, safe area, manifest) and ST-82 (sign-in and landing per role) are the stories this one needs; the timeline names ST-286, ST-82, ST-79 as blockers and the spec records them merged — [ST-288 Depends on; build timeline] (2026-10-04)
- The public three-tab bar (Caută, Service-uri, Cont) is a separate story (the public bottom tab bar, needs ST-286 and ST-17); it must not be duplicated here — [MF-4 stories in build order, item 3] (2026-10-03)
- The mock shows the four mobile dashboards (MDashClient, MDashGarage, MDashMech, MDashAdmin); the mock URL is recorded, not opened — [ST-288 Screens; EP-1 Design] (2026-10-04)

## Open Decisions

none found. The story, the feature page and the epic each end with "Open: None" for this scope.

## Contradictions with spec.md

- **spec.md** (2026-10-04): "Garage feature switches … every view counts as switched on until then" (Assumptions) — **Notion**: scenario 3 of the story's Build brief is an acceptance scenario of ST-288 itself: switched-off day sheets and team and mechanics have no tab, and the list carries each view's required garage feature. Only the switches' own UI and storage are "Out of scope" [ST-288 Build brief] (2026-10-04) — newer: same date, cannot tell (spec has no usable time; the story was edited 2026-10-04T19:08)
- **spec.md** (2026-10-04): FR-011 and the Assumptions leave `garage.features_changed` and `mechanic.updated` live refresh to later stories — **Notion**: the brief lists both as "Live updates" that refresh tabs on open screens [ST-288 Events and notifications] (2026-10-04) — newer: same date; the timeline note (ST-257 outbox not a blocker) points to the spec's deferral being sound, so this is a contradiction to settle, not to guess

## Proposed Clarifications (this command's proposals, not requirements)

- Should the view model carry an optional `feature` field per view and a feature-set input that defaults to all-on, so scenario 3 is testable now and EP-2/5 only supply the data? — from the scenario 3 contradiction
- Should FR-011 be split: role and capability changes follow the session now (ST-394), feature and permission pushes from `garage.features_changed` / `mechanic.updated` arrive with their events? — from the live-update contradiction
- Add a rule that hiding a panel never removes a tab (ST-15); the spec does not state it — from ST-288 Rules
- Phone extras the brief marks proposed: the bar hides while a field has focus (on-screen keyboard), and labels wrap onto two lines at 200% text zoom. Adopt or leave out? The spec says only "tabs grow to fit" — from MF-4 States and Edge cases
- The story and MF-4 list the mechanic's own jobs as a tab; the spec derives the mechanic's tabs from capabilities (quotes → requests, bookings → schedule). Confirm that "own jobs" has no separate view in release 1 — from W01

## Gaps

- [NEEDS CLARIFICATION: which views exist in each dashboard's list; the story does not list them, and the owning stories (ST-97 driver, ST-160 admin, plus EP-5 garage) were not read here.]
- The ST-394 page and the Capabilities by role matrix on Security were not read in full; the spec's capability mapping for receptionist and mechanic rests on the story text and the search excerpts above.
- The mock's account controls on a phone are not described in Notion (the spec's own default: name, sign out, language in the header). The feature page puts the bell in each dashboard's top bar (proposed, ST-199).

## Sources

- Reach every dashboard view from a bottom tab bar on a phone (ST-288) — https://app.notion.com/p/3ee607bff0d2816f83b1d10d181fc8f1
- 📱 Mobile experience (MF-4) — https://app.notion.com/p/3ee607bff0d2813a9502fb7f92387eb4
- 🧱 Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Foundations (EP-1) build timeline, row ST-288 — https://app.notion.com/p/3ee607bff0d281088e7ccbe92c50d14b
- Set up the account model, the roles and their rights — https://app.notion.com/p/3ee607bff0d281778692cbdd267fb72f
- Switch between my driver and garage roles in one account — https://app.notion.com/p/3ee607bff0d281029850d5192fa1e164
- Switch off garage features we do not need — https://app.notion.com/p/3ee607bff0d281989948e39e6376a063
- Team: the garage's mechanics — https://app.notion.com/p/3ee607bff0d281d1a3b4dd96db758a99
- Security, performance and operations — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3

[UNAVAILABLE: design mock — Artifact read of https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr returned "artifact not found — deleted or not shared with this account" (2026-10-07, as for ST-39)]

# Design: List garages that take my brand before those that refuse (ST-43)
Checked: 2026-10-07 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, could not be opened) · Story: https://app.notion.com/p/3ee607bff0d281e68b80d309875dec93

## Boards
- The story's `Design boards` roll up from EP-2: Desktop (Cockpit) › List your
  garage, Mobile (Cockpit) › Mobile · List your garage, Dashboards (Cockpit) ›
  Dashboard · Admin, Mobile (Cockpit) › Mobile · Admin dashboard. None of them
  is this story's screen.
- The Build brief's Screens section names Results + map (Results.dc.html) and
  Mobile · Results (Mobile.dc.html): the two groups and the count line. Both
  boards belong to EP-4's results screen story (See garages for my brand, those
  that take it first), which the brief puts out of scope here. Not seen: the
  mock is unavailable.

## What to build to match it
- No screen in this story: a backend query and API fields. Per the brief and the
  story's Notes, the mock's Results board shows six sample garages, three that
  work on BMW first, then three that do not take it, and the count line above
  the list reading "3 lucrează pe BMW · 3 nu o primesc".
- What the results screen will need from this story, so the data fits the board:
  every approved garage in two groups (takers first); each garage's answer for
  the brand (`works_on`, `does_not_take`, `unstated`) for the red lamp on the
  second group; the two counts over everything found for the count line; 20 a
  page with a cursor that never mixes the groups (the load-more story); the
  order inside a group by rating, reviews, then name (ST-328's default).

## States
- Shown in the mock: not seen (mock unavailable). The brief: a brand nobody
  takes ("0 lucrează pe Tesla · 5 nu o primesc", the five refusers listed); no
  garage at all ("0 lucrează pe BMW · 0 nu o primesc", the empty screen is the
  results screen's); search slow or failing (the screen's own error; the counts
  are never shown without the list).
- Not designed (build from the Build brief, flag in the PR): the answer for an
  unknown brand (not found), a malformed brand id or foreign cursor (bad
  request), a garage whose stance changes between two pages.

## Mock vs Build brief
- Mock (per the Notes): six sample garages, three takers then three refusers.
  Build brief (2026-10-03, newer): the second group also holds garages that have
  not marked the brand, decided 2026-10-03; the counts cover everything found,
  not the page. The Build brief wins.
- Mock: the count line in Romanian only. Build brief: the line's two numbers come
  from the API; the texts in both languages are the results screen's.

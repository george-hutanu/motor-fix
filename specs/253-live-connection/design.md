# Design: Set up the real-time connection to open dashboards (ST-253)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375; `project/DashClient.dc.html`, `project/DashGarage.dc.html`) · Story: https://app.notion.com/p/3ee607bff0d281739e3df7b8fc484d49

No screens: the Build brief's Screens section says none ("No new screen. The
dashboard shells of DashClient, DashGarage, DashMech and DashAdmin (desktop and
mobile) open the connection. The test toast uses the shared Toast."). The
story's Design boards roll up from EP-1 and none of them is about this task.

## Boards
- Dashboards (Cockpit) › Dashboard · Driver (`DashClient.dc.html`) and the garage
  board (`DashGarage.dc.html`): the live state shows only inside later views
  (the workshop panel's amber "LIVE" pill with a blinking dot, a `role="timer"`
  beside it). Those views belong to Live from the workshop; nothing here draws
  them. Neither board contains a toast.

## What to build to match it
- No new screen and no visible connection indicator (none is designed).
- The test update shows through the shared toast already in the kit:
  `HlmToaster` / `toast` from `libs/ui-cockpit` (Spartan sonner, coloured by
  `cockpit.css` through `spartan-toast`), mounted once in the dashboard frame.
- Text, RO / EN: "Actualizare de test în direct" / "Live test update" (autonomous
  default, spec Assumptions).

## States
- Shown in the mock: none for this task.
- Not designed (build from the Build brief, flag in the PR): the toast's place and
  duration (sonner's defaults), and any connecting / reconnecting indicator
  (none is built; ST-255 owns reconnect states).

## Mock vs Build brief
- The mock proves live updates only between tabs on one device (BroadcastChannel,
  per the story's Notes); the Build brief's server stream replaces that → the Build
  brief wins.

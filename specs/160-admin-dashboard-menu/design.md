[UNAVAILABLE: design mock — Artifact read: "artifact not found — it may have been deleted, or it has not been shared with you" (both the page and `DashAdmin.dc.html` / `MDashAdmin.dc.html`); boards filled from the Build brief and from the earlier checks of the same boards in `specs/079-account-model`, `128-sign-out`, `199-notification-bell`, `286-phone-layout`, `288-dashboard-tab-bar`, `207-garage-approval-flow` and `052-chart-style`]

# Design: ST-160 Open the admin dashboard and its menu, admins only
Checked: 2026-10-07 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, published version 1791040637-c375 at the last successful read, ST-288) · Story: https://app.notion.com/p/3ee607bff0d281bcb229eaf763d5d51c

## Boards
- Dashboards (Cockpit) › Dashboard · Admin (`DashAdmin.dc.html`): the shared dashboard frame — 252 px side menu (`aside.mf-side`) with the admin entries, the sticky header (title, subtitle line, RO/EN switch, bell), the account block with "Ieși din cont" at the bottom of the menu; the body shows Panou's four numbers and growth, Service‑uri de verificat and the drawer Dosar de verificare, Setări with the rule switches (other stories). The story says: all seven views open, with sample numbers.
- Mobile (Cockpit) › Mobile · Admin dashboard (`MDashAdmin.dc.html`): the same component at 390 px with `mobile="yes"`; the side menu is hidden, the header keeps title, subtitle and RO/EN (the bell is hidden below 900 px), and the views are reached from the sticky bottom tab bar `nav.mf-glass.mf-tabbar` ("Secțiuni"), `padding: 6px 8px max(14px, env(safe-area-inset-bottom))`.

## What to build to match it
- Frame: `apps/web/src/app/dashboard/frame.ts` already renders the admin area (`DASHBOARDS.admin`: Panou, Service‑uri, Utilizatori, Recenzii raportate, Mărci și lucrări, Setări; tag `shell.frame.area.admin` = "Administrator"). This story adds the Asistent AI entry, the per-view release mark (unreleased views hidden from menu, tab bar and routes), the header's waiting line and the counters.
- Menu entries (RO / EN, from the mock as read for ST-079): Panou / Dashboard · Service‑uri / Garages · Utilizatori / Users · Recenzii raportate / Reported reviews · Mărci și lucrări / Brands and jobs · Asistent AI / AI assistant · Setări / Platform settings. Shell texts use U+2011 in "Service‑uri".
- Header (Build brief scenario 4): "MotorFix · București · 4 service‑uri așteaptă verificarea" / "MotorFix · Bucharest · 4 garages are waiting for verification" as the subtitle line under the title; the label "ADMINISTRATOR" (the frame's area tag, upper-case in the Cockpit eyebrow style); the RO/EN switch (`mf-language-switch`) in the header's right-hand group, bell after it.
- Counters: a count chip on the Service‑uri entry and on its phone tab (hidden at zero); "Recenzii raportate" gets its chip only when MF-45 is released (not in this story).
- Phone: tab bar entries for the released views only, label 11 px in the tab bar as ST-288 built it; the smallest other text 12 px; no sideways scroll at 320 px.
- Components: Cockpit frame, `mf-panel` skeletons while loading (`libs/ui-cockpit`); no new primitive.

## States
- Shown in the mock (per the story): the seven views open with sample numbers; the header line with the sample count 4.
- Not designed (build from the Build brief, flag in the PR): the loading skeleton of the shell; a counter whose read failed (hidden, never 0); the zero form of the header line ("niciun service nu așteaptă verificarea", autonomous default); the hidden entries of unreleased views; the non-admin redirect and the 404 of `admin/*`; re-read on reconnect.

## Mock vs Build brief
- The mock opens all seven views with sample content; the Build brief hides the unreleased ones behind a release mark → the Build brief wins: at this story only Panou, Service‑uri and Setări are released (spec Assumptions).
- The story's acceptance criteria say the label "ADMIN"; the Build brief says "ADMINISTRATOR" → the Build brief wins (it is newer and the shell already says "Administrator").
- The mock (ST-199 read) shows the bell in the admin header; the Build brief does not mention it → keep the shared frame as it is; nothing in this story changes the bell.
- The mock's sample number 4 is replaced by the real count; the seed holds 2 waiting files (spec Assumptions).

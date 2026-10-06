# Design: Set up push notifications (ST-196)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22) · Story: https://app.notion.com/p/3ee607bff0d28156a023d73a7262de80

The story says "In the mock: Not shown", and the Build brief's Screens section
says the "Activează notificările" button and the iPhone hint are not designed.

## Boards
- Dashboards (Cockpit) › Dashboard · Driver (`DashClient.dc.html`) › Setări:
  subtitle "Datele contului și notificările"; sections "Datele tale" and
  "Notificări". The Notificări section holds the per-kind switches (ST-138),
  nothing about push or devices.
- No board for the garage, mechanic or admin push setting; the garage and
  mechanic dashboards have no Setări view in the app.

## What to build to match it
- One "Notificări pe acest dispozitiv" (notifications on this device) panel,
  a Cockpit card with a heading, one line of state and at most two buttons:
  "Activează notificările" (primary) / "Dezactivează" (secondary) and
  "Trimite o notificare de test". Cockpit tokens and existing button styles
  only; no new component library.
- Placement (spec FR-006): the Setări view of the driver and admin dashboards
  (today placeholders, so the panel is their only content), and the garage
  dashboard's home view, which every garage role sees.
- Phone first: the panel is one column, buttons full width below 390 px, no
  sideways scroll at 320 px. Romanian and English texts through the i18n
  catalogue.
- The push itself: title, body and the MotorFix icon from the web app
  manifest; a tap opens the message's link in the app (or focuses an open tab).

## States
- Shown in the mock: none (the push panel is not designed).
- Not designed (build from the Build brief, flag in the PR): off (button to
  turn on), on (turn off + test), turning on/off (busy), blocked ("Notificările
  sunt blocate în browser" with how to unblock), iPhone outside the Home Screen
  (the add-to-Home-Screen steps, no button), browser without push (says so, no
  button), push not set up on the server (says it is not available yet, no
  button), and a failed save (an error line with retry).

## Mock vs Build brief
- The brief puts the panel in "Setări · Notificări of every dashboard"; the
  garage and mechanic dashboards have no Setări view → the panel sits on the
  garage home view (same call as ST-128 made for its "all devices" row);
  recorded as a decision for the owner.
- The brief's one-time panel after the first quote request waits for the
  quote-request flow, which does not exist yet.

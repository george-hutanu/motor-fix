# Design: Store each person's message choices and check them before sending (ST-197)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr · Story: https://app.notion.com/p/3ee607bff0d2813a8daaf36ef87fada9

No screens: the Build brief's Screens section says "None in this story. The driver's panel (DashClient.dc.html, MDashClient.dc.html) is built in ST-138; the staff panels in ST-198."

## Boards
- Dashboards (Cockpit) › Dashboard · Driver › Setări · Notificări shows the switches this store backs (the story notes list four; the brief adds the fifth, reviews and history [X26a]). Built in ST-138, not here.

## What to build to match it
- Nothing visible. The API returns the group keys and their state so ST-138's panel can draw the switches with the lines under them.

## States
- Shown in the mock: the switches on and off.
- Not designed: a switched-off kind still showing in the app (the bell keeps it: the pipeline still writes the `in_app` row).

## Mock vs Build brief
- The mock has four switches; the brief (latest, 2026-10-03) has five. The brief wins: `reviews_history` is the fifth group.

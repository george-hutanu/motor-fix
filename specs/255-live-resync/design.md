# Design: Get back in step after a lost connection (ST-255)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (version 1791040637-c375; no mock version number stated) · Story: https://app.notion.com/p/3ee607bff0d2810ba16cdf47e382046a

The story is behaviour every dashboard shares, not a screen of its own. Its Notes say "In the mock: Not shown. The mock has no connection to lose." The Build brief's Screens section says "All dashboards, desktop and mobile. The offline bar and the waiting state of a tick are not designed *(proposed texts above)*."

## Boards
- Epic Design table (Foundations): Desktop (Cockpit) › Home (the header every screen shares), Mobile (Cockpit) › the nine mobile boards, Dashboards (Cockpit) › Dashboard · Driver. None shows a lost connection.
- Searched `DashClient.dc.html`, `DashMech.dc.html` and `Mechanic.dc.html` for any offline, reconnecting, "no signal" or "waiting to send" state: none. The mechanic board's step list has `role="status"` rows with a 56 px minimum height, ticked or not; it has no third (waiting) look.

## What to build to match it
- The offline bar: a thin full-width line at the top of the dashboard's content column, under the header and above the e-mail banner, in the Cockpit status style (secondary text, `--mf-size-small`, an amber-ink top and bottom rule, no icon, no close button), `role="status"` so it is read out politely. Text *(proposed in the brief)*: "Fără conexiune. Ce vezi poate fi vechi." / "No connection. What you see may be out of date." It shows after 10 seconds without a connection and goes when the connection is back. It never covers content and never moves focus. At 320 px the text wraps; the bar never scrolls sideways.
- "You need a connection for this" *(proposed)*: "Ai nevoie de conexiune pentru asta" / "You need a connection for this", shown as a toast (the shared `toast()`, as every other one-line notice in the app).
- Refused waiting action notices: a toast with the reason the API gives (the 423 detail names who holds the job, e.g. "Elena, mecanic, lucra la această mașină"), else a generic line per status: 409 "S-a schimbat între timp. Vezi starea de acum." / 404 "Nu mai este disponibil." *(proposed generic texts)*. A waiting action dropped after 24 hours: "O acțiune făcută fără semnal a expirat și nu a fost trimisă." *(proposed)*.
- The waiting state of a tick: no tick exists in EP-1 (the mechanic's job steps come with Mechanic workspace). The queue exposes the waiting actions so that screen can show its tick as waiting; nothing is drawn here.

## States
- Shown in the mock: none (connected only).
- Not designed (built from the Build brief, flagged in the PR): the offline bar, the needs-a-connection message, the refusal and expiry notices, the waiting look of a tick (left to the screen that owns the tick).

## Mock vs Build brief
- No disagreement: the mock has no connection states; the Build brief's proposed texts are used.

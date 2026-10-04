# Design: Set up the shared phone layout rules
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d281df9a9ef85c0725362c

## Boards
Mobile (Cockpit), all eleven 390 px boards of `canvas.json` page `mobile` (the epic calls them "all nine"; MDash* add four dashboards to the seven public ones):
- Mobile · Home (`MHome`), · Garage profile (`MGarage`), · List your garage (`MList`), · Review sheet, · Sign-in sheet, · Sign-up survey, · Driver / Garage / Mechanic / Admin dashboard (`MDash*`): each is the desktop board rendered with `mobile=yes` at 390 px; every one carries `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- Mobile · Results (`Mobile.dc.html`): 20 px side gutters (`padding: 0 20px`), list rows with the garage name first and its key value (rating) beside it, secondary details dropped; a fixed bottom tab bar of three entries, 82 px tall, `padding: 6px 8px 22px` (the 22 px clears the home indicator), entries 52 px tall, labels 11 px.

## What to build to match it
- The viewport meta exactly as the boards have it.
- Phone rules every screen inherits, in `cockpit.css`: field text 16 px, every tap target 44 px, no text under 12 px, labels that wrap on a phone, safe-area tokens used by fixed bars and the sheet.
- The shared table collapsing to list rows on a phone: main text, then the key value, the other columns hidden; header row hidden.
- A layout signal (`phone` / `tablet` / `desktop`) for views that need the layout in code.
- Manifest, icons and the Angular service worker (no screen).

## States
- Shown in the mock: phone at 390 px, dark only.
- Not designed (build from the Build brief, flag in the PR): 320 px, tablet, rotation, text zoom 200 %, light theme colour in the browser bar, the install prompt (browser UI, not ours), the app icon (no icon board — built from the Cockpit tokens: amber ring on the near-black ground).

## Mock vs Build brief
- Tab labels 11 px and dial digits 11 px on the results board → 12 px everywhere (decision 2026-10-03). The tab bar itself belongs to the two bottom tab bar stories; this story fixes the floor.
- The tab bar's bottom padding is a fixed 22 px → `env(safe-area-inset-bottom)` (Build brief: safe area on every fixed bar). The Build brief wins.
- "All nine mobile boards" (epic) → the canvas has eleven mobile boards; all were checked.

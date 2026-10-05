# Design: See my notifications in a list behind the bell (ST-199)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (artifact version 1791040637-c375; no "v22" string in the canvas) · Story: https://app.notion.com/p/3ee607bff0d281e0a903f6f4d2ccf719

## Boards
- Dashboards (Cockpit) › DashClient, DashGarage, DashMech, DashAdmin (desktop): the same bell button "Notificări" / "Notifications" in the sticky header's right-hand group, right after the RO/EN switch. No click behaviour: no list, popover or toast.
- MDash… (390 px): the bell is hidden (`.mf-hidem`, below 900 px); the header keeps title, subtitle and RO/EN; navigation is the bottom tab bar.
- DashClient › activity feed (`ai.log`): a 64 px time column (Michroma 11 px, muted, tabular numbers) and the text beside it, a line between rows. The closest row to reuse for the list.
- DashGarage › quote requests: relative times "acum 12 min", "acum 40 min", "acum 2 h" / "12 min ago", "2 h ago".

## What to build to match it
- Bell: a 44 × 44 px ghost button, 1 px line border, 12 px radius, the mock's 18 px stroke bell icon (two paths, `currentColor`), amber border and colour on hover; label "Notificări" / "Notifications". Placed in the frame's `<header>` after `mf-language-switch`, so every dashboard shell gets it once.
- Unread: the mock's amber 8 px dot (top right) is always on; here it shows only when there are unread notifications, with the count badge "3", "9+" from the brief. The count is also in the button's accessible name.
- List: one task in the Overlays drawer (ST-157), which is the bottom sheet on a phone (ST-158). The brief's 400 px popover is *proposed*; the drawer serves both sizes with one host (spec Clarifications). Rows reuse the activity-feed row: text, then the relative time in the muted small text; an unread row carries an amber dot and stronger text. A header row with "Marchează tot ca citit".
- Toast: Spartan sonner (`toast`), already in the frame for `live.test`.
- Texts in `libs/i18n/src/shell/{ro,en}.json`.

## States
- Shown in the mock: the bell button with its dot (always lit).
- Not designed (built from the Build brief, flagged in the PR): the list itself, its empty state "Nicio notificare încă", loading (three row skeletons), error with "Reîncearcă", "Nu mai este disponibil", the unread count badge, the toast, the bell on a phone.

## Mock vs Build brief
- The mock hides the bell on phones → the Build brief (2026-10-03, newer) wins: the bell sits in the header on phones too and opens a full-height bottom sheet.
- The mock's dot is always lit and has no count → the brief wins: a badge with the unread count, "9+" above 9, hidden at 0.
- The mock's bell opens nothing → the brief wins: it opens the list (the Overlays drawer instead of the proposed 400 px popover).

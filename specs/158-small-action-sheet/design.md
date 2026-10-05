# Design: Open small actions as a bottom sheet on a phone
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d281f58f12cf9b799a4628

The story's Design boards roll up from EP-1 ("Mobile (Cockpit): Mobile · Sign-in sheet", "all nine mobile boards"); its Build brief names "Mobile · Sign-in sheet (MSignIn.dc.html); Mobile · Review sheet (MReview.dc.html)". Read with the Artifact tool: `project/MSignIn.dc.html` and `project/MReview.dc.html` are 390 × 844 px wrappers that render `Results` with `mobile=yes` and the `auth` / `review` overlay open; the sheet itself is drawn by `project/Overlays.dc.html` (its `narrow` branch).

## Boards
- Mobile › Sign-in sheet (`MSignIn`): the results page at 390 px dimmed by the backdrop button `rgba(5,6,8,.74)` ("Închide"), the sign-in task as a sheet on the bottom edge, full width, at most 92 % of the window tall, radius 24 px on the top corners only, panel `#101215` with a `#2A2D31` border; a grip (44 × 5 px, radius 3 px, `#4A4E55`, 8 px from the top, `aria-hidden`) above the same header as the dialog (title, 44 × 44 px X "Închide"), a line, and a body that scrolls on its own with `padding: 20px 22px max(24px, env(safe-area-inset-bottom))`, the main button last in the body.
- Mobile › Review sheet (`MReview`): the same sheet holding the review task (a drawer on a computer), so a drawer becomes a bottom sheet too.
- Overlays › phone branch (script): the shape is chosen when the task opens, from `window.innerWidth <= 640`; every kind (dialog or drawer) becomes the sheet; the sheet enters with `mf-ovsheet` (from 60 % lower, faded) in 360 ms; the page behind is locked; the first field is focused only above 640 px, so a phone gets no keyboard on open. No drag code: the grip is drawn but does nothing in the mock.

## What to build to match it
- In `libs/overlays`: below 768 px wide (the phone rule of `cockpit.css` and the `Layout` signal), `Overlays.open()` shows every shape as a bottom sheet; callers keep `shape: 'dialog' | 'drawer' | 'drawer-wide'` and change nothing.
- The kit's sheet surface gains its bottom edge in `cockpit.css`: `.spartan-sheet-content[data-side="bottom"]` — full width on the bottom edge, top border, `--mf-radius-panel` on the top corners, and ST-53's `mf-pop` from the bottom edge (`transform-origin: center bottom`).
- The panel: a grip row above the header (bar 36 × 4 px in `--mf-line-strong`, the row 44 px tall and draggable), at most 92 % of the visible height, the header without the top safe area (the sheet never reaches the top), the body's bottom padding at least the bottom safe area, side padding at least the side safe areas (landscape).
- Drag the grip down: the sheet follows the finger; released past a third of its height it closes as X does; less, it springs back.
- The on-screen keyboard: the sheet's bottom follows the visible viewport's bottom, its height cap follows the visible height, and the focused field is scrolled into view inside the body.
- No new texts: the grip is hidden from assistive technology; X ("Închide" / "Close") stays the named way to close.

## States
- Shown in the mock: open on a phone at 390 px, dark; the sign-in and review tasks as sheets.
- Not designed (build from the Build brief, flag in the PR): drag and spring back; the keyboard open; 320 px; landscape; the light theme; the discard question inside a sheet; stacked sheets; the loading skeleton in a sheet; reduced motion.

## Mock vs Build brief
- Breakpoint: mock 640 px → Build brief 768 px *(proposed)*, the phone rule ST-286 merged. The Build brief wins.
- Grip: mock 44 × 5 px → Build brief 36 × 4 px with a 44 px touch area *(proposed)*. The Build brief wins.
- Drag: not in the mock → Build brief scenario 4, past a third closes, less springs back *(proposed)*. Built.
- Built on: the Build brief says the Spartan sheet in the bottom position → the kit's Spartan sheet surface on the Angular CDK, as the constitution's given stack requires.
- Entry: the mock's `mf-ovsheet` (rise from 60 %) → ST-53's merged `mf-pop` (420 ms, from 94 %, anchored to the edge), as ST-157 kept for the dialog and drawer.
- Radius: mock 24 px → the theme's `--mf-radius-panel` (20 px), as ST-157's dialog and drawer.
- Backdrop: mock `rgba(5,6,8,.74)` → the theme's `--mf-mask`.
- Sign-in: the Build brief names it as the first task shown this way; the sign-in dialog is ST-82 (PR #45, open), which opens through `Overlays`, so it becomes a sheet on a phone with no change of its own. Here the catalogue's sample tasks show it.

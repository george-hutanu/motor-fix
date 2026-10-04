# Design: Build the shared dialog and right-hand drawer
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2

The story's Design boards roll up from EP-1; its Build brief names "the dialogs and drawers of Overlays.dc.html; Sign in · dialog; Write a review · drawer; Day sheet; Photo, video, live · drawer". Read with the Artifact tool: `project/Overlays.dc.html` (one component that renders every task, the shape picked from the task kind and the window size).

## Boards
- Overlays › shell: a full-window layer; a backdrop button `rgba(5,6,8,.74)` labelled "Închide" / "Close" that closes on click; one `role="dialog" aria-modal="true"` panel named by its title; a header (title in Michroma 14 px uppercase with 0.1em tracking, an optional 14 px subtitle in the muted text colour, a 44 × 44 px close button with a 1 px line border and 12 px radius, "Închide" / "Close"), a line under the header, and a body that scrolls on its own (`overflow-y: auto; overscroll-behavior: contain`, 20 px 22 px padding, the bottom safe area).
- Overlays › dialog (sign-in, quote, reply, reschedule, message, add a car, add a repair): centred, `min(480px, 100% − 32px)` wide, at most `100% − 48px` tall, radius 24 px, panel `#101215` with a `#2A2D31` border and a deep shadow.
- Overlays › drawer (review, verification file, photos and live): full height on the right, `min(520px, 100%)` wide, radius 24 px on the left corners only; the day sheet (worksheet) `min(660px, 100%)`.
- Overlays › phone (≤ 640 px in the mock): every task becomes a bottom sheet with a grip, at most 92% tall (another story, below).
- Behaviour in the mock's script: Escape closes the open task; the page behind is locked (`documentElement.style.overflow = hidden`); 380 ms after opening, the first field gets the focus with `preventScroll`, only when the window is wider than 640 px.

## What to build to match it
- One overlay service in `libs/overlays`: `open(task, { shape, title })` with shapes `dialog`, `drawer`, `drawer-wide`, on Spartan's dialog brain (Angular CDK underneath), themed by the Cockpit tokens already in `cockpit.css` (`--mf-mask` for the backdrop, `--mf-panel-raised`, `--mf-line`, `--mf-radius-panel`, `--mf-tap` 44 px).
- The panel reuses the kit's `.spartan-dialog-content` (centred dialog) and `.spartan-sheet-content[data-side="right"]` (drawer) surfaces, so ST-53's 420 ms `mf-pop` (from the anchored edge for the drawer) and the reduced-motion rule apply unchanged.
- Header: the title as an `h2` with the `mf-label` look, the close button with the kit's close cross, 44 px; the body scrolls on its own inside the panel.
- Texts in Romanian and English: "Închide" / "Close"; the discard question "Renunți la modificări?" / "Discard your changes?", "Renunță" / "Discard", "Continuă editarea" / "Keep editing".
- The catalogue (`/cockpit`) gets three buttons that open a sample task as a dialog, a drawer and a wide drawer.

## States
- Shown in the mock: open, closed; the dialog and drawer shapes; the phone bottom sheet.
- Not designed (build from the Build brief, flag in the PR): the discard question; stacked tasks; the loading skeleton while a task's code downloads; Back closing the task; the wide drawer's 720 px.

## Mock vs Build brief
- Drawer width: mock 520 px, day sheet 660 px → Build brief 480 px and 720 px *(proposed)*. The Build brief wins.
- Phone: the mock turns every task into a bottom sheet under 641 px → the Build brief moves the bottom sheet to its own story (under 768 px); here a dialog keeps a 16 px gutter on each side and a drawer fills the width on a phone.
- Built on: the Build brief says PrimeNG Dialog and Drawer → AGENTS.md and the constitution's given stack rule out PrimeNG (licence key since v22); Spartan UI and the Angular CDK replace it.
- Library: `libs/overlays`, as the Build brief and the Front end architecture page say; the kit's catalogue uses it.
- Pop: the mock's `mf-ovin`/`mf-ovright` 360 ms entries → ST-53's merged `mf-pop` 420 ms from 94%; not changed here.
- Backdrop: mock `rgba(5,6,8,.74)` → the theme's `--mf-mask` token, which ST-50 set from the same mock.

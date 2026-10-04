# Design: See screens build up with motion, or still with reduced motion
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d281e6a52dd360e3cf1cda

The story's Design boards roll up from EP-1 (Sign in · dialog, Home, Mobile · Sign-in sheet, the mobile boards, Dashboard · Driver, A · Cockpit); its Build brief names "all boards of mock v22", with the motion visible on Home (`Main.dc.html`), the dashboards and the dialogs. Read with the Artifact tool: `project/Main.dc.html`, `Mechanic.dc.html`, `Results.dc.html`, `Overlays.dc.html`, `DashGarage.dc.html`.

## Boards
- Desktop (Cockpit) › Home (`Main.dc.html`): sections enter with `mf-in 900ms cubic-bezier(.32,.72,0,1) backwards` (from opacity 0, `translateY(18px)`, `blur(10px)`); lamps breathe with `mf-led 2.4s ease-in-out infinite` (1 → .45 → 1) and `mf-lamp 1.6s` (.55 ↔ 1); the big needle enters with `mf-needle 1500ms` and swings with `transition: transform 1100ms cubic-bezier(.34,1.45,.64,1)`; the brand swap runs 520 ms (out of scope: Discovery).
- Desktop (Cockpit) › Garage profile (`Mechanic.dc.html`): the odometer cell holds a 0–9 column, `line-height: 1.4`, moved by `translateY(-digit × 1.4em)` with `transition: transform 900ms cubic-bezier(.32,.72,0,1)`; tiles pop with `mf-tile 800ms` from `scale(.94)`.
- Desktop (Cockpit) › Results (`Results.dc.html`): the small dial arcs transition `stroke-dasharray 1000ms cubic-bezier(.32,.72,0,1)`; a global reduced-motion block sets every animation and transition to 0.01 ms.
- Overlays (`Overlays.dc.html`): overlays enter with `mf-ovin 420ms cubic-bezier(.32,.72,0,1)` (opacity 0, `translateY(18px) scale(.985)`).
- Dashboards (`DashGarage.dc.html`): panels and bars staggered with `animation-delay` 0, 60, 120, 180, 240, 300, 420 ms.

## What to build to match it
- Tokens `--mf-motion-*` in `cockpit.css`: curve, rise 700 ms, stagger 60 ms, dial 1100 ms, pop 420 ms, roll 900 ms, pulse 1.6 s, blink 1 s; keyframes `mf-rise`, `mf-pop`, `mf-pulse`, `mf-blink` beside them.
- `mf-panel`: rise 14 px and fade, 60 ms per sibling, played once on insertion.
- `mf-rating-dial`: transitions on the arc's dash and the needle's rotation (1.1 s).
- `mf-lamp[pulse]`: the dot breathes 1 → .45 → 1 over 1.6 s; the label stays.
- `mf-odometer`: each digit cell shows a 0–9 column (a pseudo-element) moved by `--mf-digit × 1.4em`, 900 ms.
- `.spartan-dialog-content`, `.spartan-sheet-content`: pop from 94% and transparent, 420 ms.
- `.mf-blink`: once a second, for the live badge.
- One `@media (prefers-reduced-motion: reduce)` rule: no animation, no transition, anywhere.
- Catalogue: the existing change button also swaps the ratings 4.8 ↔ 4.2; a blinking sample label.

## States
- Shown in the mock: full motion on every board; a reduced-motion block in `Results.dc.html` (near-zero durations).
- Not designed (build from the Build brief, flag in the PR): reduced motion switched on mid-animation (jumps to the end); the blink rate of the live badge (*proposed* once a second); the odometer roll's duration (mock 900 ms, no Build brief value); light theme (motion is the same in both).

## Mock vs Build brief
- Rise: mock 900 ms, 18 px, blur 10 px → Build brief 700 ms, 14 px, no blur. The Build brief wins.
- Lamp: mock 2.4 s (`mf-led`) or 1.6 s at .55 (`mf-lamp`) → Build brief 1 → 0.45 → 1 every 1.2–1.8 s: 1.6 s with 0.45.
- Pop: mock `mf-pop` 460 ms from 60% with an overshoot curve, `mf-tile` from 94% → Build brief 94% and transparent, 420 ms, the shared curve.
- Needle: mock overshoot curve `(.34,1.45,.64,1)` and an entry swing from the low end → Build brief 1.1 s with the one shared curve, on value change only.
- Reduced motion: mock shortens everything to 0.01 ms → Build brief "nothing animates": animations and transitions are removed.
- The "no rating" needle at the low end is an open owner decision (ST-51 deferred); unchanged here.

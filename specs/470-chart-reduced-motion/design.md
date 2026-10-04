# Design check — 470-chart-reduced-motion

Checked: 2026-10-04 · Story: https://app.notion.com/p/3ef607bff0d281beb7fef25a5d0d7cb7 (ST-470, Task, role System)

- The task's Design and Design boards roll up from EP-1 (mock v22, https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr). The task has no Build brief of its own; its source is ST-53's deferral, so the boards that govern it are the ones ST-53 and ST-52 read: Dashboard · Driver (`DashClient.dc.html`, bars grow in over 900 ms) and the mock's global reduced-motion block (`Results.dc.html`), as recorded in `specs/052-chart-style/design.md` and `specs/053-motion/design.md`.
- Screens this work shows: the existing `mf-bar-chart` and `mf-line-chart` on `/cockpit`. No layout, colour, type or text changes.

## What to build to match it
- With reduced motion, a chart draws complete at once (052-FR-008, unchanged).
- Reduced motion switched on while a chart grows: the chart jumps to its end (ST-53 States: "reduced motion switched on mid-animation (jumps to the end)").
- Reduced motion switched off: animation is allowed again for what draws next; nothing already drawn replays.

## States
- Shown in the mock: full motion; a reduced-motion block that stills everything.
- Not designed: the switch while a chart is open (built from ST-53's design note above).

## Mock vs Build brief
- None new. The mock's 900 ms bar growth vs ST-52's 1000 ms stays as ST-52 decided.

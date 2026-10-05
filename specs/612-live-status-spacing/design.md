# Design: Give the live status line room under the header (ST-612)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (version 1791040637-c375) · Story: https://app.notion.com/p/3f0607bff0d28119a01dcc35cb598b6e

## Boards
- ST-612 is a tech-debt task from ST-256 (Issue type Task, Role System). It has no Build brief; its Design and Design boards roll up from EP-1 Foundations: Desktop (Cockpit) › Home ("the RO / EN switch in the header") and Dashboards (Cockpit) › Dashboard · Driver ("the bell in the header").
- Dashboards (Cockpit) › Dashboard · Driver (`project/DashClient.dc.html`): a sticky header (`padding: 10px clamp(16px, 3vw, 32px)`, 1 px bottom rule) holds the title and its subline on the left, and on the right the RO/EN group (two 44 px buttons in a 3 px padded, bordered pill) and the 44 px bell. The content below starts after `main`'s 24 px top padding: nothing in the mock touches the header's lower edge.
- The mock has no live status line and no offline bar. ST-256's `design.md` records the status line ("Actualizare de test în direct · 14:03") as built from the Build brief; ST-255 (#103) added the offline bar from its own brief.

## What to build to match it
- The status line keeps its text, size (`--mf-size-small`) and colour (`--mf-text-secondary`), and gets a top margin of `--mf-space-2` (8 px) so it no longer touches the RO/EN switch above it. No horizontal padding or margin: it stays aligned with the header's left edge, as today.
- Phones (320 and 390 px), tablet and desktop alike: the rule has no breakpoint.

## States
- Online, no e-mail banner: header → 8 px → status line → main.
- Offline (ST-255's bar shown): header → offline bar (its own `0 0 --mf-space-3` margin) → status line. The status line's 8 px adds to the bar's 12 px, so the line sits 20 px under the bar; the bar itself still sits flush under the header (out of this task's scope, see deferred.md).
- E-mail banner shown: the banner's 12 px bottom margin plus the line's 8 px.
- No test update yet: the line is empty; its 8 px margin still holds, so `main` starts 8 px lower than before.
- Not designed: the status line and the offline bar themselves (no board shows them).

## Mock vs Build brief
- None: there is no Build brief for this task, and the mock does not show the line. The story's own wording ("a top margin such as var(--mf-space-2) with no horizontal padding") is followed.

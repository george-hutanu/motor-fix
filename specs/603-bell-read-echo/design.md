# Design: Keep the bell's loaded rows when a read comes back live (ST-603)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (version 1791040637-c375) · Story: https://app.notion.com/p/3f0607bff0d281caa4cbc21046aba1d6

## Boards
- None for this task. ST-603 is a tech-debt task from ST-199 (Issue type Task, Role System); its Design and Design boards rollups are empty and it has no Build brief Screens section.
- The mock was opened: `Overlays` and `DashClient` hold no notification list, no "Mai multe" control and no read/unread rows. ST-199's `specs/199-notification-bell/design.md` already records the list as not designed (built from the Build brief).

## What to build to match it
- No screen changes. The list behind the bell (ST-199) keeps its rows, its "Mai multe" button and its unread marks; only which rows stay in it after a read changes: the rows already loaded no longer vanish.

## States
- Not applicable: no UI state is added or changed. The list's existing states (loading, error, empty, "Mai multe") are ST-199's.

## Mock vs Build brief
- None.

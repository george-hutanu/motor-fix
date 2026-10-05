# Design: Keep the bell's badge right after this tab's own read (ST-629)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (version 1791040637-c375) · Story: https://app.notion.com/p/3f0607bff0d281488223cdb8e14a4d23

## Boards
- None for this task. ST-629 is a tech-debt task from ST-603 (Issue type Tech debt, Role System); its Design and Design boards rollups are empty and it has no Build brief Screens section.
- The mock was opened: `DashClient` holds no bell, badge or notification count (searched for bell, notific, badge). ST-199's `specs/199-notification-bell/design.md` records the bell as built from the Build brief.

## What to build to match it
- No screen changes. The badge over the bell (ST-199) keeps its look and its "9+" cap; only the number it shows after a read changes: it is the server's unread count, not one fewer.

## States
- Not applicable: no UI state is added or changed.

## Mock vs Build brief
- None.

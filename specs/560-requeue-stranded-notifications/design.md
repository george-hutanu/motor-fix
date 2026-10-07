# Design: ST-560 Tech debt (ST-392): queued notification row with no job is never re-queued
Checked: 2026-10-07 · Mock: none · Story: https://app.notion.com/p/3f0607bff0d281c1b564c357379131d1

No screens: a worker-side sweep that re-queues stranded `queued` notification rows. The task is a tech-debt item with no Build brief Screens section; its Design and Design boards properties are rollups from its feature and no board covers this change. No screen shows its result beyond the message itself reaching the person (e-mail, push, SMS, WhatsApp), which existing screens already handle.

## Boards
- none

## What to build to match it
- No UI. Worker only.

## States
- Shown in the mock: none
- Not designed: none needed

## Mock vs Build brief
- Nothing to compare.

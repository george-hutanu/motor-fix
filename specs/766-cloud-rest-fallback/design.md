# Design: ST-766 Make the cloud session setup and lifecycle scripts work without GraphQL
Checked: 2026-10-06 · Mock: not opened (no screens) · Story: https://app.notion.com/p/3f1607bff0d281819edfcc527eee0d1d

## Boards
- None. A harness-only Task (role System, epic EP-1 Foundations): it changes
  `scripts/cloud-setup.sh` and the lifecycle scripts under `.claude/`. Its
  Build brief says "Screens: None".

## What to build to match it
- No screens: nothing in the web app, the API or the worker changes.

## States
- Shown in the mock: none.
- Not designed: none needed. The observable result is the scripts' own output.

## Mock vs Build brief
- No difference: neither names a screen for this task.

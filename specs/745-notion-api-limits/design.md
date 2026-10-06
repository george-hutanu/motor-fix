# Design: ST-745 Make the Notion client keep to Notion's API limits
Checked: 2026-10-06 · Mock: not opened (no screens) · Story: https://app.notion.com/p/3f1607bff0d2813ca3a7ded4339646b6

## Boards
- None. The story is a harness-only Task (role System, epic EP-1 Foundations):
  it changes `.claude/scripts/lib/notion.mjs` and two of its callers. Its
  `Design` and `Design boards` properties are rollups from the epic, not boards
  of its own, and its Build brief has no Screens section (context.md, Story).

## What to build to match it
- No screens: the Build brief's Screens section says none. Nothing in the web
  app, the API or the worker changes; no Cockpit component, text or phone
  behaviour is involved.

## States
- Shown in the mock: none.
- Not designed: none needed. The observable result is the harness's own
  output (`notion-sync` log lines and `NotionError` names), which no screen
  shows.

## Mock vs Build brief
- No difference: neither names a screen for this task.

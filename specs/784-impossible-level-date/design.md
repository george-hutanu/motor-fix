# Design check — 784-impossible-level-date

**Story**: [ST-784](https://app.notion.com/p/3f2607bff0d28171bff8cc31c7d100e8) — Tech debt (ST-775): a day the month does not have fits LEVEL_AT and Date.parse rolls it forward
**Checked**: 2026-10-07 (story page last edited 2026-10-07T06:30Z)
**Epic**: Foundations (EP-1)

## Screens

No screens: the task is harness-only (`.claude/scripts/lib/feature.mjs`,
`.specify/scripts/python/common.py` and their specs). The story has no Build
brief, its `Design` and `Design boards` properties are rollups from the epic and name no board for this task, and nothing in
the web app shows its result.

## States

- None in the product. The only observable state is the harness's answer to
  "is a level waiting for the next feature", read by `level.mjs` and the
  Python spec-kit helpers.

## Not designed

- Nothing: no screen is built from this task.

## Mock vs Build brief

- No mock and no Build brief for this task; nothing to compare.

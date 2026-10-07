# Design check — 775-level-at-parity

**Story**: [ST-775](https://app.notion.com/p/3f1607bff0d281fb915bc842545c4624) — Tech debt (ST-677): hour 24 fits LEVEL_AT but Python's fromisoformat refuses it while Date.parse accepts it
**Checked**: 2026-10-07 (story page last edited 2026-10-07T06:08Z)
**Epic**: Foundations (EP-1)

## Screens

No screens: the task is harness-only (`.claude/scripts/lib/feature.mjs`,
`.specify/scripts/python/common.py` and their specs). The story has no Build
brief, its `Design` and `Design boards` properties are empty, and nothing in
the web app shows its result.

## States

- None in the product. The only observable state is the harness's answer to
  "is a level waiting for the next feature", read by `level.mjs` and the
  Python spec-kit helpers.

## Not designed

- Nothing: no screen is built from this task.

## Mock vs Build brief

- No mock and no Build brief for this task; nothing to compare.

# Deferred: 677-zoneless-level-at

- [ ] `.claude/scripts/lib/feature.mjs:146` — **medium** — hour 24 fits `LEVEL_AT` but Python's `fromisoformat` refuses it while `Date.parse` accepts it, so the two readers disagree on `T24:00:00Z`; limit the hour to `([01]\d|2[0-3])` in both regexes (also `.specify/scripts/python/common.py` `_LEVEL_AT`). Nothing writes hour 24 today. (pr-tester) — Notion: https://app.notion.com/p/Tech-debt-ST-677-hour-24-fits-LEVEL_AT-but-Python-s-fromisoformat-refuses-it-while-Date-parse-acc-3f1607bff0d281fb915bc842545c4624

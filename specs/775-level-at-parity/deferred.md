# Deferred: 775-level-at-parity

- [ ] `.claude/scripts/lib/feature.mjs:157` — **medium** — a day the month does not have fits `LEVEL_AT` and `Date.parse` rolls it forward (`2026-02-30T00:00Z` reads as 2 March), while Python's `fromisoformat` refuses it, so the two readers disagree; refuse it in `pendingLevel` by checking the parsed UTC date against the written fields (offset applied) or the written year/month/day against the calendar. Nothing writes such a stamp today. Out of ST-775's scope (its Notion task names only the hour). (speckit-clarify, 2026-10-07)

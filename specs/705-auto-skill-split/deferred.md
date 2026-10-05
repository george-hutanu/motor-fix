# Deferred — 705-auto-skill-split

- `.claude/scripts/watch.mjs` `waitLoop`: a stale wait record can race a fresh `--wait` (from #143's review). — Notion: https://app.notion.com/p/3f0607bff0d281baaab7d5d3abc36e0c
- `.claude/scripts/lifecycle.mjs:253`: after a `--notion-done` rerun, the "Deferred" line written to `handoff.md` is backwards (from #141's review). — Notion: https://app.notion.com/p/3f0607bff0d281aeb6a4fcd817156dac

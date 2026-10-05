# Deferred — 703-idle-watch-gate

- `.claude/skills/speckit-auto/SKILL.md` "Parallel runs" still tells the orchestrating session to schedule `/speckit-watch` with `CronList` and the `4,19,34,49 * * * *` cron; it should point at the background `watch.mjs --wait` in speckit-watch "Keeping it scheduled". Off limits to ST-703 (source: task brief). — Notion: https://app.notion.com/p/3f0607bff0d281958e9fd07e210e13e7

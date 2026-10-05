# Deferred — 254-live-audience

- [ ] `libs/domain/src/events/live.hub.ts:131` — **low** — garage-access cache never sweeps expired entries: one stays until that garage is read again or reread on an event, so the map grows with the number of distinct garages whose staff ever connected to one API copy; delete an entry found expired, or sweep on a timer, once garage counts are known (code-reviewer, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281faa095eb3e4b2c1028

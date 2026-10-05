# Deferred findings: 614-visitor-lang-reload

- [ ] `apps/web/src/app/addresses.ts:82` — **low** — durability: `toLanguageAddress` moves a first visit off `/` only after `ApplicationRef.whenStable()`, with no time limit; if Home ever keeps a task pending (polling, a long-lived timer), the first visit would stay on `/`; bound the wait (race it with a timeout) or move on first navigation end (pr-tester lap 2, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281bfbd6df879bb27f98e

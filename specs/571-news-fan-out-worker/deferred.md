# Deferred findings: 571-news-fan-out-worker

- [ ] `libs/domain/src/notifications/news.fan-out.ts:21` — **low** — config: the news and reminder queues hard-code their retry policy (`attempts: 6`, exponential backoff from 1 minute, as in `libs/domain/src/cars/reminders.module.ts`); give both one named env setting when either needs tuning in production (code-reviewer, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281598676e531d5cbd127

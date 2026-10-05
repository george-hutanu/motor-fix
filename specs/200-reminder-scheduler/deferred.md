# Deferred — 200-reminder-scheduler

Verified review findings that are real but not this change.

- [ ] `apps/web-e2e` — **low** — The Build brief's Playwright check (shortened dates, the driver's bell shows the 30-day and then the 7-day DUE_ITP) waits for a bell screen: the web app has none yet and the end-to-end job starts no worker. Proved here by the real worker in an integration test; add the Playwright test with the story that builds the bell. (spec-reviewer, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281378e41c5c5dfca066a
- [ ] `libs/domain/src/cars/reminders.module.ts:66` — **low** — A day's job left delayed through a stop longer than a day runs for that past day when the worker comes back, next to the start-up catch-up; the only visible effect is a booking reminder for the day after that past day being sent on the booking day itself. Due-date and tyre stages cannot double-send. Skip a daily job whose day is before today, or count the booking's day from the run's real date. (spec-reviewer, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281f68c10dcb3444de9f0

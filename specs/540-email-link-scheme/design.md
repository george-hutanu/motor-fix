# Design check — 540-email-link-scheme

Story: ST-540 https://app.notion.com/p/3ef607bff0d281199d95ca3170698652 (Task, Role System, Low; tech debt from ST-195, PR #67). Checked 2026-10-06.

No screens: the task is a server-side check in the notifications library (`libs/domain/src/notifications/email-layout.ts`, `templates.ts`) that refuses an e-mail whose button or stop link carries an unsafe scheme. The story has no Build brief Screens section and no board of its own; an accepted e-mail's HTML is unchanged, a refused one is never sent, and nothing in `apps/web` or `libs/ui-cockpit` changes.

# Deferred — 257-live-events

- [ ] `libs/domain/src/events/outbox-relay.module.ts:38` — **low** — resources: the worker holds two Prisma pools and two Redis clients (the relay's beside the notifications module's own); one shared provider for the worker's Prisma and Redis (code-reviewer, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281a79071ebe63bd8779e
- [ ] `libs/domain/src/auth/email-confirmation.service.ts:252` — **low** — events: a confirmed e-mail is a stored change whose `account.email_confirmed` is published straight to Redis, outside the change's transaction; record it through the outbox and add the kind to the catalogue (author, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281c1a09ec67b308f6b4a

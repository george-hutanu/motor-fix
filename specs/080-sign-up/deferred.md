# Deferred — 080-sign-up

Findings that are real but not this change. Each becomes a Notion To-do task (`speckit-notion-sync debt`).

- [ ] `apps/api/src/bootstrap.ts:22` — **medium** — pre-existing: sign-up is the first endpoint whose only limit is per address, so if `req.ip` behind Railway is the edge rather than the visitor, the whole site gets 10 sign-ups an hour. Same check as ST-82's open task (proxy trust on staging); verify a sign-up's Redis key there too. Raised by code-reviewer (MEDIUM, defer), 2026-10-04. — Notion: https://app.notion.com/p/3ef607bff0d281f2ac88f8453c97d361
- [ ] `libs/domain/src/auth/attempts.ts:37` — **low** — pre-existing: the counter keys are a plain SHA-256 of the e-mail or address; an IPv4 address (2^32) is reversible from its key in seconds. An HMAC under the server's token secret would keep the keys unreadable; it changes all three key kinds, sign-in's too. Raised by code-reviewer (LOW, defer), 2026-10-04. — Notion: https://app.notion.com/p/3ef607bff0d281c89193fe63b28bddf4

# Deferred findings: 539-public-web-url-boot

- [ ] `libs/domain/src/notifications/email-config.ts:33` — **medium** — duplication: two parsers of PUBLIC_WEB_URL, `publicWebUrl()` in `libs/contracts/src/env.ts` throws on a malformed value while email-config's `webUrl()` silently returns undefined; have `webUrl()` use `publicWebUrl()` and decide whether a malformed value should stop the worker's config load (code-reviewer, 2026-10-07) — Notion: https://app.notion.com/p/Tech-debt-ST-539-duplication-two-parsers-of-PUBLIC_WEB_URL-publicWebUrl-in-libs-contracts-src-3f1607bff0d2817781dae9576b51b8bd

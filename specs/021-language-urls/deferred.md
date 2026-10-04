# Deferred — 021-language-urls

- [ ] `apps/web/src/server.ts:26` — **low** — pre-existing: `new URL(PUBLIC_WEB_URL)` at import throws an unnamed TypeError on a malformed value; `readEnv` only checks presence (code-reviewer, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d2811fb566df383fbdc442

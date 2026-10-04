# Deferred — 021-language-urls

- [ ] `apps/web/src/server.ts:26` — **low** — pre-existing: `new URL(PUBLIC_WEB_URL)` at import throws an unnamed TypeError on a malformed value; `readEnv` only checks presence (code-reviewer, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d2811fb566df383fbdc442
- [ ] `apps/web/src/app/not-found/not-found.ts` — **low** — choosing EN in another tab turns an open `/de/` page English: the not-found page resets the language once in `afterNextRender`, then the storage listener in `LanguageChoice.restore()` (`libs/i18n/src/switch.ts`) applies the new value (pr-tester lap 2 #10, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d2817e862ddc79aefe72f8

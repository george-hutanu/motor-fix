# Deferred — 082-sign-in

Findings that are real but not this change. Each becomes a Notion To-do task (`speckit-notion-sync debt`).

- [ ] `apps/api/src/bootstrap.ts` — **medium** — Verify on staging that the API's `req.ip` is the visitor's address behind Railway's proxy and the web edge (the per-address sign-in limit depends on it); if Railway's hop is not private or does not append the client, switch `trust proxy` to a hop count. Raised by code-reviewer and spec-reviewer (MEDIUM, decision), `apps/api/src/bootstrap.ts`, `apps/web/src/server/edge.ts`.
- [ ] `libs/i18n/src/public/ro.json` — **low** — Pick one offline sentence for every form: ST-82's Build brief proposes "Nu ești conectat la internet.", ST-159 "Nu ești conectat. Încearcă din nou când revine conexiunea."; the dialog uses ST-159's until the shared errors land. Raised by spec-reviewer (LOW, decision), `libs/i18n/src/public/ro.json`.

**Agent review: failure** — PR #57 at `92f327b`, lap 1

Blocking: 1 (blocker 0, high 1) · medium 12 · low 4. Booted: postgres, redis, api, web, worker.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- Called changed endpoints: /api/v1/live.
- QA removed flow findings that its own flows got wrong, after re-checking them on a third boot (pr-57-lap1-focus, --no-tests): 11 findings. The 6 "small-phone flow failed" findings were the EN click blocked by the toast while the pointer rested on it (reported once below as the 320 px overlap); "reconnects after bye expired + renewal fails" was the service worker serving /auth/refresh outside page.route; with service workers blocked the refused renewal opens no second stream, and the control reconnects once. The four "invalid body answers 400" findings are merged into one agent finding.
- Runs: pr-57-lap1-first (first boot, flows fixed afterwards), pr-57-lap1 (this report: sweep, flows, affected tests 9/9, e2e 193/193), pr-57-lap1-focus (focused re-check).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | FR-012: a signed-in non-admin gets 400 validation_failed, not 404, from POST /api/v1/admin/live/test when the body is invalid |  | libs/domain/src/events/live.controller.ts: `async test(@CurrentActor() actor: Actor, @Body() body: LiveTestDto) { if (actor.role !== 'admin') throw new NotFoundException();` runs after the global ValidationPipe. The admin check belongs in the guard, before the pipes: `@Requires(<admin capability>)` through ActorGuard/requireCapability, which answers 404 (Principle V: the role-to-right rule already lives in capabilities.ts). Add a test: a non-admin with an invalid body gets 404. |
| 2 | medium | api readiness: storage down |  |  |
| 3 | medium | worker readiness: storage down |  |  |
| 4 | medium | HTTP 401: http://127.0.0.1:59635/api/v1/auth/refresh | /app/driver · desktop · light · ro (+31 more) | shots/app-driver-desktop-light-ro.png |
| 5 | medium | Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized) (signed-out visit to /app/*: the existing session check asks /auth/refresh and gets 401 before redirecting to sign-in; same code on main, not touched by this PR; downgraded from high by QA) | /app/driver · desktop · light · ro (+31 more) | shots/app-driver-desktop-light-ro.png |
| 6 | medium | HTTP 401: http://127.0.0.1:59635/api/v1/auth/refresh | /app/garage · desktop · light · ro (+31 more) | shots/app-garage-desktop-light-ro.png |
| 7 | medium | Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized) (signed-out visit to /app/*: the existing session check asks /auth/refresh and gets 401 before redirecting to sign-in; same code on main, not touched by this PR; downgraded from high by QA) | /app/garage · desktop · light · ro (+31 more) | shots/app-garage-desktop-light-ro.png |
| 8 | medium | HTTP 401: http://127.0.0.1:59635/api/v1/auth/refresh | /app/admin · desktop · light · ro (+31 more) | shots/app-admin-desktop-light-ro.png |
| 9 | medium | Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized) (signed-out visit to /app/*: the existing session check asks /auth/refresh and gets 401 before redirecting to sign-in; same code on main, not touched by this PR; downgraded from high by QA) | /app/admin · desktop · light · ro (+31 more) | shots/app-admin-desktop-light-ro.png |
| 10 | medium | axe aria-allowed-role (minor) in the dashboard toast: ARIA role should be appropriate for the element |  | 42 combinations; driver desktop light ro: li /private/tmp/claude-502/-Users-georgehutanu-motor-fix/a8e23c2e-d52b-4bd0-a9a2-3f54c55b9f24/scratchpad/pr-57-lap1/shots/dash-driver-desktop-light-ro.png; the same violation shows on /cockpit with the kit sample toast (run pr-57-lap1-focus, shots/cockpit-toast-desktop.png): the kit sonner markup, first shown on product screens by this PR |
| 11 | medium | axe list (serious) in the dashboard toast: <ul> and <ol> must only directly contain <li>, <script> or <template> elements |  | 42 combinations; driver desktop light ro: ol /private/tmp/claude-502/-Users-georgehutanu-motor-fix/a8e23c2e-d52b-4bd0-a9a2-3f54c55b9f24/scratchpad/pr-57-lap1/shots/dash-driver-desktop-light-ro.png; the same violation shows on /cockpit with the kit sample toast (run pr-57-lap1-focus, shots/cockpit-toast-desktop.png): the kit sonner markup, first shown on product screens by this PR |
| 12 | medium | The toast covers the language switch on a 320 px screen while it shows |  | 6 combinations; driver small-phone light ro: /private/tmp/claude-502/-Users-georgehutanu-motor-fix/a8e23c2e-d52b-4bd0-a9a2-3f54c55b9f24/scratchpad/pr-57-lap1/shots/covered-driver-small-phone-light-ro-language-switch.png |
| 13 | medium | On a 320 px phone the live toast covers the language switch while it shows |  | shots/covered-driver-small-phone-light-ro-language-switch.png (6 combinations at 320 px; none at 390, tablet or desktop). design.md leaves the toast's place to sonner's defaults; on phones a top position or an offset above the content would keep the controls free. |
| 14 | low | Deferred debt is not filed in Notion before the merge |  | deferred.md: `- [ ] LOW live integration specs leave a handle open in worker mode ...` has no task URL, and notion-sync.md has no `debt` line. AGENTS.md: debt is filed as a To do task (`speckit-notion-sync debt`) before the merge. |
| 15 | low | EventsModule exports LiveHub, which no module imports (Principle I) |  | `exports: [LiveHub],` but only AppModule registers EventsModule and nothing outside it injects LiveHub. Drop the export until an outbox or another module publishes (ST-257). |
| 16 | low | The live controller verifies the access token a second time to read its expiry |  | `const token = req.header('authorization')?.slice('Bearer '.length) ?? ''; const expiresAt = verifyAccessToken(token, this.auth.tokenSecret)?.expiresAt ?? Date.now();` repeats ActorGuard's parsing (with a looser prefix match) and adds an AUTH_OPTIONS dependency; the guard already has the claims and could put expiresAt on the request. |
| 17 | low | OpenAPI documents only 200 and 202 for the new endpoints |  | 401, 403, 404, 400 and 503 live_unavailable (FR-002, FR-012) are not described, so the generated client knows nothing of them. The repo documents almost no error answers, so this is low. |

### Reproduction
1. sign in as sofer@example.test (also service@, receptie@, mecanic@) → POST /api/v1/admin/live/test with body {} → answer: 400 {"code":"validation_failed","detail":"accountId must be a UUID"}; FR-012 and scenario 2.3 promise 404, so the admin endpoint and its body shape are visible to everyone
2. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
3. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
4. Open /app/driver at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: HTTP 401: http://127.0.0.1:59635/api/v1/auth/refresh.
5. Open /app/driver at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized).
6. Open /app/garage at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: HTTP 401: http://127.0.0.1:59635/api/v1/auth/refresh.
7. Open /app/garage at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized).
8. Open /app/admin at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: HTTP 401: http://127.0.0.1:59635/api/v1/auth/refresh.
9. Open /app/admin at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized).
10. open any dashboard → POST a test update → run axe on [data-sonner-toaster]
11. open any dashboard → POST a test update → run axe on [data-sonner-toaster]
12. open a dashboard → POST a test update → look at the language switch at the viewport
13. 320×568, any dashboard, RO or EN, light or dark → an admin sends the test update → the toast sits over RO/EN (and the sign-out button, depending on scroll); with the pointer resting where the toast appears (the sheet's sign-in button is there), sonner pauses and the toast stayed over 20 s; with the pointer elsewhere it leaves after 4.3 s
14. read specs/253-live-connection/deferred.md and notion-sync.md
15. read libs/domain/src/events/events.module.ts
16. read libs/domain/src/events/live.controller.ts
17. read apps/api/openapi.json /api/v1/live and /api/v1/admin/live/test

Screenshots: 80, one per route × viewport × scheme × language.

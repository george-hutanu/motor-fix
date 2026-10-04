**Agent review: success** — PR #45 at `a0315e6`, lap 2

Blocking: 0 (blocker 0, high 0) · medium 5 · low 1. Booted: postgres, redis, api, web, worker.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium | worker readiness: storage down |  |  |
| 3 | medium | HTTP 401: http://127.0.0.1:58108/api/v1/auth/refresh | /ro/account · desktop · light · ro (+15 more) | shots/ro-account-desktop-light-ro.png |
| 4 | medium | Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized) (spec-mandated renewal, FR-019: a signed-out visit to /ro/account asks /auth/refresh with a cookie the page cannot read; downgraded from high by QA) | /ro/account · desktop · light · ro (+15 more) | shots/ro-account-desktop-light-ro.png |
| 5 | medium | Offline message not shown in the production build (FR-016, scenario 2.7): the Angular service worker answers 504, so the dialog says "Ceva nu a mers la noi" |  | libs/overlays/src/form.ts toProblem() maps only status 0 to offline/network; ngsw-worker.js turns the failed fetch into 504 Gateway Timeout. The unit test 'keeps everything typed when the device is offline' stubs problem(0), so it cannot see this. Typed text is kept. Fix: treat navigator.onLine === false as offline whatever the status, or send /api/ past the service worker (ngsw-bypass). |
| 6 | low | QA coverage note, lap 2 |  | Passed: sign-in for 6 roles (desktop, 390, 320 px), same message for wrong password and unknown e-mail with e-mail kept and password cleared, suspended message, empty and invalid form (nothing sent, focus on first wrong field, aria-describedby), sign-out then reload and typed /app/* land on Home with the dialog, reload and a second tab keep the session, /ro/account signed in redirects and signed out shows the placeholder with the dialog from Cont, RO and EN, 4 viewports x light/dark x ro/en with axe and no overflow, Tab order, Escape (a changed form asks first, by design of the shared overlay) and focus return, busy button with a single POST, API contract (200, cookie flags, 401, 403, 415, 400, refresh with and without cookie, 20 s grace, family revocation, sign-out 204). Affected unit tests and 169 e2e tests passed. Storage readiness is down only for lack of Docker. |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
3. Open /ro/account at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: HTTP 401: http://127.0.0.1:58108/api/v1/auth/refresh.
4. Open /ro/account at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized).
5. Production build, open /ro, press Autentificare, fill e-mail and password → Go offline (navigator.onLine === false), press Intră în cont → Observe a 504 from the service worker for POST /api/v1/auth/sign-in and the generic internal_error text instead of "Nu ești conectat. Încearcă din nou când revine conexiunea."
6. see evidence

Screenshots: 64, one per route × viewport × scheme × language.

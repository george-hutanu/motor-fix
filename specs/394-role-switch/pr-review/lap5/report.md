**Agent review: success** — PR #70 at `e3905f2`, lap 5

Blocking: 0 (blocker 0, high 0) · medium 2 · low 3. Booted: postgres, redis, api, web, worker.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.
- Withdrawn by the reviewer: "Switch with a bad body (no body) does not answer 400" was a fault in the flow, which sent no Content-Type; FR-009 says a request that is not JSON answers 415, and it does. The 400 cases with a JSON body ({}, {role:pilot}, {role:7}, malformed JSON) all answered 400.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium | worker readiness: storage down |  |  |
| 3 | low | A switch refused with 401/403 (signed out here or everywhere, suspended) shows "Try again" and keeps the dashboard, though the cookie is already cleared |  | `} catch { toast(this.i18n.t('shell.frame.roles.failed')); }`. The auth interceptor skips /api/v1/auth/*, so nothing reacts to the 401. The tab is signed out at its next renewal (at most 15 min, ST-128 SC-003 holds), so this is UX only. Telling a 401/403 apart and calling the sign-out path would close it. FR-007 as written ("an error answer" toasts) allows the current behaviour. |
| 4 | low | OpenAPI for POST /auth/roles/switch lists only 200, 401 and 404; FR-009's 415, the 403 for a suspended account and FR-002's 400 are not documented |  | Live: text/plain and urlencoded bodies answer 415, a body-less request answers 415, the spec edge case says suspended answers 403. `@ApiOkResponse`, `@ApiNotFoundResponse`, `@ApiUnauthorizedResponse` only. |
| 5 | low | plan.md still gives the old signature switchRole(actor, role) |  | `libs/domain/src/auth/sign-in.service.ts        switchRole(actor, role); refresh(token, role?)`. The method is now `switchRole(token, role)`, which renews the cookie's session. |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
3. Tab on /app/garage misses the session.revoked live message → Another device signs out everywhere → Tap Șofer: POST /auth/roles/switch answers 401 and clears mf_refresh → The tab shows "Nu am putut schimba rolul. Încearcă din nou." and stays on the dashboard; every retry fails the same way
4. Read apps/api/openapi.json at /api/v1/auth/roles/switch: responses 200, 401, 404
5. Read the Project Structure block of plan.md

Screenshots: 32, one per route × viewport × scheme × language.

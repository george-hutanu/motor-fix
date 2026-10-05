**Agent review: failure** — PR #70 at `e4c678c`, lap 4

Blocking: 1 (blocker 0, high 1) · medium 3 · low 1. Booted: postgres, redis, api, web, worker.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | POST /me/roles/switch mints a fresh 15-minute access token from an access token alone, so a session survives sign-out everywhere (and sign-out) indefinitely |  | switch chain garage:200, driver:200, garage:200; GET /me 200; same-role 200; exp 1791158247 → 1791158247. libs/domain/src/auth/sign-in.service.ts switchRole() returns this.accessToken(actor.accountId, role) without checking that the account still has a refresh family; ST-128 SC-003 promises a device that missed the live message is signed out within 15 minutes. |
| 2 | medium | api readiness: storage down |  |  |
| 3 | medium | worker readiness: storage down |  |  |
| 4 | medium | No test covers a role switch after sign-out or sign-out everywhere (the ST-128 merge added none) |  | The merge e9c11e2 brought in sign-out-everywhere (deletes every refresh token) but `switchRole(actor, role)` only checks `actor.roles.includes(role)` before `return this.accessToken(actor.accountId, role);`. A test-first fix should start with: sign in, sign out everywhere, switch with the old access token, expect 401. |
| 5 | low | A renewal refused after sign-out everywhere is swallowed when a switch replaced the token meanwhile |  | `() => { if (generation !== this.generation) return false; if (replaced()) return true; this.forget(); ... }`: the tab keeps the switch's token and stays signed in. With the high finding above, the switch token can be extended again, so the tab is not bounded by the 15 minutes of ST-128 SC-003. Telling a 401 from a network error here would close it. |

### Reproduction
1. device 1 and device 2 sign in as comutare@example.test → device 1: POST /me/roles/switch {role:driver} → device 2: POST /auth/sign-out-everywhere → device 1: POST /me/roles/switch {role:garage} with its access token → 200 + new token → repeat with the new token (driver, garage) → 200 each → GET /me with the last token → 200 → same-role switch → also 200 (any account, even one role)
2. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
3. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
4. Read the 'switching my role' describe block: 401 without an account, suspended refused, no audit entry → No case signs out (or out everywhere) and then calls POST /me/roles/switch with the access token still held
5. A renewal is on its way → a role switch answers first (token replaced) → the renewal answers 401 sign_in_required because the account was signed out everywhere

Screenshots: 32, one per route × viewport × scheme × language.

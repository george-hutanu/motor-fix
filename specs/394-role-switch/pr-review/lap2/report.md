**Agent review: success** — PR #70 at `36c9e90`, lap 2

Blocking: 0 (blocker 0, high 0) · medium 2 · low 6. Booted: postgres, redis, api, web, worker.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium | worker readiness: storage down |  |  |
| 3 | low | A renewal that starts between the switch's answer and its GET /me can put the old role's token back (apps/web/src/app/dashboard/session.ts:66) |  | Code reading; the window is narrow (the old token must expire during the switch). The T011 guard only covers a renewal that started before the switch. A fix: renew() could read the role the token was issued for, or switchRole could set the account and token together. |
| 4 | low | openapi.json marks the refresh body as required, but FR-004 says a refresh MAY carry { role } (apps/api/openapi.json:122-123) |  | A client generated from the contract must send a body; the web app sends {} (session.ts `{ body: role ? { role } : {} }`). |
| 5 | low | The FR-002 400 test does not check the validation_failed code (libs/domain/src/auth/role-switch.api.integration.spec.ts:150) |  | Live, the booted API answers {"code":"validation_failed"} for {}, {role:"pilot"} and {role:7}, so the behaviour is right; the test would not catch a change of code. |
| 6 | low | No test that a switch sends no notification (FR-003) |  | SignInService.switchRole (sign-in.service.ts) emits nothing today, so this is a missing guard, not a defect. |
| 7 | low | FR-008 (a second tab keeps its role across a renewal) not exercised in the browser |  | The request body of a renewal is covered by session.role-switch.spec.ts 'Session, renewing the token' and the server side by role-switch.api.integration.spec.ts 'renewing a tab that shows one role'; live POST /api/v1/auth/refresh {role:garage} with last_role driver answered a garage token and left last_role as driver. |
| 8 | low | In dark mode the unpressed chip's border is faint against the background |  | shots/flow-6-frame-tablet-dark-ro.png, shots/flow-6-frame-small-phone-dark-en.png. The label text is readable and axe reports nothing; this is about the control's outline (WCAG 1.4.11, non-text contrast), not measured here. |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
3. switchRole sets this.accessToken to the new role's token (session.ts:127) and awaits GET /me → meanwhile another call made with the old, expired token gets a 401 and calls renew() → renew() reads `const role = this.current()?.role;` (session.ts:66): still the old role, and `sent` is already the new token → the refresh answers a token for the old role; replaced() is false, so it overwrites the switch's token → GET /me then sets current() to the new role (session.ts:131): the tab shows the new role and calls the API with the old one
4. libs/domain/src/auth/auth.controller.ts:131 `@Body() body: RefreshDto` with no @ApiBody({ required: false }) → apps/api/openapi.json /api/v1/auth/refresh: "requestBody": { "required": true, ... } → live: POST /api/v1/auth/refresh with no body answers 200, so the contract is stricter than the endpoint
5. FR-002: 'a body without a valid role MUST answer 400 validation_failed' → spec line 150 asserts only `expect(res.status).toBe(400);` and that last_role is unchanged
6. FR-003: 'A switch MUST write no audit entry and send no notification' → role-switch.api.integration.spec.ts has 'writes no audit entry' only; tasks.md maps FR-003 to that test alone
7. two tabs on /app/garage; tab A taps Șofer; tab B stays on the garage dashboard with Service pressed (checked, passes) → forcing a 401 in tab B needs an API call, and the empty garage dashboard and its menu entries make none, so no renewal could be triggered → tab B after a reload opens /app/driver, the role used last (checked, passes)
8. tablet 834 px, dark, ro, signed in as comutare@example.test on /app/garage → the unpressed 'Șofer' chip uses border var(--mf-line-strong) on the near-black surface (frame.ts .roles button)

Screenshots: 32, one per route × viewport × scheme × language.

# Tasks: Switch between my driver and garage roles in one account

**Input**: spec.md, plan.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Foundational

- [X] T001 `libs/contracts/src/auth.dto.ts`: `SwitchRoleDto { role }` (one of the five roles) and `RefreshDto { role? }`; exported from the index (FR-001, FR-002, FR-004)

## Phase 2: User Story 1 — switch role, API (P1)

Independent test: through HTTP against PostgreSQL and Redis, a two-role account switches; `last_role` changes; the token carries the new role; a role not held answers 404.

- [X] T002 [US1] `libs/domain/src/auth/sign-in.service.ts`: `switchRole(actor, role)` — 404 unless `actor.roles` holds it; update `last_role`; return a token for it; no audit (FR-001, FR-002, FR-003)
- [X] T003 [US1] `libs/domain/src/auth/me.controller.ts`: `POST me/roles/switch`, 200 `SessionDto` (FR-001, FR-002)
- [X] T004 [US2] `libs/domain/src/auth/sign-in.service.ts` + `auth.controller.ts`: refresh takes `RefreshDto`; the token is for the asked role when held, else as today; `last_role` unchanged (FR-004)
- [X] T005 Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-001, FR-004)

## Phase 3: User Story 1 — switch role, web (P1)

- [X] T006 [US1] `apps/web/src/app/dashboard/session.ts`: `switchRole(role)` — call the API, keep the new token, reload the account; a failure leaves token and account as they were and rejects (FR-006, FR-007)
- [X] T007 [US2] `apps/web/src/app/dashboard/session.ts`: `renew()` sends the role of the account on screen (FR-008)
- [X] T008 [US1] `apps/web/src/app/dashboard/frame.ts` + `libs/i18n/src/shell/ro.json` + `libs/i18n/src/shell/en.json`: the chips group in the account block for two or more roles, the role in use pressed; a tap of another chip closes live, switches, reopens live; the frame's effect opens the new landing; a failure toasts and keeps the role; taps ignored while one is on its way (FR-005, FR-006, FR-007)

## Phase 4: Polish

- [X] T009 `libs/domain/src/seed.ts`: garage "Atelier Dinamo" and `comutare@example.test` (driver + garage owner, last role garage); `seed.integration.spec.ts` updated
- [X] T010 `apps/web-e2e/src/role-switch.spec.ts` (new): the seeded switch account signs in on the garage dashboard, taps "Șofer", lands on `/app/driver`, signs out, signs in, lands on `/app/driver`, switches back to "Service" (SC-001, SC-002)

## Phase 5: Review fixes

- [X] T011 `apps/web/src/app/dashboard/session.ts`: a renewal sent before a role switch that answers after it leaves the switch's token in place (FR-006, FR-008; code-reviewer HIGH)
- [X] T012 `libs/contracts/src/auth.dto.ts` reuses the role list of `me.dto.ts`; no task key in `audit-coverage.spec.ts`; `refresh()` takes its role without a default; the 400 test title says what it asserts (code-reviewer MEDIUM ×2, LOW; spec-reviewer MEDIUM, LOW); a renewal that fails after a switch keeps the tab signed in, now tested (code-reviewer re-review HIGH)

## Phase 6: QA fixes (pr-tester lap 2)

- [X] T013 `apps/web/src/app/dashboard/session.ts`: a renewal that starts while the switched account is still loading asks for the new role (FR-008; pr-tester low #3)
- [X] T014 `libs/domain/src/auth/auth.controller.ts`: the refresh body is optional in the OpenAPI document; `apps/api/openapi.json` and `libs/data-access` regenerated (FR-004; pr-tester low #4)

## Phase 7: QA fixes (pr-tester lap 4)

- [X] T015 `libs/domain/src/auth/sign-in.service.ts`, `auth.controller.ts`: the switch moves to `POST auth/roles/switch` and renews the refresh cookie's session, so a session signed out here or everywhere cannot switch; `me.controller.ts` loses the route; `apps/web/src/app/dashboard/session.ts` calls the new route; client regenerated (FR-001, FR-009; pr-tester high #1, medium #2)

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006, T007 → T008 → T009 → T010.

## FR → test (filled by `/speckit-tests`)

| FR | Test |
| --- | --- |
| FR-001 | `libs/domain/src/auth/role-switch.api.integration.spec.ts` "stores the role switched to and answers a token for it", "opens the role switched to with the new token", "switches back", "works for a mechanic who also drives"; e2e `role-switch.spec.ts` |
| FR-002 | same file: "answers 404 for %s, a role the account does not hold…", "answers 400 validation_failed for %s", "answers 401 without a signed-in account", "refuses a suspended account" |
| FR-003 | same file: "writes no audit entry" |
| FR-004 | same file, "renewing a tab that shows one role" block |
| FR-005 | `apps/web/src/app/dashboard/frame.role-switch.spec.ts` "shows a chip per role…", "names a mechanic who also drives…", "labels every role in the fixed order", "shows no chips to an account that is only a %s", "names them in English"; e2e "an account with one role shows no role chips" |
| FR-006 | `frame.role-switch.spec.ts` "switches to the role tapped…", "reopens the live connection when the new role keeps the same dashboard", "does nothing when the role in use is tapped", "ignores a second tap…"; `session.role-switch.spec.ts` "asks for the role, keeps the new token…"; e2e "…switches to driver, the next sign-in opens it…" |
| FR-007 | `frame.role-switch.spec.ts` "says so and keeps the role…", "says it in English"; `session.role-switch.spec.ts` "keeps the token and the account when the switch fails…", "…answers no token", "goes back to the old token…", "restores nothing when signed out…" |
| FR-008 | `session.role-switch.spec.ts` "Session, renewing the token" block |
| FR-009 | `libs/domain/src/auth/role-switch.api.integration.spec.ts` "answers 401 without a signed-in account", "answers 401 and changes nothing once this device signed out", "answers 401 on every device once the account signed out everywhere", "refuses a request that is not JSON" |

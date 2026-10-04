# Tasks: Be asked to sign in when an action needs an account

**Input**: `specs/130-sign-in-gate/` — spec.md, plan.md, research.md, contracts/gate.md, design.md, context.md
**Tests**: required (constitution II, red first). FR → test mapping lives here, not in the source.

## Phase 1: Setup

None: no dependency, no scaffold.

## Phase 2: Foundational

None: each story builds on code that already exists (`ActorGuard`, `SignInDialog`, `authInterceptor`).

## Phase 3: User Story 1 — the API refuses every account action without a session, by default (P1)

**Goal**: one app-wide guard; a short, exact public list.
**Independent test**: every route of the real app called without a token.

- [X] T001 [P] [US1] Write `apps/api/src/public-routes.integration.spec.ts` (new): boot `AppModule` with `configureApp`, list every path × method from `openApiDocument`, call each without a token, a malformed token and an expired one; assert the routes not answering 401 `sign_in_required` are exactly the six of `contracts/gate.md`, and that a gated `PATCH /api/v1/me` with an invalid body answers 401, not 400 (FR-001, FR-002, US1 scenarios 1–3)
- [X] T002 [P] [US1] Extend `libs/domain/src/auth/me-language.api.integration.spec.ts` or a guard spec next to it: a module with a test controller carrying no mark answers 401 `sign_in_required`; the same controller marked `@Public()` answers 200; a valid token of a suspended account still answers 403 `account_suspended` on a gated route (FR-001, FR-003, US1 scenarios 4–5)
- [X] T003 [US1] Add `Public()` (SetMetadata) and the skip (`Reflector.getAllAndOverride` on handler and class) to `libs/domain/src/auth/actor.guard.ts`; export `Public` from `libs/domain/src/index.ts`
- [X] T004 [US1] Register `{ provide: APP_GUARD, useExisting: ActorGuard }` in `libs/domain/src/auth/auth.module.ts`
- [X] T005 [US1] Mark `@Public()` on `AuthController` (`libs/domain/src/auth/auth.controller.ts`) and `HealthController` (`libs/domain/src/health/health.controller.ts`); remove `@UseGuards(ActorGuard)` from `libs/domain/src/auth/me.controller.ts`, `libs/domain/src/audit/audit-history.controller.ts`, `libs/domain/src/events/live.controller.ts`
- [X] T006 [US1] Mark the test-only `ProbeController` in `apps/api/src/bootstrap.integration.spec.ts` `@Public()` so its bootstrap checks keep testing bootstrap, not the guard

**Checkpoint**: `npx jest apps/api libs/domain/src/auth --maxWorkers=2` green with PostgreSQL and Redis.

## Phase 4: User Story 2 — an account action asks to sign in over the screen and goes on (P1)

**Goal**: a refused call opens the one dialog and is repeated after sign-in or sign-up.
**Independent test**: interceptor and dialog specs; the end-to-end flow.

- [X] T007 [P] [US2] Add to `apps/web/src/app/auth.interceptor.spec.ts`: a token-less call answered 401 `sign_in_required` renews once and is repeated with the new token; when renewal fails it awaits `SignInDialog.gate()`; resolved signed in → repeated once with the new token; resolved not signed in → the original 401; a repeat refused again fails with that answer and `gate()` is called once; two concurrent refused calls call `gate()` and share its outcome; no gate for `/api/v1/auth/*`, `GET /api/v1/me`, a 403, a 404, a 429, a 503, a 401 with another code, or on the server platform (FR-004, FR-005, FR-007, FR-009, SC-003, SC-004)
- [X] T008 [P] [US2] Add to `apps/web/src/app/sign-in/sign-in-dialog.spec.ts`: `gate()` opens the sign-in task with the reason and does not navigate after sign-in; a switch to sign-up and a created account resolves `gate()` signed in; closing resolves it not signed in; `gate()` while a `start()` dialog is open opens no second dialog and resolves with it, and `start()` still navigates to the landing (FR-005, FR-007, FR-008)
- [X] T009 [P] [US2] Add to `apps/web/src/app/sign-in/sign-in.spec.ts`: with `reason` in the task data the line "Intră în cont ca să continui." shows under the brand line; without it, it does not; the reason survives a switch to sign-up and back (FR-004, FR-010)
- [X] T010 [US2] Make `SignInDialog` single-flight and add `gate()` in `apps/web/src/app/sign-in/sign-in-dialog.ts` (research R4)
- [X] T011 [US2] Show the optional reason line in `apps/web/src/app/sign-in/sign-in.ts` (`AuthData.reason`), passed through the sign-up switch
- [X] T012 [US2] Renew-or-gate in `apps/web/src/app/auth.interceptor.ts` (research R3)
- [X] T013 [P] [US2] Texts: `public.signIn.reason` in `libs/i18n/src/public/ro.json` and `en.json`; `shell.form.problem.sign_in_required` in `libs/i18n/src/shell/ro.json` and `en.json` → "Intră în cont ca să continui." / "Sign in to continue." (FR-006, FR-010)
- [X] T014 [US2] Write `apps/web-e2e/src/sign-in-gate.spec.ts` (new), API stubbed as `account-language.spec.ts` does: on `/app/driver`, a language tap whose `PATCH /api/v1/me` is refused (401 `sign_in_required`) and whose renewal is refused opens the dialog with the reason line at 320 px, 390 px and desktop; signing in closes it on the same address and the PATCH is sent again once with the new bearer token; closing the dialog leaves the address and sends nothing more (SC-002, US2 scenarios 1–2, 4, US3)

**Checkpoint**: `npx jest apps/web/src/app/auth.interceptor apps/web/src/app/sign-in --maxWorkers=2` green; the e2e flow green.

## Phase 5: User Story 3 — a session that ends while I work (P2)

Covered by T007 (a call that carried a token, renewal refused, gate, repeat) and T014 (a signed-in dashboard whose session is refused). No separate code.

## Phase 6: Polish

- [X] T015 Run `npm run typecheck`, `npm run lint`, the touched projects' tests, and the e2e flow under `scripts/heavy.sh`

## Dependencies

US1 (T001–T006) and US2 (T007–T014) are independent; inside each, tests first (T001–T002, T007–T009), then code. T013 is needed by T009 and T014.

## Parallel examples

- T001 ‖ T002 ‖ T007 ‖ T008 ‖ T009 (different files)
- T013 ‖ T010

## Implementation strategy

Slice 1 = US1 (API deny-by-default, its own commit). Slice 2 = US2 + US3 (web gate, its own commit).

## FR → test

| FR | Test |
| --- | --- |
| FR-001 | T001, T002 |
| FR-002 | T001 |
| FR-003 | T002 |
| FR-004 | T007, T009, T014 |
| FR-005 | T007, T008, T014 |
| FR-006 | T013 text, T014 (closing) |
| FR-007 | T007, T008 |
| FR-008 | T008 |
| FR-009 | T007 |
| FR-010 | T009, T013 |

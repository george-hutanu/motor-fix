# Tasks: Sign in with Apple or Google

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Setup

- [ ] T001 [P] `libs/contracts/src/env.ts` `GOOGLE_ENV`, `APPLE_ENV`; `libs/contracts/src/auth.dto.ts` `ProvidersDto`, `OAuthPendingDto`, `OAuthCompleteDto`; `.env.example` lists the six keys and the two issuer overrides (FR-002)
- [ ] T002 [P] `libs/domain/src/auth/oauth/providers.ts` (new) settings from the environment; `AuthOptions.oauth` in `libs/domain/src/auth/actor.guard.ts`; `apps/api/src/app.module.ts` passes them (FR-002)

## Phase 2: User Story 1 — sign in with a provider (P1)

- [ ] T003 [US1] `libs/domain/src/auth/oauth/openid.ts` (new) discovery, authorisation address, code exchange, Apple client secret, ID token check (FR-003, FR-004)
- [ ] T004 [US1] `libs/domain/src/auth/oauth/oauth.service.ts` (new) start, finish: flow use-up, match, link with audit, sign-in, suspended, deleted, maintenance (FR-003, FR-004, FR-005, FR-006, FR-010)
- [ ] T005 [US1] `libs/domain/src/auth/oauth/oauth.controller.ts` (new) providers, start, callback (GET and POST), cookies; registered in `libs/domain/src/auth/auth.module.ts`; `apps/api/src/public-routes.integration.spec.ts` lists the routes (FR-001, FR-003, FR-004)
- [ ] T006 [US1] Web: `apps/web/src/app/sign-in/providers.ts` (new) buttons under the main button of `sign-in.ts` and `sign-up.ts`; `Session.leaveFor` in `apps/web/src/app/dashboard/session.ts`; `apps/web/src/app/public/sign-in-return.ts` (new) and its route in `apps/web/src/app/app.routes.ts`; `SignInDialog.returned` in `apps/web/src/app/sign-in/sign-in-dialog.ts` (FR-001, FR-003, FR-009)

## Phase 3: User Story 2 — a new person (P1)

- [ ] T007 [US2] Pending sign-up in `libs/domain/src/auth/oauth/oauth.service.ts`: keep, read, complete through `createAccount` with `NewAccount.emailVerified` (`libs/domain/src/auth/accounts.service.ts`); routes `pending` and `complete` (FR-007, FR-008)
- [ ] T008 [US2] Web: `apps/web/src/app/sign-in/provider-sign-up.ts` (new) the new-person step with `mf-consent`; `Session.completeProviderSignUp` (FR-009)

## Phase 4: User Story 3 — cancel, failure, maintenance, unconfigured (P2)

- [ ] T009 [US3] `SignIn` shows a returned problem (`failed` per provider, `maintenance`, `suspended`); texts in `libs/i18n/src/public/ro.json` and `libs/i18n/src/public/en.json` (FR-009, FR-010, FR-011)

## Phase 5: Polish

- [ ] T010 Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`)
- [ ] T011 End to end: `apps/web-e2e/openid.mjs` (new), `apps/web-e2e/project.json` target, `apps/web-e2e/playwright.config.mts`, `.github/workflows/ci.yml` E2E env (FR-001, FR-003, FR-008)
- [ ] T012 Mark tasks, update `auto-run.md`; typecheck, lint, the touched Jest projects

## FR → test

| FR | Tests |
|---|---|
| FR-001 | `oauth.api.integration.spec.ts` (providers), `providers.spec.ts` (web), e2e `sign-in-providers.spec.ts` |
| FR-002 | `providers.spec.ts` (domain) |
| FR-003 | `openid.spec.ts`, `oauth.api.integration.spec.ts` (start), `session` spec (`leaveFor`) |
| FR-004 | `openid.spec.ts`, `oauth.api.integration.spec.ts` (callback, forged and replayed state) |
| FR-005 | `oauth.api.integration.spec.ts` (link verified, not unverified, match by subject) |
| FR-006 | `oauth.api.integration.spec.ts` (role in use, suspended, deleted, maintenance) |
| FR-007 | `oauth.api.integration.spec.ts` (pending, Apple name, relay) |
| FR-008 | `oauth.api.integration.spec.ts` (complete, consent, email_taken, expired) |
| FR-009 | `sign-in-return.spec.ts`, `provider-sign-up.spec.ts`, e2e |
| FR-010 | `oauth.api.integration.spec.ts` (cancel, provider down) |
| FR-011 | `providers.spec.ts` (web, texts), PR QA sweep at 320 px |

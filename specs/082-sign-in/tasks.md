# Tasks: Sign in with e-mail and password

**Input**: spec.md, plan.md, data-model.md, contracts/auth.md, research.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 Migration `libs/domain/prisma/migrations/20261004140000_refresh_token_remember/migration.sql` (new) and `remember Boolean @default(true)` on `RefreshToken` in `libs/domain/prisma/schema/auth.prisma`; apply to `motorfix_st082`, regenerate the client (FR-007)
- [X] T002 [P] `libs/contracts/src/auth.dto.ts` (new): `SignInDto` (`email` string 1–254, `password` string 1–1024, `remember?` boolean) and `SessionDto` (`accessToken`); export from `libs/contracts/src/index.ts` (FR-001, FR-011)

## Phase 2: Foundational

- [X] T003 [P] `libs/domain/src/auth/password.ts` (new): `hashPassword`, `verifyPassword` (argon2id PHC, `timingSafeEqual`), `DECOY_HASH` (FR-002, FR-003)
- [X] T004 [P] `libs/domain/src/auth/attempts.ts` (new): Redis counters per e-mail hash and per address hash — `blocked`, `fail`, `clear`; Redis errors fail open with a warning log (FR-005, FR-011)
- [X] T005 [P] `libs/domain/src/auth/maintenance.ts` (new): `MAINTENANCE` token, `{ on: async () => false }` default (FR-006)

## Phase 3: User Story 1 + 2 — sign in, and the wrong cases (P1)

Independent test: sign in per role through HTTP against PostgreSQL and Redis; wrong password, unknown e-mail, no-password, deleted, suspended, limits, maintenance.

- [X] T006 [US1] `libs/domain/src/auth/sign-in.service.ts` (new): `SignInService.signIn` — limits, account lookup by lower-cased e-mail, password or decoy check, status, maintenance, new family, cookie value, last active, access token for the role in use (FR-001, FR-002, FR-004, FR-005, FR-006, FR-007, FR-011)
- [X] T007 [US1] `libs/domain/src/auth/auth.controller.ts` (new): `POST auth/sign-in`, `auth/refresh`, `auth/sign-out`; cookie set/clear, `Cookie` header read; Swagger decorators (FR-001, FR-007, FR-008, FR-010)
- [X] T008 [US1] `libs/domain/src/auth/auth.module.ts`: controller, service, `MAINTENANCE`, Redis client, `redisUrl` in `AuthOptions`; `apps/api/src/app.module.ts` passes `REDIS_URL`; `apps/api/src/bootstrap.ts` `trust proxy`; `apps/web/src/server/edge.ts` appends `X-Forwarded-For` (FR-005)
- [X] T009 [US1] Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-001, FR-008, FR-010)

## Phase 4: User Story 3 + 4 — renewal and sign-out (P1/P2)

- [X] T010 [US3] `SignInService.refresh` and `signOut`: rotation, 20 s grace without a cookie, reuse revokes the family, status and role checks revoke, last active at most hourly, sign-out revokes the family (FR-008, FR-009, FR-010)
- [X] T011 [US3] `apps/web/src/app/dashboard/session.ts`: token in memory, `signIn`, shared `renew`, `load` renews first, `signOut` forgets even on failure (FR-018, FR-019, FR-020)
- [X] T012 [US3] `apps/web/src/app/auth.interceptor.ts` (new) + `withInterceptors` in `apps/web/src/app/app.config.ts`: bearer on `/api/` outside `/api/v1/auth/`, one shared renewal on a 401 to a call that carried the token, repeat (FR-018)
- [X] T013 [US4] `apps/web/src/app/dashboard/frame.ts`: "Ieși din cont" awaits `session.signOut()` then Home (FR-020)

## Phase 5: User Story 1 (web) — the dialog and its entries (P1)

- [X] T014 [US1] `apps/web/src/app/sign-in/sign-in.ts` (new): the task — "MotorFix", e-mail, password, "Ține‑mă autentificat" ticked, "Intră în cont"; local validation, focus on the first wrong field, busy state, coded messages, password cleared after `invalid_credentials`, closes with "signed-in" (FR-013, FR-014, FR-015, FR-016, FR-022)
- [X] T015 [US1] `apps/web/src/app/sign-in/sign-in-dialog.ts` (new): `SignInDialog.start()` (signed in → landing; else open the dialog, then the landing on "signed-in") (FR-012, FR-017)
- [X] T016 [US1] `apps/web/src/app/public/tab-bar.ts`: "Cont" while signed out opens the dialog without navigating; `apps/web/src/app/public/frame.ts`: ≥ 768 px top bar with "Autentificare", and the dialog on a navigation with `state.signIn` (FR-012, FR-021)
- [X] T017 [US1] `apps/web/src/app/dashboard/area.guard.ts`: signed out → `RedirectCommand` to `/<language>` with `state.signIn` (FR-021)
- [X] T018 [P] [US1] Texts `public.signIn.*` and `public.signInButton` in `libs/i18n/src/public/ro.json` and `en.json`, U+2011 inside Romanian words (FR-022)

## Phase 6: Seed, end to end, CI

- [X] T019 `libs/domain/src/seed.ts`: the seven accounts, the garage, memberships and mechanic link with `pg` and `argon2Sync`, insert-if-missing; staging needs `SEED_PASSWORD`; `pg` as a dev dependency in `package.json` (FR-023)
- [X] T020 `apps/web-e2e/src/accounts.ts` (new) seeded e-mails and `E2E_PASSWORD`; `apps/web-e2e/src/sign-in.ts` also stubs `/api/v1/auth/refresh`; `.github/workflows/ci.yml` e2e job seeds; `release.yml` and `reset-staging.yml` pass `secrets.SEED_PASSWORD` (FR-023)

## Phase 6b: After ST-159 merged

- [X] T022 `libs/ui-cockpit/src/lib/helm/input.ts`: pass `aria-describedby` through to the brain's describedby directive, which otherwise drops a field's own error id (FR-014); test in `libs/ui-cockpit/src/lib/helm/helm.spec.ts`
- [X] T023 `apps/web/src/app/sign-in/sign-in.ts` on `taskSave` and the shared field and task errors from `libs/overlays`; own codes under `public.signIn.problem`, the e-mail format under `public.signIn.field.pattern`; `Session` drops in-flight answers at sign-out (FR-014, FR-015, FR-016, FR-020)

## Phase 7: Polish

- [X] T021 Mark tasks, update `auto-run.md`; `npm run typecheck`, `npm run lint`, the touched Jest projects, the e2e

## Tests (written first by `/speckit-tests`; FR → test)

| FR | Test file |
|----|-----------|
| FR-002, FR-003 | `libs/domain/src/auth/password.spec.ts` |
| FR-001, FR-002, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011 | `libs/domain/src/auth/sign-in.api.integration.spec.ts` (sign-in, limits, maintenance, request, renewal, sign-out) |
| FR-001, FR-010 (route list, OpenAPI) | `libs/domain/src/auth/auth.api.integration.spec.ts`, `apps/api/src/bootstrap.integration.spec.ts` |
| FR-005 (address) | `apps/web/src/server/edge.spec.ts`, `apps/api/src/bootstrap.integration.spec.ts` |
| FR-018, FR-019, FR-020 | `apps/web/src/app/dashboard/session.spec.ts`, `apps/web/src/app/auth.interceptor.spec.ts` |
| FR-013, FR-014, FR-015, FR-016, FR-022 | `apps/web/src/app/sign-in/sign-in.spec.ts` |
| FR-012, FR-017 | `apps/web/src/app/sign-in/sign-in-dialog.spec.ts`, `apps/web/src/app/public/tab-bar.spec.ts` |
| FR-021 | `apps/web/src/app/dashboard/area.guard.spec.ts` |
| FR-020 | `apps/web/src/app/dashboard/frame.spec.ts` |
| FR-023 | `libs/domain/src/seed.integration.spec.ts` |
| FR-001, FR-012, FR-016, FR-017, FR-019, FR-020, FR-021 (end to end) | `apps/web-e2e/src/sign-in.spec.ts` |

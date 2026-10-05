# Tasks: Reset a forgotten password

**Input**: spec.md, plan.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Foundational

- [x] T001 `libs/domain/prisma/schema/auth.prisma` + a migration: `password_reset` joins `account_token_purpose` (on ST-81's table, merged from `origin/081-confirm-email`) (FR-002)
- [X] T002 `libs/domain/src/notifications/templates/account-email.ts`, `templates/registry.ts`, `templates.ts`, `notifications.service.ts`: `ACCOUNT_EMAIL.password_changed` in Romanian and English; `templateName` and `sendAccountEmail` know the purpose (FR-008)

## Phase 2: User Story 1 — ask for a link, API (P1)

Independent test: through HTTP against PostgreSQL and Redis; one `ACCOUNT_EMAIL` `password_reset` queued for an existing account, none for an unknown one, both answered 202.

- [x] T003 [US1] `libs/domain/src/auth/attempts.ts`: `admitReset(email, address)` — counts every request against the e-mail digest (3 an hour) and the client address (10 an hour); a down Redis admits (FR-003)
- [x] T004 [US1] `libs/domain/src/auth/password-reset.service.ts`: `ask(email, address)` — limit, then for an active account a new token (older unused ones deleted) and `sendAccountEmail` `password_reset` with `{webUrl}/{language}/reset-password/{token}`; any failure logged, never thrown (FR-001, FR-002, FR-003)
- [x] T005 [US1] `libs/contracts/src/auth.dto.ts` + `libs/domain/src/auth/password-reset.controller.ts` + `password-reset.module.ts` + `apps/api/src/app.module.ts`: `POST auth/password-reset` 202, JSON only (FR-001)

## Phase 3: User Story 2 and 3 — check and complete, API (P1)

- [x] T006 [US2] `password-reset.service.ts`: `check(token)` — 204 / 410 `token_expired` / 410 `token_invalid` (FR-004)
- [x] T007 [US2] `password-reset.service.ts`: `complete(token, password)` — token, maintenance, strength; one transaction taking the token conditionally, replacing or adding the password identity, deleting every refresh token, the audit entry; `openSession` for the last role, remembered; then `password_changed` and `session.revoked`, failures logged (FR-005, FR-006, FR-007)
- [x] T008 [US2] `password-reset.controller.ts`: `POST auth/password-reset/check` 204, `POST auth/password-reset/complete` 200 with the refresh cookie; `public-routes.integration.spec.ts` and route list (the reset controller is its own module, so `auth.api.integration.spec.ts` is unchanged) (FR-004, FR-005)
- [x] T009 [US2] Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-001, FR-004, FR-005)

## Phase 4: User Story 1 — the e-mail step, web (P1)

- [X] T010 [US1] `apps/web/src/app/sign-in/sign-in.ts`: "Ai uitat parola?" in the remember row closes with a switch to `reset` carrying the e-mail (FR-009)
- [X] T011 [US1] `apps/web/src/app/sign-in/password-reset.ts` (new): the e-mail task, the sent state, "Înapoi la autentificare"; texts in `libs/i18n/src/public/{ro,en}.json` (FR-010)
- [X] T012 [US1] `apps/web/src/app/sign-in/sign-in-dialog.ts`: the reset lap between sign-in and the e-mail task (FR-009, FR-010)

## Phase 5: User Story 2 and 3 — the link, web (P1)

- [X] T013 [US2] `apps/web/src/app/dashboard/session.ts`: `resetPassword(token, password)` starts the session from the answer as sign-in does (FR-012)
- [X] T014 [US2] `apps/web/src/app/sign-in/new-password.ts` (new): checks the token, then the new-password form or "Linkul a expirat" with "Cere un link nou"; a 410 on save switches to expired; `weak_password` under the field (FR-011, FR-012)
- [X] T015 [US2] `sign-in-dialog.ts` `newPassword(token)` + `apps/web/src/app/public/reset-password.ts` (new) + `app.routes.ts`: `/{lang}/reset-password/:token` shows Home with the dialog; signed in → the role's landing; "Cere un link nou" → the e-mail task; closed → Home (FR-011, FR-012)

- [X] T017 [US2] `apps/web/src/app/dashboard/session.ts` `revoked()` + `frame.ts`: on `session.revoked` forget the session locally, close live and open Home; no sign-out call, no broadcast (FR-013)

## Phase 6: Polish

- [x] T016 `apps/web-e2e/src/password-reset.spec.ts` (new): an account of its own through sign-up; reset from the dialog, the link read from the queued notification; the new password works and the old one does not; an unknown link shows "Linkul a expirat"; 320 px without sideways scroll; English (SC-001, SC-003)

## Dependencies

T001 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 … T015 → T016; T002 before T007.

## FR → test (filled by `/speckit-tests`)

| FR | Test |
| --- | --- |
| FR-001, FR-002, FR-003 | `libs/domain/src/auth/password-reset.api.integration.spec.ts` › asking for a reset link; `attempts.spec.ts` (Redis down) |
| FR-004 | `password-reset.api.integration.spec.ts` › checking a link |
| FR-005, FR-006, FR-007 | `password-reset.api.integration.spec.ts` › completing a reset |
| FR-008 | `libs/domain/src/notifications/templates.spec.ts` › the account e-mails |
| FR-009 | `apps/web/src/app/sign-in/sign-in.spec.ts`, `sign-in-dialog.spec.ts` › a forgotten password |
| FR-010 | `apps/web/src/app/sign-in/password-reset.spec.ts` |
| FR-011 | `apps/web/src/app/public/reset-password.spec.ts`, `new-password.spec.ts` |
| FR-012 | `new-password.spec.ts`, `apps/web/src/app/dashboard/session.spec.ts` (resetPassword) |
| FR-013 | `apps/web/src/app/dashboard/frame.sign-out.spec.ts` › a session ended elsewhere, `session.sign-out.spec.ts` |
| SC-001, SC-003 | `apps/web-e2e/src/password-reset.spec.ts` |

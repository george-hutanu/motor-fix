# Implementation Plan: Reset a forgotten password

**Branch**: `127-password-reset` | **Date**: 2026-10-05 | **Spec**: specs/127-password-reset/spec.md

## Summary

Three public JSON calls under `/api/v1/auth/password-reset` (ask, check, complete) on ST-81's `account_token` table with a new purpose `password_reset`: the ask queues the existing `ACCOUNT_EMAIL.password_reset` template with a 60-minute link; the complete replaces the password hash, deletes every refresh token, writes one audit entry, opens a session exactly as sign-in does, queues a new `ACCOUNT_EMAIL.password_changed` and publishes `session.revoked`. The web app adds "Ai uitat parola?" to the sign-in task, an e-mail task, and a new-password task opened over Home at `/{lang}/reset-password/:token`.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (root `package.json`), Angular 22.2.1 standalone + signals (`apps/web`), NestJS 12.1.2 (`libs/domain`, `apps/api`)
**Primary Dependencies**: existing only — Prisma 7.10.0 (`libs/domain/prisma/schema/auth.prisma`), ioredis (the auth module's Redis through `Attempts` and `SESSION_EVENTS`), `NotificationsService.sendAccountEmail` (ST-194), `@motor-fix/overlays`, `@motor-fix/i18n`, the generated `@motor-fix/data-access` client; `pg` (already a root dependency) for the e2e test mailbox
**Storage**: PostgreSQL `account_token` (ST-81; one enum value added by migration), `account_identity.password_hash`, `refresh_token` (delete by account), `audit_entry`; Redis counters `auth:reset:{email|address}:<sha256>` with a 60-minute window
**Testing**: Jest 30.5.2 (`jest.preset.cjs`; `*.integration.spec.ts` against PostgreSQL + Redis), Playwright `apps/web-e2e`
**Target Platform**: API on Railway; web SSR + browser
**Constraints**: no new dependency; the request answers the same for every address; nothing written on any refusal

**Depends on unmerged work**: ST-81 (PR #71) creates `account_token` and the token helpers (`libs/domain/src/auth/email-confirmation.ts`: `newToken`, `hashToken`). This branch merges `origin/081-confirm-email` to build on it, and goes ready only after #71 is on `main` (then `origin/main` is merged and the diff is this story's alone).

## Constitution Check

- I No bloated code: one service, one controller of three routes, one module (global, like ST-81's, because the notifications module imports the auth module); the token helpers, `Attempts`, the cookie helpers, `openSession` and `publishLive` are reused, not copied.
- II Tests first: API integration, unit, web unit and e2e written before the code.
- VI Redis holds nothing that is the only copy: only request counters and the live hint; the tokens, passwords and sessions are in PostgreSQL.
- VII Lifecycle: draft PR #72 open, Notion Planning.

## Project Structure

```
libs/domain/prisma/schema/auth.prisma                    AccountTokenPurpose += password_reset
libs/domain/prisma/migrations/<ts>_password_reset_token/ ALTER TYPE … ADD VALUE 'password_reset'
libs/domain/src/auth/attempts.ts                         admitReset(email, address): 3/e-mail, 10/address an hour
libs/domain/src/auth/password-reset.service.ts           ask, check, complete (new)
libs/domain/src/auth/password-reset.controller.ts        POST auth/password-reset, …/check, …/complete (new)
libs/domain/src/auth/password-reset.module.ts            global module, imports notifications (new)
libs/domain/src/auth/auth.controller.ts                  export the refresh-cookie helper the new controller reuses
libs/domain/src/auth/auth.module.ts                      export SignInService, Attempts, SESSION_EVENTS
libs/domain/src/auth/sign-up.service.ts                  export the weak-password rule
libs/domain/src/notifications/…                          ACCOUNT_EMAIL.password_changed (template, registry, templateName, sendAccountEmail purpose)
libs/contracts/src/auth.dto.ts                           PasswordResetDto, PasswordResetCheckDto, PasswordResetCompleteDto
apps/api/src/app.module.ts                               PasswordResetModule.register
apps/api/openapi.json, libs/data-access                  regenerated
apps/web/src/app/sign-in/sign-in.ts                      "Ai uitat parola?" → switch to reset
apps/web/src/app/sign-in/password-reset.ts               the e-mail task (new)
apps/web/src/app/sign-in/new-password.ts                 the new-password task (new)
apps/web/src/app/sign-in/sign-in-dialog.ts               the reset lap; newPassword(token)
apps/web/src/app/public/reset-password.ts                the link page: Home with the dialog over it (new)
apps/web/src/app/dashboard/session.ts                    resetPassword(token, password)
apps/web/src/app/app.routes.ts                           :lang/reset-password/:token
libs/i18n/src/public/{ro,en}.json                        texts
apps/web-e2e/src/password-reset.spec.ts                  the flow through the test mailbox (new)
```

## Complexity Tracking

| Choice | Why | Simpler option rejected |
| --- | --- | --- |
| A separate global `PasswordResetModule` | It needs `NotificationsService`, and the notifications module imports the auth module, so the auth module cannot import it (ST-81 hit the same) | Routes in `AuthController` (circular import) |
| A check call besides complete | Scenario 6: "Linkul a expirat" when the link is opened, before any password is typed | Only complete (the expired state would show after typing a password) |
| The e2e reads the queued link from `notification` with `pg` | The Build brief asks for the flow "through the test mailbox"; no test mailbox exists, and the queued notification is what the mail would carry | A test-only API route (a public back door) |

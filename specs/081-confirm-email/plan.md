# Implementation Plan: Confirm my e-mail address

**Branch**: `081-confirm-email` | **Date**: 2026-10-05 | **Spec**: specs/081-confirm-email/spec.md

## Summary

Issue a single-use, hashed, 72-hour confirmation token after sign-up and queue the existing `ACCOUNT_EMAIL` (`email_check`) e-mail through `NotificationsService.sendAccountEmail`; confirm it from a public route that sets `account.email_verified_at`, records the audit entry and announces `account.email_confirmed` on the account's live channel; let the person ask again from the dashboard banner or the expired page, limited per account. The web app adds the banner to the dashboard frame and a confirmation page under `/:lang`.

## Technical Context

- **Language/Version**: TypeScript 6 (root `package.json`), Node 24 (`node --version` v24.21.0).
- **Primary Dependencies**: NestJS 12 (ESM), Prisma 7.10 (`libs/domain/prisma.config.ts`, schema per module in `libs/domain/prisma/schema`), BullMQ + ioredis (existing notifications queue), Angular 21 standalone + signals, Spartan UI kit in `libs/ui-cockpit`, `@motor-fix/data-access` generated from `apps/api/openapi.json`.
- **Storage**: PostgreSQL (new table `account_token`, migration `20261005120000_account_token`); Redis for the resend limit and the live publish.
- **Testing**: Jest from the root preset (`jest.preset.cjs`; `*.integration.spec.ts` against PostgreSQL and Redis), Playwright `web-e2e`.
- **Constraints**: no new dependency; a failure to send never fails sign-up; the token is never stored in clear in `account_token` (the queued notification's params carry the link, as ST-194/195 designed `sendAccountEmail`).

## Constitution Check

- I. No bloated code: one service, one controller, one module; no port or interface layer beyond the one wiring problem below. PASS.
- II. Tests first, real PostgreSQL and Redis for the API, Playwright for the flow. PASS.
- VII. Draft PR #71 opened at the start. PASS.

## Wiring

`NotificationsModule.register` imports the `AuthModule` (for its guard), so the `AuthModule` cannot import notifications. A new global `EmailConfirmationModule.register({ redisUrl, webUrl }, notifications)` in `libs/domain/src/auth/email-confirmation.module.ts` imports the notifications module and exports `EmailConfirmationService`; `SignUpService` takes it `@Optional()` so the many tests that build `AuthModule` alone keep working, and the API's `AppModule` always registers it (an `apps/api` integration test proves sign-up queues the e-mail through the real wiring).

## Project Structure

```text
libs/domain/prisma/schema/auth.prisma              # AccountToken, AccountTokenPurpose
libs/domain/prisma/migrations/20261005120000_account_token/migration.sql
libs/domain/src/auth/email-confirmation.ts          # token make/hash, link, limit decisions (pure)
libs/domain/src/auth/email-confirmation.service.ts  # issue, confirm, resendByToken, resendForAccount
libs/domain/src/auth/email-confirmation.controller.ts
libs/domain/src/auth/email-confirmation.module.ts
libs/domain/src/auth/sign-up.service.ts             # issue after create (FR-001, FR-012)
libs/domain/src/auth/accounts.service.ts            # google/apple confirmed at creation (FR-011)
libs/domain/src/auth/me.controller.ts               # emailConfirmed (FR-009)
libs/domain/src/seed.ts                             # seeded accounts confirmed (FR-016)
libs/domain/src/audit/audit-coverage.spec.ts        # issue is token bookkeeping, not a change
libs/contracts/src/auth.dto.ts, me.dto.ts           # ConfirmEmailDto, ConfirmEmailAnswerDto, MeDto.emailConfirmed
apps/api/src/app.module.ts                          # register the module
apps/api/openapi.json, libs/data-access              # regenerated
apps/web/src/app/dashboard/email-banner.ts           # banner (FR-013, FR-014)
apps/web/src/app/dashboard/frame.ts                  # hosts the banner, live event
apps/web/src/app/public/confirm-email.ts             # page (FR-015)
apps/web/src/app/app.routes.ts                       # :lang/confirm-email/:token
libs/i18n/src/shell/{ro,en}.json, public/{ro,en}.json
apps/web-e2e/src/confirm-email.spec.ts
```

## Complexity Tracking

| Choice | Why | Simpler option rejected |
| --- | --- | --- |
| `@Optional()` service in `SignUpService` | the module cycle (notifications imports auth) | `forwardRef` between the two dynamic modules: harder to read, and every AuthModule-only test would then need notifications |

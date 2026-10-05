# Implementation Plan: Get MotorFix news only with my consent and stop it in one click

**Branch**: `201-news-consent` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

Add four consent columns to `notification_preference` and a `news_send` table (one row per Bucharest month). The preferences save of ST-197 learns NEWS consent: turning news on needs the current consent text version and records it; turning it off records the withdrawal. A new `news.ts` holds the signed unsubscribe token; a `NewsService` with two routes adds the public one-click stop and the admin send, which notifies each consenting driver through the existing `NotificationsService.notify` with the title, text and stop links in their language. The worker's e-mail send adds the two `List-Unsubscribe` headers when a row carries a one-click link, and the e-mail template gains an optional footer link. The web app gets the public page `/{lang}/unsubscribe/{token}`, built like the e-mail check page.

## Technical Context

- **Language/Version**: TypeScript (`package.json`), Node 24; NestJS 12 ESM (`libs/domain` tests run Jest with `--experimental-vm-modules`); Angular (standalone, signals) for `apps/web`.
- **Primary Dependencies**: Prisma 7.10.0 with `@prisma/adapter-pg`; `node:crypto` HMAC (as `libs/domain/src/auth/access-token.ts`); class-validator DTOs in `libs/contracts`; the generated client in `libs/data-access`. No new dependency.
- **Storage**: PostgreSQL: migration `20261005130000_news_consent` adds `consent_given_at`, `consent_text_version`, `consent_source`, `withdrawn_at` to `notification_preference` and creates `news_send` (unique `month`).
- **Testing**: Jest from the root preset: unit specs for the token and the template; `*.integration.spec.ts` for the save, the unsubscribe route, the send and the worker's headers against PostgreSQL, Redis and the recorded Brevo mock; the web page's spec with TestBed; Playwright in `apps/web-e2e` for the page's invalid link and consent through the API.
- **Target Platform**: the API (`apps/api`), the worker (`apps/worker`), the web app (`apps/web`).
- **Constraints**: the token key is derived from `AUTH_TOKEN_SECRET` (HMAC of a fixed label), so no new secret; the API reaches it through `AUTH_OPTIONS`, which `AuthModule` exports. The one-click URL is `PUBLIC_WEB_URL/api/v1/…` (the web edge forwards `/api/`). The month uses `smsMonth` (`sms-counter.ts`), which is the Bucharest calendar month. Quiet hours already hold NEWS (`catalogue.ts` NOT_URGENT).
- **Scale/Scope**: a send loops over consenting drivers in the request, as the admin test message does.

## Constitution Check

- **I. No bloated code**: no new capability (reuses `admin.settings`), no new secret, no queue job for the send, no consent dialog without its panel; the month key reuses `smsMonth`.
- **II. Tests first, real services**: every route and the worker header are tested against real PostgreSQL and Redis.
- **Audit [27]**: consent given/withdrawn and each send are recorded inside their transactions; `audit-coverage.spec.ts` checks every write.
- **VII. Lifecycle**: draft PR #76 opened at start.

## Project Structure

```
libs/domain/prisma/schema/notifications.prisma            # consent columns, NewsSend
libs/domain/prisma/migrations/20261005130000_news_consent/migration.sql
libs/contracts/src/notification-preferences.dto.ts        # consent version, NewsConsentDto, news DTOs
libs/domain/src/notifications/news.ts                     # unsubscribe token sign/verify, links
libs/domain/src/notifications/news.service.ts             # unsubscribe, send
libs/domain/src/notifications/news.controller.ts          # POST unsubscribe (public), POST admin/news
libs/domain/src/notifications/preferences.ts              # consent state in the view
libs/domain/src/notifications/preferences.service.ts      # consent on save
libs/domain/src/notifications/notifications.module.ts     # registers the two
libs/domain/src/notifications/brevo.ts                    # optional headers
libs/domain/src/notifications/notifications.processor.ts  # one-click headers
libs/domain/src/notifications/templates.ts, email-layout.ts, templates/news.ts, templates/registry.ts
apps/web/src/app/public/unsubscribe.ts                    # the page
apps/web/src/app/app.routes.ts                            # its route
libs/i18n catalogues                                      # its texts (ro, en)
apps/api/openapi.json, libs/data-access                   # regenerated
apps/web-e2e/src/news.spec.ts
```

## Complexity Tracking

None.

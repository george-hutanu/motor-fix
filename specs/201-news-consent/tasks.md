# Tasks: Get MotorFix news only with my consent and stop it in one click

**Input**: spec.md, plan.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 Prisma: consent columns on `NotificationPreference` and the `NewsSend` model in `libs/domain/prisma/schema/notifications.prisma`; migration `libs/domain/prisma/migrations/20261005130000_news_consent/migration.sql`, which also switches off every NEWS row saved before consent existed; regenerate the client (FR-001, FR-008)
- [X] T002 [P] `libs/contracts/src/notification-preferences.dto.ts`: `NEWS_CONSENT_TEXT_VERSION`, `newsConsentTextVersion` on the save, `NewsConsentDto` on the read, `SendNewsDto`, `NewsSentDto` (FR-001, FR-002, FR-006, FR-007)

## Phase 2: Foundational

- [X] T003 `libs/domain/src/notifications/news.ts` (new): `unsubscribeToken`, `unsubscribedAccount`, `newsLinks` (FR-004, FR-005, FR-009)

## Phase 3: User Story 1 — consent on the switch (P1)

- [X] T004 [US1] `libs/domain/src/notifications/preferences.ts` and `preferences.service.ts`: consent state in the read; the save refuses news on without the version, records consent given and withdrawn with their audit entries (FR-001, FR-002, FR-003, FR-011)

## Phase 4: User Story 2 — one-click stop (P1)

- [X] T005 [US2] `libs/domain/src/notifications/news.service.ts` (new) `unsubscribe(token)` and `news.controller.ts` (new) public `POST notification-preferences/unsubscribe` (FR-004, FR-011)
- [X] T006 [US2] `libs/domain/src/notifications/templates.ts`, `email-layout.ts`: optional stop link in the e-mail; `templates/news.ts` (new) in `templates/registry.ts` (FR-009)
- [X] T007 [US2] `libs/domain/src/notifications/brevo.ts` optional headers; `notifications.processor.ts` adds `List-Unsubscribe` and `List-Unsubscribe-Post` for a row with a one-click link (FR-009)
- [X] T008 [US2] `apps/web/src/app/public/unsubscribe.ts` (new), its route in `apps/web/src/app/app.routes.ts`, texts in `libs/i18n/src/public/{ro,en}.json` (FR-010)

## Phase 5: User Story 3 — admin send (P2)

- [X] T009 [US3] `NewsService.send` and `POST admin/news` (`admin.settings`): consenting drivers only, one per Bucharest month, links per driver, audit entry (FR-006, FR-007, FR-008, FR-011)
- [X] T010 [US3] `libs/domain/src/notifications/notifications.module.ts`: register the controller and the service (FR-004, FR-006)

## Phase 6: Polish

- [X] T011 Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-004, FR-006)
- [X] T012 Mark tasks, update `auto-run.md`; typecheck, lint, the touched Jest projects

## Dependencies

T001, T002 → T003 → T004 → T005 → T006, T007 → T008 → T009 → T010 → T011 → T012.

## Tests (written first by `/speckit-tests`; FR → test)

| FR | Test file |
|----|-----------|
| FR-005, FR-009 | `libs/domain/src/notifications/news.spec.ts` |
| FR-001, FR-002, FR-003, FR-011 | `libs/domain/src/notifications/news-consent.api.integration.spec.ts` |
| FR-004, FR-006, FR-007, FR-008, FR-011 | `libs/domain/src/notifications/news.api.integration.spec.ts` |
| FR-009 | `libs/domain/src/notifications/news.processor.integration.spec.ts`, `libs/domain/src/notifications/templates.spec.ts` |
| FR-010 | `apps/web/src/app/public/unsubscribe.spec.ts`, `apps/web-e2e/src/news.spec.ts` |

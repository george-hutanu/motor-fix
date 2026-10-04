# Tasks: Set up e-mail sending

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/notifications.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 `bullmq` 6.3.11 exact in `package.json` and `package-lock.json` (R1)
- [X] T002 Prisma: `Notification` model and enums `notification_channel` (in_app, email, push, sms, whatsapp), `notification_status` (queued, held, sent, failed) in `libs/domain/prisma/schema/notifications.prisma`; `emailBouncedAt DateTime? @map("email_bounced_at")` and the `notifications` relation on `Account` in `libs/domain/prisma/schema/auth.prisma`; migration `libs/domain/prisma/migrations/20261004180000_notifications/migration.sql` (new) with the unique (kind, account_id, channel, event_id) and the indexes of data-model.md; regenerate the client (FR-003, FR-005, FR-014)
- [X] T003 [P] `libs/contracts/src/notifications.dto.ts` (new): `TestMessageDto` (`accountIds`: 1–20 distinct UUIDs), `TestMessageQueuedDto` (`queued`); export from `libs/contracts/src/index.ts` (FR-013)

## Phase 2: Foundational

- [X] T004 [P] `libs/domain/src/notifications/catalogue.ts` (new): `NOTIFICATION_TYPES` (every catalogue type + TEST_MESSAGE, with trigger, channels, alwaysSent, transactional, groupable, urgent, group, templateKey), `notificationType(name)`, `sendsEmail(type, muted)` (FR-001, FR-004)
- [X] T005 [P] `libs/domain/src/notifications/quiet-hours.ts` (new): `isQuiet(at)`, `nextMorning(at)` in Europe/Bucharest (FR-010)
- [X] T006 [P] `libs/domain/src/notifications/email-config.ts` (new): `emailConfig(appEnv, source)` → `{ sending, allowlist, from, apiKey, apiUrl, webhookSecret }` and `blockedReason(config, address)` → `sending_off` | `not_allowed` | null (FR-015)
- [X] T007 [P] `libs/domain/src/notifications/messages.ts` (new): ro/en subject and text for TEST_MESSAGE, ACCOUNT_EMAIL (email_check, password_reset, with the link), a generic single message and the grouped count (FR-018)
- [X] T008 [P] `libs/domain/src/notifications/brevo.ts` (new): `Brevo.send({ to, name, subject, text })` → messageId, `Brevo.checkKey()`; `BrevoError` with `retryable` (5xx, 429, timeout, network) and `reason`; 10 s timeout (FR-007, FR-008, FR-016)

## Phase 3: User Story 1 + 3 + 7 — the entry point, direct sends, guarded sending (P1)

Independent test: hand the service a QUOTE_RECEIVED and an ACCOUNT_EMAIL against PostgreSQL, Redis and the recorded Brevo mock; read the rows and the mock's calls.

- [X] T009 [US1] `libs/domain/src/notifications/notifications.service.ts` (new): `notify()` — refuse unknown type; per recipient in one transaction with the advisory lock: skip deleted, `in_app` row `sent`, `email` row decided by `blockedReason`, quiet hours, grouping window; skip duplicates by the unique key; then publish `notification.created` on `live:events` and queue `send`/`flush` jobs; `sendAccountEmail()` with a fresh event id (FR-002, FR-003, FR-004, FR-005, FR-006, FR-009, FR-010, FR-012, FR-015, FR-020)
- [X] T010 [US1] `libs/domain/src/notifications/notifications.processor.ts` (new): `send` (skip unless queued/held; deleted account → failed; held → re-enter grouping; Brevo; `sent` with messageId) and `flush` (one e-mail for the held rows of a window, or an ordinary one for a single row); retry schedule `RETRY_MINUTES = [1, 5, 15, 60, 240]`; final failure → `failed` + `EMAIL_FALLBACK` (FR-007, FR-008, FR-009, FR-011, FR-017, FR-020)
- [X] T011 [US1] `libs/domain/src/notifications/notifications.module.ts` (new): `register` (api: service, controllers, queue) and `registerWorker` (service, processor, BullMQ `Worker` with concurrency 10, key check when sending is on); `EMAIL_FALLBACK` no-op; export from `libs/domain/src/index.ts` (FR-016, FR-017)
- [X] T012 [US7] `apps/worker/src/main.ts` registers `NotificationsModule.registerWorker`; `apps/api/src/app.module.ts` registers `NotificationsModule.register`; `.env.example` gains the e-mail variables (FR-015, FR-016)

## Phase 4: User Story 2 — the admin test message (P1)

- [X] T013 [US2] `libs/domain/src/notifications/notifications.controller.ts` (new): `POST admin/notifications/test`, `@Requires('admin.settings')`, 400 `unknown_recipient`, 202 `{ queued }` (FR-013)

## Phase 5: User Story 4 — retries and bounces (P2)

- [X] T014 [US4] `libs/domain/src/notifications/brevo-webhook.controller.ts` (new): `POST webhooks/brevo`, bearer secret with `timingSafeEqual`, `hard_bounce` → row `failed`/`bounced`, `email_bounced_at`, fallback; else 204 (FR-014)

## Phase 6: User Story 5 + 6 — grouping and quiet hours (P2)

- [X] T015 [US5] Grouping and quiet-hours paths of T009/T010 covered by their integration specs (FR-009, FR-010, FR-011)

## Phase 7: Polish

- [X] T016 Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-013, FR-014)
- [X] T017 Mark tasks, update `auto-run.md`; `npm run typecheck`, `npm run lint`, the touched Jest projects

## Dependencies

T001–T003 → T004–T008 (parallel) → T009 → T010 → T011 → T012; T013 and T014 after T011; T015 with T009/T010; T016 after T013/T014.

## Tests (written first by `/speckit-tests`; FR → test)

| FR | Test file |
|----|-----------|
| FR-001, FR-004 | `libs/domain/src/notifications/catalogue.spec.ts` |
| FR-010 | `libs/domain/src/notifications/quiet-hours.spec.ts` |
| FR-015 | `libs/domain/src/notifications/email-config.spec.ts` |
| FR-018 | `libs/domain/src/notifications/messages.spec.ts` |
| FR-007, FR-008, FR-016 | `libs/domain/src/notifications/brevo.spec.ts` (recorded mock) |
| FR-002, FR-003, FR-005, FR-006, FR-009, FR-010, FR-012, FR-015, FR-019, FR-020 | `libs/domain/src/notifications/notifications.service.integration.spec.ts` |
| FR-007, FR-008, FR-009, FR-011, FR-017 | `libs/domain/src/notifications/notifications.processor.integration.spec.ts` |
| FR-013 | `libs/domain/src/notifications/notifications.api.integration.spec.ts` |
| FR-014 | `libs/domain/src/notifications/brevo-webhook.api.integration.spec.ts` |

# Tasks: Send SMS and WhatsApp through Brevo with the monthly SMS cap

**Input**: spec.md, plan.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 Prisma: `SmsCounter` in `libs/domain/prisma/schema/notifications.prisma`, `GarageFeature` in `libs/domain/prisma/schema/garages.prisma`, back-relation on `Account`; migration `libs/domain/prisma/migrations/20261005120000_sms_whatsapp/migration.sql`; regenerate the client (FR-003, FR-005)
- [X] T002 [P] `libs/domain/src/notifications/phone-config.ts` (new): `phoneConfig(appEnv, env)`, `phoneBlockedReason`; `.env.example` and `apps/worker/src/main.ts` (FR-008)

## Phase 2: Foundational

- [X] T003 [P] `libs/domain/src/notifications/brevo.ts`: `sendSms`, `sendWhatsApp`, one answer reader for the three calls (FR-001, FR-002, FR-007)
- [X] T004 [P] `libs/domain/src/notifications/sms-counter.ts` (new): `smsMonth`, `takeSms`, `giveSmsBack` (FR-003)
- [X] T005 [P] `libs/domain/src/notifications/routing.ts` (new): `outsideChannels`; `preferences.ts` keeps staff WhatsApp off until chosen (FR-004, FR-005)

## Phase 3: User Story 1 + 2 — SMS with the cap, WhatsApp, the fallback chain (P1)

- [X] T006 [US1] `libs/domain/src/notifications/notifications.service.ts`: write `sms`/`whatsapp` rows from `outsideChannels`, quiet hours for them, no grouping, `fail` falls back SMS → WhatsApp → e-mail (FR-004, FR-006)
- [X] T007 [US1] `libs/domain/src/notifications/notifications.processor.ts`: phone sends with the switch, the allowlist, the count, the template ids and the retries; `notifications.module.ts` takes the phone config (FR-001, FR-002, FR-003, FR-007, FR-008)
- [X] T008 [P] [US1] `libs/domain/src/notifications/templates/due-itp.ts` (new) and the registry (FR-010)

## Phase 4: User Story 3 — who may choose SMS, the garage switch (P2)

- [X] T009 [US3] `libs/domain/src/notifications/preferences.service.ts`: 422 `channel_not_allowed` for SMS from a role other than driver (FR-009); the garage switch read in the service (FR-005)

## Phase 5: Polish

- [ ] T010 Mark tasks, update `auto-run.md`; typecheck, lint, the touched Jest projects

## Dependencies

T001, T002 → T003, T004, T005 → T006 → T007, T008 → T009 → T010.

## Tests (written first by `/speckit-tests`; FR → test)

| FR | Test file |
|----|-----------|
| FR-001, FR-002, FR-007 | `libs/domain/src/notifications/brevo.spec.ts` |
| FR-003 | `libs/domain/src/notifications/sms-counter.spec.ts`, `libs/domain/src/notifications/phone.processor.integration.spec.ts` |
| FR-004, FR-005 | `libs/domain/src/notifications/routing.spec.ts`, `libs/domain/src/notifications/phone.processor.integration.spec.ts` |
| FR-006, FR-007 | `libs/domain/src/notifications/phone.processor.integration.spec.ts` |
| FR-008 | `libs/domain/src/notifications/phone-config.spec.ts`, `libs/domain/src/notifications/phone.processor.integration.spec.ts` |
| FR-009 | `libs/domain/src/notifications/preferences.api.integration.spec.ts` |
| FR-010 | `libs/domain/src/notifications/template-check.spec.ts`, `libs/domain/src/notifications/phone.processor.integration.spec.ts` |

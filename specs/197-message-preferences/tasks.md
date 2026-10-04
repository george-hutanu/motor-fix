# Tasks: Store each person's message choices and check them before sending

**Input**: spec.md, plan.md, data-model.md, contracts/notification-preferences.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 Prisma: `NotificationPreference` in `libs/domain/prisma/schema/notifications.prisma`, back-relations on `Account` (`libs/domain/prisma/schema/auth.prisma`) and `Garage` (`libs/domain/prisma/schema/garages.prisma`); migration `libs/domain/prisma/migrations/20261005090000_notification_preferences/migration.sql` with the (account_id, type) index; regenerate the client (FR-002)
- [X] T002 [P] `libs/contracts/src/notification-preferences.dto.ts` (new): `NotificationGroupDto`, `NotificationPreferenceDto`, `NotificationPreferencesDto`, `UpdateNotificationGroupDto`, `UpdateNotificationPreferenceDto`, `UpdateNotificationPreferencesDto`; export from `libs/contracts/src/index.ts` (FR-004, FR-005, FR-007)

## Phase 2: Foundational

- [X] T003 `libs/domain/src/notifications/preferences.ts` (new): `DRIVER_GROUPS` with their types, `isDriverType`, `defaultChannel`, `canMute`, `groupStates`, `mutedChannels` (FR-001, FR-003, FR-009)

## Phase 3: User Story 1 + 4 — driver groups, always-sent, own preferences only (P1)

- [X] T004 [US1] `libs/domain/src/notifications/preferences.service.ts` (new): `read(accountId)`, `save(actor, body)` — validation of FR-006, per-account advisory lock, group switches then choices, audit entries, live publish (FR-004, FR-005, FR-006, FR-008, FR-011, FR-012)
- [X] T005 [US4] `libs/domain/src/notifications/preferences.controller.ts` (new): `GET`/`PUT notification-preferences` for the caller only (FR-007)
- [X] T006 [US1] `libs/domain/src/notifications/notifications.service.ts`: `notify` takes an optional `garageId`, reads the recipient's rows before the transaction (defaults on a failed read, logged), passes `mutedChannels` to `sendsEmail` (FR-009, FR-010); `libs/domain/src/notifications/catalogue.ts` comment updated
- [X] T007 [US1] `libs/domain/src/notifications/notifications.module.ts`: register the controller and the service (FR-004)

## Phase 4: User Story 2 + 3 — driver channel, staff per channel (P2)

- [X] T008 [US2] Channel choice and staff rows through T004/T006, covered by their integration specs (FR-002, FR-009)

## Phase 5: Polish

- [X] T009 Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-004, FR-005)
- [ ] T010 Mark tasks, update `auto-run.md`; typecheck, lint, the touched Jest projects

## Dependencies

T001, T002 → T003 → T004 → T005, T006 → T007 → T008 → T009 → T010.

## Tests (written first by `/speckit-tests`; FR → test)

| FR | Test file |
|----|-----------|
| FR-001, FR-003, FR-009 | `libs/domain/src/notifications/preferences.spec.ts` |
| FR-002, FR-004, FR-005, FR-006, FR-007, FR-008, FR-011, FR-012 | `libs/domain/src/notifications/preferences.api.integration.spec.ts` |
| FR-009, FR-010 | `libs/domain/src/notifications/preferences.pipeline.integration.spec.ts` |

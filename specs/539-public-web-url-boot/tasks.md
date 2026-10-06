# Tasks: A bad PUBLIC_WEB_URL is named at start

- [ ] T001 [US1] Integration tests in `libs/domain/src/notifications/notifications.processor.integration.spec.ts` "starting the worker": unset and malformed address with sending on refuse; sending off starts (FR-001, FR-002)
- [ ] T002 [US2] Unit tests in `libs/contracts/src/env.spec.ts` for `publicWebUrl` (FR-003)
- [ ] T003 [US1] Refuse in `ready()` in `libs/domain/src/notifications/notifications.processor.ts` (FR-001, FR-002)
- [ ] T004 [US2] Add `publicWebUrl` to `libs/contracts/src/env.ts`; use it in `apps/web/src/server.ts` and `apps/web/src/app/app.config.server.ts` (FR-003)

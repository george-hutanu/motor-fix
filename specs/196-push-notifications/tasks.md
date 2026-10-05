# Tasks: Set up push notifications

## Phase 1: server
- [X] T001 Add `web-push` and `@types/web-push`; `push_subscription` table, migration, Account relation (FR-001)
- [X] T002 Red tests for config, sender, routing, service, processor, controller, sign-out (FR-001..014, 016, 018..020)
- [X] T003 `push-config.ts`, `push.ts`, `libs/contracts` DTO, controller and service (FR-001..003, 018)
- [X] T004 `routing.ts`, `catalogue.ts`, templates, `notifications.service.ts`, `.processor.ts`, `.module.ts`, `.env.example`, app wiring (FR-007..014, 018..020)
- [X] T005 Delete devices on sign-out everywhere (FR-016)
- [X] T006 Regenerate `openapi.json` and `data-access`

## Phase 2: web
- [ ] T007 Red tests for `push-support`, `push-device`, `push-panel` (FR-004, 005, 017, 021)
- [ ] T008 `push-support.ts`, `push-device.ts`, `push-panel.ts`, `push-view.ts`, `views.ts`, `frame.ts` (FR-004..006, 016, 017, 021)
- [ ] T009 i18n texts `shell.push.*`
- [ ] T010 Playwright `apps/web-e2e/src/push.spec.ts` at 320 px (SC-004)

FR to test map is in the commit messages and final report.

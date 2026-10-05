# Tasks: Set up push notifications

## Phase 1: server
- [X] T001 Add `web-push` and `@types/web-push`; `push_subscription` table, migration, Account relation (FR-001)
- [X] T002 Red tests for config, sender, routing, service, processor, controller, sign-out (FR-001, FR-002, FR-003, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-016, FR-018, FR-019, FR-020)
- [X] T003 `push-config.ts`, `push.ts`, `libs/contracts` DTO, controller and service (FR-001, FR-002, FR-003, FR-018)
- [X] T004 `routing.ts`, `catalogue.ts`, templates, `notifications.service.ts`, `.processor.ts`, `.module.ts`, `.env.example`, app wiring; the payload ngsw shows (FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-018, FR-019, FR-020)
- [X] T005 Delete devices on sign-out everywhere (FR-016)
- [X] T006 Regenerate `openapi.json` and `data-access`

## Phase 2: web
- [X] T007 Red tests for `push-support`, `push-device`, `push-panel` (FR-004, FR-005, FR-017, FR-021)
- [X] T008 `push-support.ts`, `push-device.ts`, `push-panel.ts`, `push-view.ts`, `views.ts`, `frame.ts` (FR-004, FR-005, FR-006, FR-016, FR-017, FR-021)
- [X] T009 i18n texts `shell.push.*`
- [X] T010 Playwright `apps/web-e2e/src/push.spec.ts` at 320 px (SC-004)

FR to test map is in the commit messages and final report.

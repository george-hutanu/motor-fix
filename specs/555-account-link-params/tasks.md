# Tasks: Keep the account link out of stored notification params

**Input**: `specs/555-account-link-params/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `libs/domain/src/notifications/notifications.processor.integration.spec.ts` — an account e-mail's bell row holds no link (FR-001)
- [X] T002 [US1] Test: same file — an account e-mail sent through the mock carries the link and its row then holds none (FR-002)
- [X] T003 [US1] Test: same file — an account e-mail refused for good, or failed because sending was switched off, holds no link (FR-003)
- [X] T004 [US1] Test: same file — with sending off, the account e-mail row is written failed without the link (FR-003)
- [X] T005 [US1] Test: `apps/web-e2e/src/password-reset.spec.ts` reads the reset link from a Brevo stand-in (`apps/web-e2e/mailbox.mjs`) started by `playwright.config.mts` (FR-004)

## Phase 2: Implementation

- [X] T006 [US1] `libs/domain/src/notifications/notifications.service.ts`: the bell row and a row written failed leave out `link`; `fail()` and a new `forget()` remove it from rows marked failed (FR-001, FR-003)
- [X] T007 [US1] `libs/domain/src/notifications/notifications.processor.ts`: `sent()` removes it from rows marked sent (FR-002)

## Phase 3: Proof

- [ ] T008 `npx nx run domain:test` (unit and integration), `npm run typecheck` and `npm run lint` green (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `notifications.processor.integration.spec.ts` › T001 |
| FR-002 | `notifications.processor.integration.spec.ts` › T002 |
| FR-003 | `notifications.processor.integration.spec.ts` › T003, T004 |
| FR-004 | `password-reset.spec.ts` › T005 |

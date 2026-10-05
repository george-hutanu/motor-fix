# Tasks: Confirm my e-mail address

**Input**: specs/081-confirm-email/spec.md, plan.md

## Phase 1: Tests first (red)

- [X] T001 [P] Unit tests for the pure token and limit rules in `libs/domain/src/auth/email-confirmation.spec.ts` (FR-002, FR-008)
- [X] T002 [P] API integration tests in `libs/domain/src/auth/email-confirmation.api.integration.spec.ts`: sign-up queues the e-mail in the account's language with the link (FR-001, FR-012), confirm / already confirmed / expired / voided / other address / inactive / concurrent (FR-003, FR-004, FR-007, FR-010), resend by token and for the signed-in account with their refusals and limits (FR-005, FR-006, FR-008), `GET /me` `emailConfirmed` (FR-009), audit entry (FR-003)
- [X] T003 [P] `AccountsService` integration test: google/apple identity confirmed at creation (FR-011) in `libs/domain/src/auth/accounts.service.integration.spec.ts`
- [X] T004 [P] Seed test: seeded accounts confirmed (FR-016) in `libs/domain/src/seed.integration.spec.ts`
- [X] T005 [P] Web unit tests: banner (FR-013, FR-014) `apps/web/src/app/dashboard/email-banner.spec.ts`; page (FR-015) `apps/web/src/app/public/confirm-email.spec.ts`
- [X] T006 [P] End-to-end `apps/web-e2e/src/confirm-email.spec.ts`: sign up → banner → "Retrimite" toast; an unknown link → expired page → "Trimite un link nou" refused politely (FR-013, FR-015)
- [X] T007 API wiring test in `apps/api/src/public-routes.integration.spec.ts`: the confirm routes are public, `me/email-confirmation` is not (FR-003, FR-005, FR-006)

## Phase 2: API

- [X] T008 Prisma model `AccountToken` + migration (FR-002)
- [X] T009 `email-confirmation.ts` pure rules, `email-confirmation.service.ts`, controller, module; contracts DTOs (FR-002 … FR-010)
- [X] T010 Sign-up issues after creation; `createAccount` google/apple; `MeDto.emailConfirmed`; seed; audit-coverage exemption for the token bookkeeping (FR-001, FR-009, FR-011, FR-012, FR-016)
- [X] T011 Register in `AppModule`; regenerate `apps/api/openapi.json` and `libs/data-access`

## Phase 3: Web

- [X] T012 Banner in the dashboard frame, live event re-reads the account (FR-013, FR-014)
- [X] T013 Confirmation page and route (FR-015); RO/EN texts

## FR → test

| FR | Test |
| --- | --- |
| FR-001, FR-012 | email-confirmation.api.integration.spec.ts › sign-up |
| FR-002 | email-confirmation.spec.ts; api spec › stored as hash |
| FR-003, FR-004, FR-007, FR-010 | api spec › confirming |
| FR-005, FR-006, FR-008 | api spec › asking again; email-confirmation.spec.ts › limit |
| FR-009 | api spec › GET /me |
| FR-011 | accounts.service.integration.spec.ts |
| FR-013, FR-014 | email-banner.spec.ts; confirm-email e2e |
| FR-015 | confirm-email.spec.ts (web); confirm-email e2e |
| FR-016 | seed.integration.spec.ts |

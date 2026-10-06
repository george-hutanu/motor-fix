# Tasks: Accept the terms and the privacy notice at sign-up

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Setup

- [X] T001 [P] `libs/contracts/src/consent.ts` (new, constants only, alias `@motor-fix/contracts/consent` for the web): `TERMS_VERSION`, `PRIVACY_VERSION`, `CURRENT_CONSENT`; export from `libs/contracts/src/index.ts`; `ConsentDto` and `SignUpDto.consent` in `auth.dto.ts` (FR-001, FR-004)
- [X] T002 [P] Prisma: `ConsentKind` and `AccountConsent` in `libs/domain/prisma/schema/auth.prisma`; migration `libs/domain/prisma/migrations/20261005170000_account_consent/migration.sql`; regenerate the client (FR-002)

## Phase 2: User Story 1 — no account without consent (P1)

- [X] T003 [US1] `libs/domain/src/auth/consent.ts` (new): `Consent`, `isCurrentConsent`, `consentRequired` (used inside the lib only) (FR-001)
- [X] T004 [US1] `libs/domain/src/auth/accounts.service.ts`: `NewAccount.consent` required, refusal before the transaction, two consent rows and the audit entry in it (FR-001, FR-002, FR-003)
- [X] T005 [US1] `libs/domain/src/auth/sign-up.service.ts`: refuse without current consent after maintenance, pass it on (FR-004)
- [X] T006 [US1] Every other `createAccount` call (`libs/domain/src/notifications/notifications.testing.ts` and the integration specs) passes `CURRENT_CONSENT` (FR-001)
- [X] T007 [US1] Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-004)

## Phase 3: User Story 2 — the tick (P1)

- [X] T008 [US2] `apps/web/src/app/sign-in/consent.ts` (new) `Consent` component and `consentControl()`; texts `public.consent.*` in `libs/i18n/src/public/ro.json` and `libs/i18n/src/public/en.json` (FR-005, FR-006, FR-007)
- [X] T009 [US2] `apps/web/src/app/sign-in/sign-up.ts` places the tick above the button; `apps/web/src/app/dashboard/session.ts` sends `CURRENT_CONSENT` (FR-005, FR-006)

## Phase 4: User Story 3 — the texts (P2)

- [X] T010 [US3] `apps/web/src/app/public/legal-texts.ts` (new) draft texts RO and EN; `apps/web/src/app/public/legal.ts` (new) page; routes `terms`, `privacy` in `apps/web/src/app/app.routes.ts`; `PUBLIC_PATHS` in `apps/web/src/app/addresses.ts`; the version word and draft notice live beside the texts (FR-008)

## Phase 5: Polish

- [X] T011 Mark tasks, update `auto-run.md`; typecheck, lint, the touched Jest projects

## Dependencies

T001, T002 → T003 → T004 → T005, T006 → T007 → T008 → T009; T010 after T001.

## Tests (written first by `/speckit-tests`; FR → test)

| FR | Test file |
|----|-----------|
| FR-001 | `libs/domain/src/auth/consent.spec.ts`, `libs/domain/src/auth/consent.api.integration.spec.ts` |
| FR-002, FR-003, FR-004 | `libs/domain/src/auth/consent.api.integration.spec.ts` |
| FR-005, FR-006, FR-007 | `apps/web/src/app/sign-in/consent.spec.ts`, `apps/web/src/app/sign-in/sign-up.spec.ts`, `apps/web-e2e/src/sign-up-consent.spec.ts` |
| FR-008 | `apps/web/src/app/public/legal.spec.ts`, `apps/web/src/server/search.spec.ts`, `apps/web-e2e/src/sign-up-consent.spec.ts` |

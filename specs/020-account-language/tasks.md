# Tasks: Keep my language on my account for messages

**Input**: plan.md, spec.md, context.md, design.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/contracts/src/me.dto.ts`, `libs/domain/src/auth/accounts.service.ts`, `libs/domain/src/auth/me.controller.ts`, `apps/api/openapi.json`, `libs/data-access/src/lib/**`, `libs/i18n/src/switch.ts`, `libs/i18n/src/switch.spec.ts`, `apps/web/src/app/dashboard/session.ts`.

## Phase 1: US2 The account's language through the API (P1)

**Independent test**: PATCH with and without a token, valid and invalid bodies; read "who am I" and the audit history.

- [X] T001 [US2] Test: `libs/domain/src/auth/me-language.api.integration.spec.ts` — through `AuthModule` and the API's validation pipe, real PostgreSQL: no token / bad token / another key → 401 `sign_in_required`; a suspended account → 403 `account_suspended`; `en` in each of the five roles → 200 with the "who am I" body, equal to a later GET; back to `ro`; `fr`, `RO`, `""`, `1`, `{}` → 400 naming `language`; an extra field → 400 naming it; a body naming another account changes only the caller's; the language is unchanged after each refusal; a fresh account says `ro`. `apps/api/src/bootstrap.integration.spec.ts` — through `configureApp`: an unsigned PATCH answers the 401 problem; the OpenAPI document describes PATCH `/api/v1/me` with a `language` enum body (FR-001, FR-002, FR-003, FR-004)
- [X] T002 [US2] Test: `libs/domain/src/auth/me-language.api.integration.spec.ts` (audit block) — the change from `ro` to `en` writes one update entry on the account (field `language`, `ro` → `en`, actor the account in its role in use); setting the same language writes no entry and leaves the row as it was (FR-005)
- [X] T003 [US2] `libs/contracts/src/me.dto.ts` — `UpdateMeDto` (`language`, `IsIn(['ro','en'])`, swagger enum) (FR-001, FR-003)
- [X] T004 [US2] `libs/domain/src/auth/accounts.service.ts` — `setLanguage(actor, language)` in one transaction with `audit.recordChanges` (FR-004, FR-005)
- [X] T005 [US2] `libs/domain/src/auth/me.controller.ts` — `@Patch()` with `UpdateMeDto`, answering `MeDto` (FR-001, FR-002)
- [X] T006 [US2] Regenerate `apps/api/openapi.json` and the client: `npx nx run data-access:generate` (FR-001)

## Phase 2: US1 A signed-in switch saves (P1) and US3 signed out stays local (P2)

**Independent test**: with a stubbed "who am I", tap EN and see one PATCH; signed out, tap EN and see none.

- [X] T007 [US1] Test: `libs/i18n/src/switch.spec.ts` — tapping a switch button reports the language on `LanguageChoice.taps`; `choose()` (the address, the session) and a `storage` event from another tab report nothing; an invalid value reports nothing (FR-006, FR-008)
- [X] T008 [US1] Test: `apps/web/src/app/dashboard/session.language.spec.ts` — with a stubbed `MeService`: signed in, a tap on EN sends `{ language: 'en' }` once and the session holds the answer; a tap on the account's own language sends nothing; signed out, a tap sends nothing and the device remembers it; a failed save leaves the interface English, shows nothing, and the next tap (EN again) sends again; EN then RO quickly → one save at a time, the last sent is RO and the session ends on RO; an answer after a sign-out is dropped; loading the account's language does not save (FR-006, FR-007, FR-008, FR-009)
- [X] T009 [US1] `libs/i18n/src/switch.ts` — `LanguageChoice.pick()` and `taps`; the switch buttons call `pick` (FR-006, FR-008)
- [X] T010 [US1] `apps/web/src/app/dashboard/session.ts` — listen to `taps`; `saveLanguage` with one save in flight and the latest wanted language (FR-006, FR-007, FR-009)
- [X] T011 [US1] Test: `apps/web-e2e/src/account-language.spec.ts` — signed in (stubbed GET and PATCH `/api/v1/me`) on `/app/driver`: tap EN → one PATCH with `{"language":"en"}`, the frame is English; tap RO → PATCH `ro`; signed out on `/ro`: tap EN → no request to `/api/v1/me` with PATCH and the page is English; at 320 and 390 px, RO and EN, the switch keeps both buttons visible and 44 px tall (FR-006, FR-007, SC-001, SC-002)

## Phase 3: Polish

- [X] T012 Run `npm run typecheck`, `npm run lint`, the touched projects' Jest suites and the new e2e spec; record results in auto-run.md

## FR → test

| FR | Tests |
|----|-------|
| FR-001 | T001, T011 |
| FR-002 | T001 |
| FR-003 | T001 |
| FR-004 | T001 |
| FR-005 | T002 |
| FR-006 | T007, T008, T011 |
| FR-007 | T008, T011 |
| FR-008 | T007, T008 |
| FR-009 | T008 |

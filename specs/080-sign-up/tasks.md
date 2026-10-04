# Tasks: Create an account with e-mail and password

**Input**: spec.md, plan.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 [P] `libs/contracts/src/auth.dto.ts`: `SignUpDto` (`name` trimmed 2–80 without control characters, `email` trimmed ≤ 254 text@domain.tld without control characters, `password` string 1–1024, `language` `ro` | `en`), exported through `libs/contracts/src/index.ts` (FR-005)

## Phase 2: Foundational

- [X] T002 [P] `libs/domain/src/auth/common-passwords.ts` (new): `isCommonPassword(password)` over a lower-cased set with its source named (FR-004)
- [X] T003 [P] `libs/domain/src/auth/attempts.ts`: `admitSignUp(address)` — hourly per-address counter, 10 admitted, Redis errors admit and log (FR-006)
- [X] T004 `libs/domain/src/auth/sign-in.service.ts`: `openSession(accountId, role, remember)` public, used by `signIn` (FR-002)

## Phase 3: User Story 1 + 2 — the API (P1)

Independent test: sign up through HTTP against PostgreSQL and Redis; taken e-mail in another case, racing duplicate, weak and common passwords, bad bodies, form posts, the hourly limit, maintenance, Redis down, logs.

- [X] T005 [US1] `libs/domain/src/auth/sign-up.service.ts` (new): limit → maintenance → password rule → hash → `createAccount` (driver, password identity, language) → `openSession`; `P2002` → 409 `email_taken`; refusals logged by code only (FR-001, FR-002, FR-003, FR-004, FR-006, FR-007, FR-008)
- [X] T006 [US1] `libs/domain/src/auth/auth.controller.ts`: `POST auth/sign-up` (201, JSON only, cookie through `keep()`); `auth.module.ts` provides `SignUpService` (FR-002, FR-005)
- [X] T007 [US1] Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-001)

## Phase 4: User Story 1 + 2 — the dialog (P1)

- [X] T008 [US1] `apps/web/src/app/dashboard/session.ts`: `signUp(name, email, password, language)` keeps the token and loads "who am I" (FR-002, FR-013)
- [X] T009 [US1] `apps/web/src/app/sign-in/sign-up.ts` (new): the task — "MotorFix" and the driver blurb, Nume / E‑mail / Parolă with show/hide, local checks, busy state, coded messages, the switch back; closes with "signed-in" (FR-009, FR-010, FR-011, FR-012, FR-014)
- [X] T010 [US1] `apps/web/src/app/sign-in/sign-in.ts`: "Ești nou pe MotorFix? Creează un cont" under the main button, closing with the switch and the e-mail; an e-mail passed in is typed already (FR-009)
- [X] T011 [US1] `apps/web/src/app/sign-in/sign-in-dialog.ts`: the switch loop carrying the e-mail; the landing on "signed-in" (FR-009, FR-013)
- [X] T012 [P] [US1] Texts `public.signIn.newHere`, `public.signIn.createAccount`, `public.signUp.*` in `libs/i18n/src/public/ro.json` and `en.json`, U+2011 inside Romanian words (FR-014)

## Phase 4b: Review fixes

- [X] T014 [US2] `auth.controller.ts`: `JsonOnly` guard before validation for sign-in and sign-up, prototype-chain keys 400 (FR-015)
- [X] T015 [US2] `attempts.ts`: `clientOf()` keys every address by client — IPv4-mapped, IPv6 spellings, zone id, /64 (FR-016)

## Phase 5: End to end

- [X] T013 [US1] `apps/web-e2e/src/sign-up.spec.ts` (new): sign up and land signed in; the taken e-mail with the name kept (ST-494); empty, invalid and short fields send nothing; switching both ways; English; sizes × themes × languages with axe; keyboard (FR-003, FR-009, FR-010, FR-012, FR-013, FR-014)

## Dependencies

T001 → T005 → T006 → T007 → T008 → T009–T011; T002, T003, T004 before T005; T012 with T009–T010; T013 last.

## FR → test

| FR | Tests |
| --- | --- |
| FR-001 | `libs/domain/src/auth/sign-up.api.integration.spec.ts` |
| FR-002 | `sign-up.api.integration.spec.ts`; `apps/web/src/app/dashboard/session.signup.spec.ts` |
| FR-003 | `sign-up.api.integration.spec.ts`; `apps/web-e2e/src/sign-up.spec.ts` |
| FR-004 | `libs/domain/src/auth/common-passwords.spec.ts`; `sign-up.api.integration.spec.ts` |
| FR-005 | `sign-up.api.integration.spec.ts` |
| FR-006 | `sign-up.api.integration.spec.ts` |
| FR-007 | `sign-up.api.integration.spec.ts` |
| FR-008 | `sign-up.api.integration.spec.ts` |
| FR-009 | `apps/web/src/app/sign-in/sign-up.spec.ts`; `sign-in-dialog.spec.ts`; `sign-in.spec.ts`; `sign-up.spec.ts` (e2e) |
| FR-010 | `sign-up.spec.ts` (web); `sign-up.spec.ts` (e2e) |
| FR-011 | `sign-up.spec.ts` (web) |
| FR-012 | `sign-up.spec.ts` (web); `sign-up.spec.ts` (e2e) |
| FR-013 | `sign-in-dialog.spec.ts`; `sign-up.spec.ts` (e2e) |
| FR-014 | `sign-up.spec.ts` (web); `sign-up.spec.ts` (e2e) |
| FR-015 | `sign-up.api.integration.spec.ts`; `sign-in.api.integration.spec.ts`; `sign-up.adversary.integration.spec.ts` |
| FR-016 | `libs/domain/src/auth/attempts.spec.ts`; `sign-up.adversary.integration.spec.ts` |

# Tasks: Sign in with a phone number and a code sent by WhatsApp

**Input**: `specs/393-whatsapp-phone-sign-in/` (spec.md, plan.md, research.md, data-model.md, contracts/auth-phone.md, quickstart.md, design.md)

**Prerequisites**: plan.md, spec.md. Tests are required (FR-017, Constitution II): in every phase the failing specs come first (the red-first rule). No requirement id or `@traces` goes in source. Paths marked `(new)` do not exist yet; every other path was confirmed in a listing of 2026-10-06. Heavy commands run through `scripts/heavy.sh`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an unfinished task
- **[Story]**: US1 sign in with an existing account, US2 new number creates a driver, US3 code guards, US4 WhatsApp failure fallback, US5 maintenance

## Phase 1: Setup

- [X] T001 [P] Make `PHONE_SENDING`, `PHONE_ALLOWLIST`, `WHATSAPP_SENDER`, `WHATSAPP_TEMPLATES` readable by the api: update the comment in `.env.example` and add them to the e2e job env in `.github/workflows/ci.yml` (allow-list `+4070000*`, plan "Complexity Tracking") (FR-005, FR-017)

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the number normaliser, the DTOs, the code table, the template, the counters and the allow-list prefix every story uses.

### Tests first

- [X] T002 [P] Write failing `libs/contracts/src/phone.spec.ts` (new): `+40 722 123 456`, `0722-123-456`, `0040722123456` all give `+40722123456`; `+` then 7 to 15 digits, first not 0; letters, too short, too long give `null` (FR-001)
- [X] T003 [P] Add failing cases for `PhoneCodeDto` and `PhoneSignInDto` to `libs/contracts/src/auth.dto.spec.ts`: `phone` 1-32 characters normalising to E.164; `code` exactly `^\d{6}$`; `language` `ro|en`; `name` 2-80 trimmed, no control characters; only one of `name`/`consent` is a 400; unknown field refused (FR-001, FR-006, FR-011)
- [X] T004 [P] Add failing cases to `libs/domain/src/notifications/phone-config.spec.ts`: an allow-list entry ending in `*` matches a number by prefix, an entry without `*` still matches exactly (FR-017)
- [X] T005 [P] Add failing cases to `libs/domain/src/auth/attempts.spec.ts`: `admitPhoneCode` counts 60 s (limit 1), hourly (limit 5) and per-address (limit 20) windows with `INCR` + `EXPIRE NX` in one `MULTI`, keyed by `sha256(phone)`, fixed from the first request; `uncountPhoneCode` decrements the hourly count; a Redis error admits and logs (FR-004)
- [X] T006 [P] Add a failing case for `SIGN_IN_CODE` to `libs/domain/src/notifications/catalogue.spec.ts`: the registry renders the WhatsApp text in `ro` and `en` with `{code}` and `{minutes}`, and nothing else (no link, no name) (FR-002)

### Implementation

- [X] T007 [P] Create `normalisePhone(input): string | null` in `libs/contracts/src/phone.ts` (new) and export it from `libs/contracts/src/index.ts` (T002 green) (FR-001)
- [X] T008 Add `PhoneCodeDto`, `PhoneSignInDto`, `PhoneSessionDto` to `libs/contracts/src/auth.dto.ts`, reusing `normalisePhone` and `ConsentDto` (T003 green; depends on T007) (FR-001, FR-006, FR-011)
- [X] T009 [P] Add `model SignInCode` (`phone String @id`, `codeHash String`, `expiresAt DateTime`, `attempts Int @default(0)`, `usedAt DateTime?`, `createdAt DateTime @default(now())`, `@@map("sign_in_code")`, snake_case field maps) to `libs/domain/prisma/schema/auth.prisma` and write `libs/domain/prisma/migrations/20261006090000_sign_in_code/migration.sql` (new), stamp after `20261005170000_notification_claim`; regenerate the Prisma client (FR-003)
- [X] T010 [P] Make an allow-list entry ending in `*` match by prefix in `libs/domain/src/notifications/phone-config.ts` (T004 green) (FR-017)
- [X] T011 [P] Add `admitPhoneCode` and `uncountPhoneCode` to `libs/domain/src/auth/attempts.ts` (T005 green) (FR-004)
- [X] T012 [P] Create `libs/domain/src/notifications/templates/sign-in-code.ts` (new) with the ro/en WhatsApp texts (`motorfix_sign_in_code_ro`, `motorfix_sign_in_code_en`, slots `{code}`, `{minutes}`) and register `SIGN_IN_CODE` in `libs/domain/src/notifications/templates/registry.ts` (T006 green) (FR-002)

**Checkpoint**: contracts, table, template and counters exist; no route yet.

---

## Phase 3: User Story 1 - An account holder signs in with phone and code (P1) MVP

**Goal**: a number matching an account of any role, with a verified phone, signs in with a WhatsApp code and gets the session a password sign-in gives.

**Independent Test**: seed a garage owner with verified +40722123456, request a code for `0722 123 456` against the Brevo mock, read the code, send it; the answer is a garage session and `/app/garage` opens.

### Tests first

- [X] T013 [P] [US1] Write failing `libs/domain/src/auth/phone-sign-in.spec.ts` (new), no database: the code is six digits with leading zeros allowed from `node:crypto`, the stored value is a base64url HMAC-SHA256 keyed with the API token secret and never the code, the check order of data-model.md (no row, cap, used, expiry, hash) (FR-001, FR-003, FR-006)
- [X] T014 [P] [US1] Write failing `libs/domain/src/auth/phone-sign-in.api.integration.spec.ts` (new) on real PostgreSQL and Redis with `BrevoMock`: 202 for a known and for an unknown number with the same body; the message goes to `+40722123456` with params `[code, "5"]` and the template of the request language; the right code signs a garage owner in with `accessToken` and the `mf_refresh` cookie honouring `remember`, role in use as password sign-in; an account of each role signs in and no account or role is created; a verified-phone account with no identity row gets no new row; the three number spellings match one account; a number not possible is 400 `validation_failed`; on both routes a body not sent as JSON is refused as `JsonOnly` refuses it, a body with a `__proto__` or `constructor` key is 400, and the log lines captured over a full send-and-sign-in hold neither the number nor the code (FR-001, FR-002, FR-007, FR-011, FR-017)
- [X] T015 [P] [US1] Add failing cases to `apps/web/src/app/sign-in/sign-in.spec.ts` (the "sau" divider and the button "Continuă cu telefonul" / "Continue with phone") and `apps/web/src/app/sign-in/sign-in-dialog.spec.ts` (a `phone` lap and back to `sign-in`) (FR-012)
- [X] T016 [P] [US1] Write failing `apps/web/src/app/sign-in/phone-sign-in.spec.ts` (new): phone step shows "Număr de telefon" with `+40`, `type=tel`, `autocomplete=tel`, remember ticked, "Trimite codul", link back to e-mail; a number that is not possible shows the problem under the field and sends nothing; code step shows the number, a 6-digit field (`inputmode=numeric`, `autocomplete=one-time-code`), a 5:00 countdown, "Intră în cont", "Trimite din nou" disabled for 60 s; the sixth digit does not send; focus moves to the new step's first control; the typed number survives a switch to e-mail and back (FR-012, FR-013)
- [X] T017 [P] [US1] Add failing `POST /v3/whatsapp/sendMessage` and `GET /whatsapp?to=` expectations to the stub contract by writing `apps/web-e2e/src/phone-sign-in.spec.ts` (new, relative imports carry `.js`): the existing-account path asks for a code for a seeded garage owner's number, reads it from the stub and lands on `/app/garage` (FR-017)

### Implementation

- [X] T018 [US1] Create `libs/domain/src/auth/phone-sign-in.service.ts` (new): `issue(phone, language, address)` (counters, 6-digit code, `upsert` of `SignInCode` that voids the old row, Brevo WhatsApp send with a 5 s timeout, rendered `SIGN_IN_CODE`) and `signIn(dto, address)` for a matching account: identity `whatsapp_phone` first, then account with verified phone; claim with `updateMany({ where: { phone, usedAt: null, attempts: { lt: 5 } } })` and open the session through `SignInService.openSession` (T013, T014 green for this story) (FR-001, FR-002, FR-003, FR-007, FR-009)
- [X] T019 [US1] Create `libs/domain/src/auth/phone-sign-in.controller.ts` (new): `@Public()` `POST auth/phone-code` (202, no body) and `POST auth/phone-sign-in` (200 `PhoneSessionDto`, sets the cookie), `JsonOnly`, problem details (FR-001, FR-006, FR-011)
- [X] T020 [US1] Create `libs/domain/src/auth/phone-sign-in.module.ts` (new, `register({ brevo, phone })`: it sends nothing through the notifications, so it takes neither them nor a web URL; the pure code helpers sit in `phone-sign-in.ts` beside it); export it from `libs/domain/src/index.ts`; register it in `apps/api/src/app.module.ts` (FR-011)
- [X] T021 [US1] Add the two routes to `apps/api/src/public-routes.integration.spec.ts`; regenerate `apps/api/openapi.json` (`npx nx run api:openapi`) and `libs/data-access/src/lib/` (`npx nx run data-access:generate`), never by hand (FR-011)
- [X] T022 [P] [US1] Add `phoneCode(...)` and `signInWithPhone(...)` to `apps/web/src/app/dashboard/session.ts` (FR-012)
- [X] T023 [P] [US1] Add the `signIn.phone.*` and `signIn.problem.*` texts for the phone and code steps to `libs/i18n/src/public/ro.json` and `libs/i18n/src/public/en.json` (Romanian hyphenated words with U+2011) (FR-016)
- [X] T024 [US1] Create `apps/web/src/app/sign-in/phone-sign-in.ts` (new, `mf-phone-sign-in`): phone and code steps, countdown, resend lock, focus, live region, offline message, `normalisePhone` before sending (T016 green; depends on T022, T023) (FR-012, FR-013)
- [X] T025 [US1] Add the "sau" divider and "Continuă cu telefonul" to `apps/web/src/app/sign-in/sign-in.ts` and the `phone` lap to `apps/web/src/app/sign-in/sign-in-dialog.ts` (T015 green) (FR-012)
- [X] T026 [US1] Extend `apps/web-e2e/mailbox.mjs` with `POST /v3/whatsapp/sendMessage` recording and `GET /whatsapp?to=` (T017 green for the existing-account path) (FR-017)

**Checkpoint**: an account holder signs in by phone; story demoable.

---

## Phase 4: User Story 2 - A new number creates a driver account (P1)

**Goal**: a number with no account, after the right code, a name and the consent, becomes a driver account with the phone verified.

**Independent Test**: unknown number, right code answers `{ next: "profile" }`; the same code with name and consent creates the account, identity, consents, one audit entry and one `account.created` event; `/app/driver` opens.

### Tests first

- [X] T027 [P] [US2] Add failing cases to `libs/domain/src/auth/phone-sign-in.api.integration.spec.ts`: no account and no name/consent gives 200 `{ "next": "profile" }`, no cookie, the code stays live and the attempt count is unchanged; name 2-80 trimmed plus current consent creates in one transaction a `driver`-only account in the request language with `phoneVerifiedAt` set, identity `whatsapp_phone`, `terms` and `privacy_notice` consent rows with method `whatsapp_phone`, one "account created" audit row and one `account.created` event; a stale or unticked consent is 400 `consent_required`; a matched number ignores `name`, `consent`, `language`; an account with an unverified phone answers 409 `phone_taken` with the code spent; a deleted account's number answers 409 `phone_taken` (FR-007, FR-008, FR-009)
- [X] T028 [P] [US2] Add failing cases to `apps/web/src/app/sign-in/phone-sign-in.spec.ts`: profile step shows "Nume", the shared consent control and "Creează contul"; a missing or over-long name or an unticked box shows its problem and sends nothing, the code stays valid; the completing call sends the same code with name and consent; expiry on this step returns to the code step with "Trimite din nou"; a new account opened from "Autentificare" lands on `/app/driver`, from the gate resolves "signed in"; a typed name holding `<img src=x>` is never rendered as markup (FR-015, FR-016)
- [X] T029 [P] [US2] Add the new-number path to `apps/web-e2e/src/phone-sign-in.spec.ts` with a fresh number under the `+4070000*` prefix each run: code, name and tick, `/app/driver` (FR-008, FR-015, FR-017)

### Implementation

- [X] T030 [US2] Extend `signIn` in `libs/domain/src/auth/phone-sign-in.service.ts`: the `next: 'profile'` answer, the `phone_taken` cases, and creation through `AccountsService.createAccount` with method `whatsapp_phone`, consent versions and request language, the code claimed by a `before` step that opens the account's transaction (T027 green) (FR-007, FR-008)
- [X] T031 [P] [US2] Add the `signIn.profile.*` texts (and `signIn.code.problem.consent_required`) to `libs/i18n/src/public/ro.json` and `libs/i18n/src/public/en.json` (FR-016)
- [X] T032 [US2] Add the profile step to `apps/web/src/app/sign-in/phone-sign-in.ts` using the consent control in `apps/web/src/app/sign-in/consent.ts` (T028, T029 green; depends on T031) (FR-015)

**Checkpoint**: both stories work end to end.

---

## Phase 5: User Story 3 - A code is single-use, short-lived and guarded (P1)

**Goal**: 5 minutes, one use, 5 wrong attempts, 60 s resend, 5 per hour per number, 20 per hour per address, a new code voids the old one.

**Independent Test**: the API specs of SC-002 and SC-003 pass.

### Tests first

- [x] T033 [P] [US3] Add failing cases to `libs/domain/src/auth/phone-sign-in.api.integration.spec.ts`: a used code is 401 `code_invalid`; a code at 5 minutes is 410 `code_expired`; a wrong code is 401 `code_invalid` with `attemptsLeft` 4, 3, 2, 1; after 5 wrong attempts the right code is 429 `too_many_attempts` and stays so until a new code; a second code within 60 s and a 6th within the hour are 429 and send nothing; the 21st request from one address in the hour is 429; a second code makes the first 401; two concurrent uses of one right code open exactly one session (the other 401); two concurrent requests leave exactly one live code; Redis unreachable skips the three counters and logs, while expiry, single use and the 5 attempts still hold (FR-003, FR-004, FR-006, FR-009)
- [x] T034 [P] [US3] Add failing cases to `apps/web/src/app/sign-in/phone-sign-in.spec.ts`: "Codul nu este corect." with attempts left; "Codul a expirat. Cere un cod nou."; the too-many text; the countdown at 0:00 disables the code field and offers only "Trimite din nou"; a pending request disables the main button and a second tap sends nothing (FR-013, FR-014)

### Implementation

- [x] T035 [US3] Complete the check order, `attemptsLeft`, concurrent-claim handling and the three counters (with fail-open) in `libs/domain/src/auth/phone-sign-in.service.ts` and map the problem codes in `libs/domain/src/auth/phone-sign-in.controller.ts` (T033 green) (FR-004, FR-006, FR-009)
- [x] T036 [P] [US3] Add `attemptsLeft` to the `code_invalid` problem in `libs/contracts/src/problem.ts` (FR-006, FR-014)
- [x] T037 [US3] Show each refusal in the live region and the countdown behaviour in `apps/web/src/app/sign-in/phone-sign-in.ts`; add the matching `signIn.problem.code*` texts to `libs/i18n/src/public/ro.json` and `libs/i18n/src/public/en.json` (T034 green) (FR-013, FR-014)

---

## Phase 6: User Story 4 - WhatsApp cannot deliver, the e-mail door is one tap away (P2)

**Goal**: a Brevo failure, a missing template or sending off answers 502 `whatsapp_failed`, stores no code and shows the fallback.

**Independent Test**: the stub refuses the call; the API answers `whatsapp_failed`, no row, and the dialog shows the fallback with the e-mail link.

### Tests first

- [x] T038 [P] [US4] Add failing cases to `libs/domain/src/auth/phone-sign-in.api.integration.spec.ts`: Brevo refusal and a 5 s timeout, `PHONE_SENDING` off, a number outside the non-production allow-list and a template without an id each answer 502 `whatsapp_failed`, store no `sign_in_code` row, do not count toward the hourly five, and log the failure kind without the number or code (FR-004, FR-005)
- [x] T039 [P] [US4] Add failing cases to `apps/web/src/app/sign-in/phone-sign-in.spec.ts`: "Nu am putut trimite codul pe WhatsApp." with a link back to e-mail and password; offline shows the shared offline message on request and on entry (FR-014)
- [x] T040 [P] [US4] Add the refusing stub case to `apps/web-e2e/src/phone-sign-in.spec.ts`: a number the stub refuses shows the fallback message and the e-mail link (FR-005, FR-017)

### Implementation

- [x] T041 [US4] Make `issue` in `libs/domain/src/auth/phone-sign-in.service.ts` send before storing, answer `whatsapp_failed` on every failure above, and call `uncountPhoneCode` (T038 green) (FR-004, FR-005)
- [x] T042 [US4] Add the fallback block and offline handling to `apps/web/src/app/sign-in/phone-sign-in.ts` and its `signIn.problem.whatsapp*` texts to `libs/i18n/src/public/ro.json` and `libs/i18n/src/public/en.json` (T039, T040 green) (FR-014)

---

## Phase 7: User Story 5 - Maintenance keeps the admin door open (P3)

**Goal**: under maintenance only an admin's number gets a code and signs in.

**Independent Test**: maintenance on, a driver's and an unknown number answer 503 `maintenance` and send nothing; an admin signs in.

### Tests first

- [x] T043 [P] [US5] Add failing cases to `libs/domain/src/auth/phone-sign-in.api.integration.spec.ts`: under maintenance `phone-code` is 503 for a non-admin and an unknown number, sends nothing and stores nothing, and gives an admin's number its code; a non-admin's right code turns 503 `maintenance` with the code spent when maintenance came on after sending; an admin signs in; a suspended account's right code is 403 `account_suspended` with the code spent (FR-010, FR-011)
- [x] T044 [P] [US5] Add a failing case to `apps/web/src/app/sign-in/phone-sign-in.spec.ts`: 503 `maintenance`, 403 `account_suspended` and 409 `phone_taken` show their shared messages (FR-014)

### Implementation

- [x] T045 [US5] Add the maintenance and suspension checks to `issue` and `signIn` in `libs/domain/src/auth/phone-sign-in.service.ts` using the same maintenance reading as the e-mail sign-in (T043 green) (FR-007, FR-010)
- [x] T046 [US5] Map the three answers to their messages in `apps/web/src/app/sign-in/phone-sign-in.ts` (T044 green) (FR-014)

---

## Phase 8: Polish

- [x] T047 [P] Add a 320 px, 390 px, tablet and desktop, light and dark, ro and en walk of the three steps to `apps/web-e2e/src/phone-sign-in.spec.ts` asserting no sideways scroll (SC-004, FR-016)
- [x] T048 Run `quickstart.md` end to end and note the result in `specs/393-whatsapp-phone-sign-in/auto-run.md` (FR-017)

---

## Dependencies & Execution Order

- Phase 1 and the Phase 2 tests start at once; Phase 2 implementation follows its tests (T008 after T007). Phase 2 blocks every story.
- US1 first (it creates the service, controller, module, dialog step and e2e spec). US2 to US5 extend the same files, so they run in order US2, US3, US4, US5; within each, tests before implementation. US3 to US5 test tasks `[P]` touch different files from each other only across the API spec, web spec and e2e spec.
- Polish after all stories.

## Parallel Example

```text
Phase 2 tests: T002, T003, T004, T005, T006
Phase 3 tests: T013, T014, T015, T016, T017
```

## Implementation Strategy

MVP is Phase 1 + 2 + US1 (an account holder signs in by phone). Then US2 (new number), US3 (guards, required before any real send), US4, US5. Stop at each checkpoint, run `scripts/heavy.sh` for the affected Nx targets, commit one Conventional Commit per slice.

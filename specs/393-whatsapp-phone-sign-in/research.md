# Research: Sign in with a phone number and a code sent by WhatsApp

Every decision below was taken against the code as it is on the branch (read 2026-10-06); no version or API comes from memory.

## R1 — Where the code lives: a `sign_in_code` row keyed by the E.164 number

- **Decision**: a new Prisma model `SignInCode` in `libs/domain/prisma/schema/auth.prisma`, primary key `phone` (E.164), with `codeHash`, `expiresAt`, `attempts`, `usedAt`, `createdAt`. Issuing a code is one `upsert` on `phone`: the new row replaces the old one, so "voided by a newer code" is the row being overwritten and two concurrent requests leave exactly one row (FR-003). Expired rows are overwritten by the next request for that number; nothing sweeps them.
- **Rationale**: Constitution VI (Redis never holds the only copy). `AccountToken` (`auth.prisma`, model `AccountToken`) is the repo's shape for a short-lived secret, but it hangs on `accountId`, and a new number has no account; a row keyed by the number is the smallest change. Attempts live on the row so the 5-attempt cap holds when Redis is down (spec edge case).
- **Alternatives considered**: reuse `AccountToken` with a nullable account (changes an existing model and its `@@index([accountId, purpose])`); a Redis hash `signin:code:{phone}` (the brief's proposal; rejected by Constitution VI and the spec's assumption).
- **Evidence**: `libs/domain/prisma/schema/auth.prisma` models `Account`, `AccountToken`; `libs/domain/src/auth/password-reset.service.ts:182-195` (deleteMany + create of the previous pattern); `.specify/memory/constitution-card.md` principle VI.

## R2 — Hashing a 6-digit code: HMAC-SHA256 keyed with the API's token secret

- **Decision**: `createHmac('sha256', tokenSecret).update(code).digest('base64url')`, compared with `timingSafeEqual`. The key is `AuthOptions.tokenSecret`, already injected as `AUTH_OPTIONS` into `SignInService`.
- **Rationale**: a plain SHA-256 of six digits is a 10^6-entry dictionary: anyone reading the table reads the codes. A keyed hash makes the row useless without the secret, with no new configuration and no new dependency (spec Assumptions: "the plan decides whether the hash is keyed").
- **Alternatives considered**: argon2 as the password hash (`libs/domain/src/auth/password.ts`): a per-attempt cost the 5-attempt cap already provides, and slower on every request; plain SHA-256 as `hashToken` in `email-confirmation.ts:9` uses for 32-byte tokens (fine for 256-bit tokens, not for 20-bit codes).
- **Evidence**: `libs/domain/src/auth/sign-in.service.ts:76,343-345` (`AUTH_OPTIONS`, `tokenSecret`); `libs/domain/src/auth/email-confirmation.ts:9-10`; Node `node:crypto` `createHmac`, `timingSafeEqual` (Node 26.5.0, `node --version`).

## R3 — Phone normalisation: local code in `libs/contracts`, no phone library

- **Decision**: `libs/contracts/src/phone.ts` exports `normalisePhone(input: string): string | null`: strip spaces, dots, dashes and parentheses; `00…` → `+…`; a national Romanian number starting with `0` → `+40…`; the result must match `^\+[1-9]\d{6,14}$` (the E.164 shape `phone-config.ts` already uses) or `null`. The DTO and the dialog both call it: the dialog for the field check (FR-012), the API before anything else (FR-001). Other countries pass when written with their country code (spec Assumptions).
- **Rationale**: Constitution I: ~15 lines cover the spec's three spellings (+40 722 123 456, 0722-123-456, 0040722123456). `libphonenumber-js` 1.13.14 is in the lockfile only as `class-validator`'s dependency (`package-lock.json:15395`), not ours; adding it to the web bundle for one field is bloat, and relying on a transitive dependency breaks on `class-validator`'s next release.
- **Alternatives considered**: `@IsPhoneNumber('RO')` from class-validator (uses libphonenumber-js server-side only; the dialog would still need its own check and the two would disagree); `libphonenumber-js` as a direct dependency (full metadata ≈ 145 kB in the web bundle).
- **Evidence**: `libs/domain/src/notifications/phone-config.ts:18` (`E164` regex); `package-lock.json:15395,21137-21139`; `apps/web/src/app/sign-in/sign-up.ts:1` imports `@motor-fix/contracts` from the web, `apps/web-e2e/src/password-reset.spec.ts:1` imports `@motor-fix/contracts/consent`.

## R4 — Sending the code from the API request, through the shared `Brevo` client and the template registry

- **Decision**: a `PhoneSignInModule.register(options, notifications)` in `libs/domain/src/auth`, registered by `apps/api/src/app.module.ts` as `PasswordResetModule` is. It provides `Brevo` (built from `EmailConfig.apiKey` and `apiUrl`, timeout 5 s) and `PHONE_CONFIG` (`phoneConfig(env.APP_ENV, process.env)`, as the worker does). The service renders `render('SIGN_IN_CODE', 'whatsapp', language, { code, minutes: 5 })`, maps the name to `phone.whatsappTemplates[name]`, checks `phoneBlockedReason(phone, number)`, and calls `brevo.sendWhatsApp({...})`. Any `BrevoError`, `TemplateError`, blocked reason or missing template id answers 502 `whatsapp_failed` and stores no code (the row is written only after Brevo accepts). No NOTIFICATION row (FR-002).
- **Rationale**: the brief wants the request to answer whether the message went (scenario 9); the notifications queue is consumed by the worker (`NotificationsModule.registerWorker`), asynchronous, and `notify` needs a recipient account (`sendAccountEmail` takes `accountId`). The `Brevo` class and `render` are the one implementation of Brevo WhatsApp and of the templates (Constitution V); the API only gains an instance and the phone config.
- **Alternatives considered**: a job on the `notifications` queue and a poll for its result (two round trips, a NOTIFICATION row needing an account); a second HTTP client in the auth module (duplicate of `brevo.ts`).
- **Evidence**: `libs/domain/src/notifications/brevo.ts:73-80,47-51`; `libs/domain/src/notifications/notifications.module.ts:91-120` (API registration has no `Brevo` or `PHONE_CONFIG`), `:123-143` (worker has both); `apps/worker/src/main.ts:27` (`phoneConfig(env.APP_ENV, process.env)`); `libs/domain/src/notifications/notifications.processor.ts:293-320` (the worker's WhatsApp send, mirrored); `libs/domain/src/auth/password-reset.module.ts` (the registration pattern); `apps/api/src/app.module.ts:25-29,44`.

## R5 — The SIGN_IN_CODE WhatsApp template

- **Decision**: `libs/domain/src/notifications/templates/sign-in-code.ts` exports `SIGN_IN_CODE: Template` with `audience: 'any'`, `values: { code: 'text', minutes: 'num' }`, `example: { code: '123456', minutes: 5 }`, and `whatsapp: { ro: { name: 'motorfix_sign_in_code_ro', slots: ['{code}', '{minutes}'] }, en: { name: 'motorfix_sign_in_code_en', slots: [...] } }`; added to `templates/registry.ts`. The approved texts in Brevo hold only the code and the validity ("Codul tău MotorFix este {{1}}. Este valabil {{2}} minute." / "Your MotorFix code is {{1}}. It is valid for {{2}} minutes."), registered by the owner under `WHATSAPP_TEMPLATES` (outside step, spec Assumptions).
- **Rationale**: ST-392's shape (`DUE_ITP` has only `whatsapp` texts, one Brevo name per language); the catalogue already lists `SIGN_IN_CODE: ['direct', ['whatsapp'], null, 'transactional']`; the template check (`template-check.ts`) refuses a `phone` value, which the template does not use.
- **Alternatives considered**: a hard-coded template id in env (duplicates `WHATSAPP_TEMPLATES`).
- **Evidence**: `libs/domain/src/notifications/templates/due-itp.ts:14-17`; `libs/domain/src/notifications/catalogue.ts:116`; `libs/domain/src/notifications/templates.ts:32-35,205-208`; `libs/domain/src/notifications/template-check.ts:23-37`.

## R6 — Request limits: three counters in `Attempts`, counts only, fail-open

- **Decision**: `Attempts.admitPhoneCode(phone, address)` with keys `auth:code:minute:<sha256(phone)>` (TTL 60 s, limit 1), `auth:code:hour:<sha256(phone)>` (TTL 3600 s, limit 5) and `auth:code:address:<sha256(client)>` (TTL 3600 s, limit 20), each `INCR` + `EXPIRE … NX` in one `MULTI`, as `admitReset` does; any Redis error logs and admits. `Attempts.uncountPhoneCode(phone)` decrements the hour key after a `whatsapp_failed` answer (FR-004: the failed request does not count toward the hourly share; the 60-second key stays so a failing Brevo is not hammered).
- **Rationale**: the fixed-window-from-first-request semantics the clarification chose is exactly `EXPIRE NX`; the address is keyed through `clientOf` (080-FR-016). 20 per address mirrors `LIMIT.address` for sign-in.
- **Alternatives considered**: a sorted-set sliding window (more code, not asked); counting in PostgreSQL (the brief and the spec put the counters in Redis).
- **Evidence**: `libs/domain/src/auth/attempts.ts:11,109-150` (`LIMIT.address = 20`, `admitSignUp`, `admitReset`); `libs/domain/src/auth/auth.module.ts:26-36` (2-second Redis timeouts).

## R7 — Test infrastructure: the e2e stub records WhatsApp, the allow-list takes a prefix

- **Decision**: `apps/web-e2e/mailbox.mjs` also records `POST /v3/whatsapp/sendMessage` and serves `GET /whatsapp?to=<digits>`; the CI e2e job sets `PHONE_SENDING=on`, `WHATSAPP_SENDER=+40700000000`, `WHATSAPP_TEMPLATES=motorfix_sign_in_code_ro=1,motorfix_sign_in_code_en=2` and `PHONE_ALLOWLIST=+4070000*`. `phone-config.ts` accepts an entry ending in `*` as a prefix (one line in `phoneBlockedReason`, validated as `+digits*`), so each e2e run uses a fresh number (`+4070000` + 7 digits from the clock) and always takes the new-number path. Jest API specs use `BrevoMock` (`brevo-mock.testing.ts`), which already answers `/whatsapp/sendMessage`.
- **Rationale**: FR-017 asks for a Playwright test "with a Brevo stub" that reads the code; the exact-match allow-list cannot hold a number chosen at run time, and reusing one fixed number would sign in to the account a previous local run created instead of creating one.
- **Alternatives considered**: a fixed allow-listed number and a test that branches on whether the profile step appears (non-deterministic coverage of FR-008); `APP_ENV=test` bypassing the allow-list (weakens the guard everywhere).
- **Evidence**: `apps/web-e2e/mailbox.mjs:24-45`; `.github/workflows/ci.yml:125-138`; `libs/domain/src/notifications/phone-config.ts:20-29,66-73`; `libs/domain/src/notifications/brevo-mock.testing.ts:22-26`; `apps/web-e2e/src/password-reset.spec.ts:14-35` (polling the mailbox).

## R8 — The dialog: a sibling task `mf-phone-sign-in`, reached through the existing switch

- **Decision**: `apps/web/src/app/sign-in/phone-sign-in.ts` holds the phone, code and profile steps as one component with a `step` signal; `sign-in.ts` gains the "sau" divider and the button "Continuă cu telefonul", which closes with `{ switchTo: 'phone', email }`; `SignInDialog.laps` opens the new task under the same title `public.signIn.title` (so the dialog stays "Autentificare"), and the task closes with `'signed-in'` or `{ switchTo: 'sign-in' }`. `Session.signInWithPhone(...)` wraps the generated `authControllerPhoneSignIn` as `signIn` and `signUp` wrap theirs. Field errors, the answer's message and the sending state come from `taskSave`, `mf-field-error`, `mf-task-error` and `mfTaskSubmit`; the countdown is a `signal` ticked by `setInterval`, cleared in `DestroyRef`.
- **Rationale**: the brief says "the number step and the code step in the same dialog"; the dialog here is the overlay, whose content the laps already swap for sign-up and reset. Keeping the three steps out of `sign-in.ts` (182 lines) keeps each task readable; one component for the three steps because they share the number, the code and the `remember` choice.
- **Alternatives considered**: steps inside `sign-in.ts` (a 400-line component); three components (the number and code must travel between them).
- **Evidence**: `apps/web/src/app/sign-in/sign-in-dialog.ts:79-106`; `apps/web/src/app/sign-in/sign-in.ts:33-41,163-168`; `apps/web/src/app/sign-in/password-reset.ts:50-84` (two states in one task); `apps/web/src/app/dashboard/session.ts:88-115`.

## R9 — Response shapes and the profile step

- **Decision**: `POST /auth/phone-code` answers `202` with no body for every allowed number. `POST /auth/phone-sign-in` answers `200 PhoneSessionDto`: `{ accessToken }` with the refresh cookie when a session opened, or `{ next: 'profile' }` when the right code met no account and the body had no name or consent. The completing call sends the same code with `name` and `consent` and answers `{ accessToken }` (201 is not used: the same route answers both).
- **Rationale**: one DTO keeps the generated client simple (`ng-openapi-gen` 1.1.0 has no discriminated unions); the spec fixes `{ "next": "profile" }`.
- **Evidence**: `libs/contracts/src/auth.dto.ts` (`SessionDto`, `ConsentDto`); `libs/data-access/project.json:11`; `package.json:69`.

## R10 — Concurrency of the right code

- **Decision**: the right code is spent by `updateMany({ where: { phone, usedAt: null, attempts: { lt: 5 } }, data: { usedAt } })`; a count of 0 answers 401 `code_invalid`. Only the request that spent it goes on to `openSession` or `createAccount`. For a new account, `createAccount` runs its own transaction; a `P2002` on `phone` or on the identity answers 409 `phone_taken` (the code is spent, as the spec says for a taken number).
- **Rationale**: the atomic claim is what makes two concurrent uses open exactly one session (FR-009, SC-003), the same shape as `rotate` in `sign-in.service.ts` and `complete` in `password-reset.service.ts`. Wrapping `openSession` into the same transaction would mean threading a `tx` through `SignInService.openFamily`, a change to a shared method for a failure (the session insert failing after the claim) that leaves the person one "Trimite din nou" away.
- **Evidence**: `libs/domain/src/auth/sign-in.service.ts:312-334`; `libs/domain/src/auth/password-reset.service.ts:129-135`; `libs/domain/src/auth/sign-up.service.ts:39-41,99-107` (`P2002` → taken).

## Open

- None: every `NEEDS CLARIFICATION` of the Technical Context is resolved above. Notion's architecture pages were not read (`context.md` is `[UNAVAILABLE: notion]`); the plan rests on the story's Build brief and the code.

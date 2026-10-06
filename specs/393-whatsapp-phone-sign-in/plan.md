# Implementation Plan: Sign in with a phone number and a code sent by WhatsApp

**Branch**: `393-whatsapp-phone-sign-in` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/393-whatsapp-phone-sign-in/spec.md`; the owner's design in [design.md](./design.md) (the mock could not be opened; the Build brief's Screens section is the source, and the phone option is not designed); `context.md` is `[UNAVAILABLE: notion]`, so no Notion constraint feeds this plan beyond the story page the spec cites.

## Summary

A visitor types a phone number in the sign-in dialog, receives a six-digit code on WhatsApp and types it back; the API opens a session for the account holding that number or, for a new number, asks for a name and the consent tick and creates the account with the phone verified. Two public routes on the existing `AuthController`'s module tree (`POST /auth/phone-code`, `POST /auth/phone-sign-in`), one new table `sign_in_code` keyed by the E.164 number holding an HMAC of the code (PostgreSQL is the truth; Redis keeps only the three fail-open counters in `Attempts`), the code sent synchronously from the request through the shared `Brevo` WhatsApp client and the `SIGN_IN_CODE` template, and one new overlay task `mf-phone-sign-in` (phone, code and profile steps) reached from a "sau" divider in `mf-sign-in`. Decisions and their evidence: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:76`), Node `>=24.0.0` (`package.json:83`; local `v26.5.0`). `tsconfig.base.json`: `module: esnext`, `moduleResolution: bundler`, `target: es2023`. `libs/domain/tsconfig.json`: `module: commonjs`. `apps/web/tsconfig.json`: `module: preserve`, `target: es2022`. `apps/web-e2e/tsconfig.json`: `nodenext` (relative imports there carry `.js`; nowhere else).

**Primary Dependencies**: Angular 22.2.1 (`package.json:6`) with `@spartan-ng/brain` 1.5.0 (`:24`) and the helm components in `libs/ui-cockpit` (`HlmButton`, `HlmInput`, `sign-in.ts:25`); NestJS 12.1.2 (`:19`); Prisma 7.10.0 with `@prisma/adapter-pg` (`:22-23,72`); ioredis 6.0.0 (`:31`); class-validator 0.15.1 (`:28`); `ng-openapi-gen` 1.1.0 (`:69`) generating `libs/data-access` from `apps/api/openapi.json` (`libs/data-access/project.json:11`). No new dependency: phone normalisation is local code (research R3), the hash is `node:crypto`.

**Storage**: PostgreSQL through Prisma, schema per module (`libs/domain/prisma/schema/auth.prisma` gains `SignInCode`; migration under `libs/domain/prisma/migrations/<YYYYMMDDHHMMSS>_sign_in_code/`, the latest today being `20261005170000_notification_claim`). Redis (`AUTH_REDIS`, `auth.module.ts`) for the three request counters only.

**Testing**: Jest 30.5.2 (`package.json:64`) from the root config; `*.integration.spec.ts` run against real PostgreSQL and Redis (`jest.preset.cjs:3-8`); Nest projects run Jest with `--experimental-vm-modules`. Playwright 1.63.0 (`:51`) in `apps/web-e2e`, with the Brevo stub `apps/web-e2e/mailbox.mjs` extended to record WhatsApp sends (research R7).

**Target Platform**: the `api` NestJS app and the `web` Angular SSR app; the dialog at 320 px and 390 px phones, tablet and desktop, light and dark, ro and en.

**Project Type**: Nx monorepo (nx 23.2.1, `package.json:70`; `nx.json` `defaultBase: main`), web application: `apps/web`, `apps/api`, `apps/web-e2e`, `libs/contracts`, `libs/domain`, `libs/data-access`, `libs/i18n`.

**Performance Goals**: the request answers 202 as soon as Brevo accepts the message, within 5 s (`Brevo` timeout set to 5 s for this client; the default is 10 s, `brevo.ts:50`); the code check is one `updateMany` and one Redis `MULTI`.

**Constraints**: Constitution VI (the code never lives only in Redis; the account, its roles, consents, audit rows and `account.created` event in one transaction through `AccountsService.createAccount`). The code is hashed with a key (research R2). Brevo's WhatsApp template for `SIGN_IN_CODE` must be approved and its ids given in `WHATSAPP_TEMPLATES`; until then every request answers 502 `whatsapp_failed` (outside step, spec Assumptions). `PHONE_SENDING`, `PHONE_ALLOWLIST`, `WHATSAPP_SENDER`, `WHATSAPP_TEMPLATES` move from worker-only to api too (`.env.example` says so).

**Scale/Scope**: 2 routes, 1 table, 3 DTOs, 1 template, 1 overlay task with 3 steps, ~30 i18n keys per language, 1 Playwright spec, ~4 Jest specs. 17 FRs, level 2 (`.specify/feature.json`).

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 (no change).*

Gates from the motor-fix Constitution (v1.8.1, `.specify/memory/constitution-card.md`):

- [x] **I. No Bloat (NON-NEGOTIABLE)**: no new dependency (local normalisation, `node:crypto` HMAC); one new table, one sub-module shaped like `PasswordResetModule`; no NOTIFICATION row, no queue round trip; the three steps in one component. A `*` prefix in `PHONE_ALLOWLIST` is one added line, justified in R7.
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing specs first; Jest specs colocated (`libs/domain/src/auth/phone-sign-in.*.spec.ts`, `libs/contracts/src/phone.spec.ts`, `apps/web/src/app/sign-in/phone-sign-in.spec.ts`); the API specs run on real PostgreSQL and Redis with `BrevoMock`; `apps/web-e2e/src/phone-sign-in.spec.ts` drives the dialog against the stub. No FR or task id in source.
- [x] **III. The Given Stack**: Angular + Spartan UI (Cockpit), NestJS, PostgreSQL, Redis; nothing else.
- [x] **IV. One Repository, One Toolchain**: `apps/api`, `apps/web`, `apps/web-e2e`, `libs/contracts`, `libs/domain`, `libs/data-access`, `libs/i18n`; Biome from the root.
- [x] **V. Rules Live in One Place**: the DTOs in `libs/contracts/src/auth.dto.ts` validate at the edge and generate the client (`apps/api/openapi.json` → `libs/data-access`); the same `normalisePhone` serves the dialog and the API; `phoneBlockedReason`, `render` and `Brevo` are the one implementation of sending; trust (code, limits, suspension, consent, maintenance) is checked on the server.
- [x] **VI. PostgreSQL Is the Truth**: the code is a `sign_in_code` row; Redis holds counts that may vanish (fail-open); the new account's rows and its `account.created` event are one transaction (`createAccount`).
- [x] **Notion choices**: the plan relies on no Proposed architecture choice beyond the story's Build brief *(proposed)* layout, cited in `design.md`; `context.md` is unavailable, so no To-decide item is assumed: the plan uses only what the code already does.

## Project Structure

### Documentation (this feature)

```text
specs/393-whatsapp-phone-sign-in/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R10 with evidence
├── data-model.md        # Phase 1: SignInCode, Redis keys, state transitions
├── quickstart.md        # Phase 1: how to prove it works
├── contracts/
│   └── auth-phone.md    # Phase 1: POST /auth/phone-code, POST /auth/phone-sign-in
├── design.md            # the design check (mock unavailable; brief is the source)
├── spec.md, context.md, auto-run.md, checklists/
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
libs/contracts/src/
├── auth.dto.ts                          # + PhoneCodeDto, PhoneSignInDto, PhoneSessionDto
├── auth.dto.spec.ts                     # + their cases
├── phone.ts                     (new)   # normalisePhone(input) → E.164 | null
├── phone.spec.ts                (new)
└── index.ts                             # + export phone

libs/domain/prisma/
├── schema/auth.prisma                   # + model SignInCode
└── migrations/<stamp>_sign_in_code/migration.sql   (new)

libs/domain/src/auth/
├── attempts.ts                          # + admitPhoneCode, uncountPhoneCode
├── attempts.spec.ts                     # + their cases
├── phone-sign-in.service.ts     (new)   # issue(phone, language, address), signIn(dto, address)
├── phone-sign-in.controller.ts  (new)   # @Public() POST auth/phone-code, auth/phone-sign-in
├── phone-sign-in.module.ts      (new)   # register({ brevo, phone, webUrl? }, notifications)
├── phone-sign-in.spec.ts        (new)   # code hash, check order (no database)
├── phone-sign-in.api.integration.spec.ts        (new)   # the routes on PostgreSQL+Redis with BrevoMock
├── phone-sign-in.adversary.integration.spec.ts  (new)   # by test-adversary in /speckit-harden
└── index.ts (libs/domain/src/index.ts)  # + PhoneSignInModule

libs/domain/src/notifications/
├── templates/sign-in-code.ts    (new)   # SIGN_IN_CODE whatsapp texts ro/en
├── templates/registry.ts                # + SIGN_IN_CODE
└── phone-config.ts                      # allow-list entry ending in `*` matches a prefix

apps/api/src/
├── app.module.ts                        # + PhoneSignInModule.register(…)
├── public-routes.integration.spec.ts    # + the two routes
└── openapi.json (apps/api/openapi.json) # regenerated: nx run api:openapi

libs/data-access/src/lib/                # regenerated: nx run data-access:generate

apps/web/src/app/
├── sign-in/sign-in.ts                   # + "sau" divider, "Continuă cu telefonul", switchTo 'phone'
├── sign-in/sign-in.spec.ts              # + the button
├── sign-in/sign-in-dialog.ts            # laps: 'phone' lap, back to 'sign-in'
├── sign-in/sign-in-dialog.spec.ts
├── sign-in/phone-sign-in.ts     (new)   # mf-phone-sign-in: phone → code → profile
├── sign-in/phone-sign-in.spec.ts (new)
└── dashboard/session.ts                 # + phoneCode(…), signInWithPhone(…)

libs/i18n/src/public/{ro,en}.json        # + signIn.phone.*, signIn.problem.code* etc.

apps/web-e2e/
├── mailbox.mjs                          # + POST /v3/whatsapp/sendMessage, GET /whatsapp?to=
└── src/phone-sign-in.spec.ts    (new)   # `.js` relative imports (nodenext)

.github/workflows/ci.yml                 # e2e job env: PHONE_SENDING, PHONE_ALLOWLIST, WHATSAPP_SENDER, WHATSAPP_TEMPLATES
.env.example                             # PHONE_* read by the api too
.specify/capabilities/accounts.md, notifications.md   # merged by /speckit-archive from the Spec Delta
```

**Structure Decision**: the feature follows the shape of password reset (ST-157): DTOs in `libs/contracts`, a service/controller/module trio in `libs/domain/src/auth` registered by `apps/api/src/app.module.ts`, a task component beside `password-reset.ts` opened by `SignInDialog.laps`, the generated client in `libs/data-access`, texts in `libs/i18n`. The WhatsApp template joins ST-392's registry; the e2e Brevo stub grows one endpoint. Every path above exists today except those marked `(new)` (listing of 2026-10-06).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A second `Brevo` instance (the api's, next to the worker's) | the code must go from the request so the answer can say 502 `whatsapp_failed` and no NOTIFICATION row is written (spec FR-002, FR-005) | sending through the notifications queue needs a recipient account and a second round trip to learn the result (research R4) |
| `PHONE_ALLOWLIST` prefix entries (`+4070000*`) | the e2e test needs a fresh allowed number per run to always reach the profile step (FR-017, R7) | a fixed number signs in to the account a previous run created; `APP_ENV=test` bypassing the list weakens the guard everywhere |

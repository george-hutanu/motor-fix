# Implementation Plan: Create an account with e-mail and password

**Branch**: `080-sign-up` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/080-sign-up/spec.md`; `context.md`, `design.md`.

## Summary

Add sign-up to the existing `auth` module and sign-in dialog. The API gains `POST /api/v1/auth/sign-up`: JSON only, body checked by a `SignUpDto`, a per-address hourly counter in Redis next to sign-in's, the maintenance gate, a password rule (8–128 code points, not on a short common-password list), ST-79's `createAccount` for a `driver` with a `password` identity hashed by ST-82's argon2id, and the session opened exactly as a remembered sign-in opens it. The web app's sign-in task gets the "Ești nou pe MotorFix? Creează un cont" line, a new sign-up task in the same shared dialog, and `SignInDialog.start()` switches between the two, carrying the e-mail, and lands on the driver dashboard.

## Technical Context

**Language/Version**: TypeScript 5 on Node 24 (`.nvmrc`; `crypto.argon2` from 24.7, already used by `libs/domain/src/auth/password.ts`).
**Primary Dependencies**: NestJS 12, Prisma 7 with `@prisma/adapter-pg`, ioredis 6, class-validator, `@nestjs/swagger` (`package.json`); Angular 22 standalone with signals, `libs/overlays` (`Overlays`, `taskSave`), `libs/ui-cockpit` (`HlmButton`, `HlmInput`); `ng-openapi-gen` for `libs/data-access`. New: none.
**Storage**: PostgreSQL: `account`, `account_role`, `account_identity`, `refresh_token`, `activity_log` (all exist; no migration). Redis: one more counter key family, `auth:signup:address:<sha256>`.
**Testing**: Jest from the root config; `*.integration.spec.ts` against real PostgreSQL and Redis (`jest.preset.cjs`); Playwright in `apps/web-e2e` (`@seeded` flows against the seeded database).
**Target Platform**: API behind the web app's edge proxy (same origin, first-party cookie), as ST-82.
**Project Type**: Nx monorepo — `libs/domain`, `libs/contracts`, `libs/data-access`, `libs/i18n`, `apps/web`, `apps/api` (OpenAPI only), `apps/web-e2e`.
**Performance Goals**: one argon2id hash per sign-up (≈ 40 ms locally); the Security page's 600 ms p95 for any write.
**Constraints**: no personal data in logs or Redis keys; Redis down must not stop sign-up (constitution VI); no public endpoint may choose a role (`accounts.service.ts`); `libs/overlays` is being changed by ST-158 (PR #48) and `accounts.service.ts`, `session.ts` by ST-20 (PR #51), so changes there stay minimal.
**Scale/Scope**: 1 endpoint, 1 DTO, 1 service, 1 dialog task, edits to the sign-in task, the dialog opener and the session; texts; 1 e2e file.

## Constitution Check

- [x] **I. No Bloat**: no new dependency; the common-password list is a constant set, not a service; no consent argument added before ST-132 needs it; no switch for "Am un service" while its target does not exist; `libs/overlays` untouched.
- [x] **II. Test Discipline**: red tests first; API test against real PostgreSQL and Redis; the e2e signs up for real against the seeded stack.
- [x] **III. The Given Stack**: NestJS, PostgreSQL, Redis, Angular with `libs/overlays`.
- [x] **IV. One Repository**: existing projects only.
- [x] **V. Rules Live in One Place**: `SignUpDto` in `libs/contracts` feeds OpenAPI and the regenerated client; the password rule and the limit run in the API; the account is created only by `createAccount`.
- [x] **VI. PostgreSQL Is the Truth**: the account, its audit entry and its event are one transaction; Redis only counts.
- [x] **VII. PR lifecycle**: draft PR #53 at the first commit; reviews, PR tester and merge gate follow.

## Design

### API (`libs/domain/src/auth`)

- `common-passwords.ts` — `isCommonPassword(password)`: a frozen `Set` of lower-cased passwords of 8+ characters (source named in the file), compared lower-case.
- `attempts.ts` — `Attempts.admitSignUp(address)`: `INCR` the address key, `EXPIRE … NX` one hour, refuse above 10; Redis errors log once and admit.
- `sign-in.service.ts` — `openSession(accountId, role, remember)` made public (access token + new family + last active), reused by sign-up; `signIn` calls it.
- `sign-up.service.ts` — `SignUpService.signUp(input, address)`: limit → maintenance → password rule → `hashPassword` → `AccountsService.createAccount({ roles: ['driver'], identity: { method: 'password', subject: email, passwordHash } })` → `openSession(id, 'driver', true)`. A unique violation (`P2002`) becomes 409 `email_taken`. Logs codes only.
- `auth.controller.ts` — `@Post('sign-up') @HttpCode(201)`, the JSON-only check shared with sign-in, the cookie set by the same `keep()`.
- `auth.module.ts` — provides `SignUpService`.

### Contracts and client

- `libs/contracts/src/auth.dto.ts` — `SignUpDto`: `name` (trimmed, 2–80, no control characters), `email` (trimmed, ≤ 254, text@domain.tld, no control characters), `password` (string, 1–1024: the rule itself is the service's, so the answer can be `weak_password`), `language` (`ro` | `en`).
- `apps/api/openapi.json` regenerated; `npx nx run data-access:generate` regenerates `libs/data-access` (`authControllerSignUp`).

### Web (`apps/web/src/app`)

- `dashboard/session.ts` — `signUp(name, email, password, language)`: like `signIn`, keeps the token, then `load()`.
- `sign-in/sign-in.ts` — the switch line under the main button; it closes the task with `{ switchTo: 'sign-up', email }`; reads an e-mail passed as data.
- `sign-in/sign-up.ts` — the sign-up task: "MotorFix" and the driver blurb, Nume / E‑mail / Parolă with a show/hide button, `taskSave` with messages `public.signUp`, the switch line back (`{ switchTo: 'sign-in', email }`).
- `sign-in/sign-in-dialog.ts` — `start()` loops: open the task the last result names, with the e-mail as data, until a result is not a switch; "signed-in" navigates to the landing.
- Texts: `libs/i18n/src/public/{ro,en}.json` → `public.signIn.newHere`, `public.signIn.createAccount`, `public.signUp.*`.

### e2e

- `apps/web-e2e/src/sign-up.spec.ts` — `@seeded`: sign up from Home and land on `/app/driver`, signed in after a reload; the taken e-mail (ST-494: the error next to the button, the name stays); empty, invalid and short fields send nothing; switching both ways carries the e-mail; English; the four sizes × light/dark × RO/EN with axe; keyboard. Each test signs up from its own `X-Forwarded-For` address (`203.0.113.0/24`), so the hourly limit of a shared machine does not carry between runs.

## Project Structure

```text
specs/080-sign-up/  plan.md tasks.md design.md context.md auto-run.md notion-sync.md
libs/domain/src/auth/  common-passwords.ts attempts.ts sign-in.service.ts sign-up.service.ts auth.controller.ts auth.module.ts (+ specs)
libs/contracts/src/auth.dto.ts
apps/api/openapi.json, libs/data-access/src/lib/** (generated)
apps/web/src/app/  dashboard/session.ts sign-in/{sign-in,sign-up,sign-in-dialog}.ts (+ specs)
libs/i18n/src/public/{ro,en}.json
apps/web-e2e/src/sign-up.spec.ts
```

**Structure Decision**: the existing `auth` module and `apps/web/src/app/sign-in`; no new project, no migration.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A common-password list in code | the Build brief's rule "not on a list of common passwords" | a breach-list service is a network call and a dependency on every sign-up; a downloaded 10k list is a large file for a marginal gain over the leaders |
| The switch loop in `SignInDialog` | the overlay's title is fixed at open, and `libs/overlays` is ST-158's right now | a retitle API on the shared overlay would collide with PR #48 |

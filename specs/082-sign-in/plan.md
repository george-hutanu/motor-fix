# Implementation Plan: Sign in with e-mail and password

**Branch**: `082-sign-in` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/082-sign-in/spec.md`; `context.md`, `design.md`.

## Summary

Make sign-in real. The API gains `POST /api/v1/auth/sign-in`, `/refresh` and `/sign-out` in the existing `auth` module of `libs/domain`: argon2id password check with Node's own `crypto.argon2`, per-e-mail and per-address failure counters in Redis, a maintenance gate that reads as off, and rotating refresh tokens in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth`, stored only as hashes in the `refresh_token` table ST-79 created. The web app keeps the 15-minute access token in memory in `Session`, attaches it with one HTTP interceptor that renews once on a 401, renews from the cookie when it needs a session and holds none, and opens a sign-in task in the shared overlay dialog from the phone tab bar's "Cont" and from an "Autentificare" button on wider screens. "Ieși din cont" calls sign-out. The seed gets one account per role.

## Technical Context

**Language/Version**: TypeScript 5 on Node 24 (`.nvmrc` = 24; `node -v` v24.21.0 locally; `crypto.argon2` exists from Node 24.7).
**Primary Dependencies**: NestJS 12.1.2, Prisma 7.10.0 with `@prisma/adapter-pg`, ioredis 6.0.0, class-validator 0.15.1, `@nestjs/swagger` 12.0.2 (`package.json`); Angular 22.2.1 (standalone, signals), `@spartan-ng/brain` 1.5.0 through `libs/overlays`; `ng-openapi-gen` for `libs/data-access` (`libs/data-access/project.json`). New: none at runtime; the seed imports `pg` 8.23.1, already installed by `@prisma/adapter-pg` and declared as a dev dependency so the import does not ride on a transitive one.
**Storage**: PostgreSQL (`refresh_token` + one column, `account.last_active_at` written); Redis for failure counters only.
**Testing**: Jest from the root config (`jest.config.ts`, `jest.preset.cjs`: `*.integration.spec.ts` need PostgreSQL and Redis); Playwright in `apps/web-e2e` (`playwright.config.mts` starts `api:serve` and `web:serve`).
**Target Platform**: API on Railway behind the web app's edge proxy (`apps/web/src/server/edge.ts`): same origin for the browser, so the cookie is first-party.
**Project Type**: Nx monorepo — `apps/api`, `apps/web`, `libs/domain`, `libs/contracts`, `libs/data-access`, `libs/i18n`, `apps/web-e2e`.
**Performance Goals**: a sign-in under 600 ms p95 (Security page, "Any write"); one argon2id check costs ≈ 37 ms locally.
**Constraints**: the access token never leaves memory; the refresh token never reaches script; no personal data in logs or Redis keys; Redis down must not stop sign-in (constitution VI).
**Scale/Scope**: 3 endpoints, 1 migration, 1 dialog task, 1 interceptor, guard/frame/tab-bar edits, seed.

## Constitution Check

- [x] **I. No Bloat**: no new runtime dependency (argon2 and cookies by Node/Express; cookie header parsed in a few lines); the maintenance read is one injectable with an "off" default because the brief's own tests flip it (Complexity Tracking); no `ACCESS_TOKEN_MINUTES` setting; no controls for unbuilt flows.
- [x] **II. Test Discipline**: red tests first; API tests against real PostgreSQL and Redis (`auth.sign-in.api.integration.spec.ts`); e2e signs in for real against the seeded database.
- [x] **III. The Given Stack**: Angular + `libs/overlays` (Spartan brain on CDK), NestJS, PostgreSQL, Redis.
- [x] **IV. One Repository**: everything inside existing projects; no new lib (the dialog lives in `apps/web`, its only user).
- [x] **V. Rules Live in One Place**: DTOs in `libs/contracts` feed OpenAPI; the client is regenerated, never hand-written; the rules (limits, maintenance, landing) run in the API's use case.
- [x] **VI. PostgreSQL Is the Truth**: tokens and accounts in PostgreSQL; Redis holds only counters. A sign-in emits no event (Build brief: Emits none; audit none).
- [x] **Notion choices**: session rules from the Security page and the Build brief (*proposed* lifetimes noted in spec Assumptions); no T-item touched.

## Design

### API (`libs/domain/src/auth`)

- `password.ts` — `hashPassword(password)` and `verifyPassword(password, phc)` on `crypto.argon2` (promisified), PHC string, `timingSafeEqual`; a module-level decoy hash for the no-account path.
- `sign-in.service.ts` — `SignInService` with `signIn({ email, password, remember }, address)`, `refresh(token)`, `signOut(token)`; holds the Prisma client, the Redis client (lazy, `maxRetriesPerRequest: 1`), the token secret and the maintenance reader. Errors are `HttpException`s with the codes of `contracts/auth.md`.
- `attempts.ts` — the two counters: `blocked(keys)`, `fail(keys)`, `clear(emailKey)`; every Redis error is caught, logged once (`Logger('SignIn')`), and treated as "not blocked".
- `auth.controller.ts` — `@Controller('auth')` with the three `@Post`s; sets and clears the cookie with Express's `res.cookie` / `res.clearCookie` (`passthrough: true`), reads it from the `Cookie` header.
- `maintenance.ts` — `MAINTENANCE` token, default `{ on: async () => false }`; ST-261 binds the platform rule.
- `auth.module.ts` — registers the controller and the service; `AuthOptions` gains `redisUrl`. `apps/api/src/app.module.ts` passes `env.REDIS_URL`.
- `apps/api/src/bootstrap.ts` — `app.set('trust proxy', 'loopback, linklocal, uniquelocal')` so `req.ip` is the first public address from the right of `X-Forwarded-For`.
- `apps/web/src/server/edge.ts` — appends the socket's address to `X-Forwarded-For` before proxying.
- Migration `libs/domain/prisma/migrations/20261004140000_refresh_token_remember`.

### Contracts and client

- `libs/contracts/src/auth.dto.ts` — `SignInDto` (class-validator: `IsString`, `Length`, `IsOptional IsBoolean`) and `SessionDto`.
- `npx nx run data-access:generate` regenerates `libs/data-access` (`AuthService`).

### Web (`apps/web/src/app`)

- `dashboard/session.ts` — keeps the access token in a private field; `signIn()`, `renew()` (one in-flight promise), `load()` (renew first when no token), `signOut()`; `token()` for the interceptor.
- `auth.interceptor.ts` — functional interceptor in `app.config.ts`: adds `Authorization: Bearer` to `/api/` calls outside `/api/v1/auth/`; on a 401 to a call that carried the token renews once (shared) and repeats; on a failed renewal forgets the token and "who am I" in memory.
- `sign-in/sign-in.ts` — the task component (reactive state with signals, a plain `<form>`), loaded on demand; `sign-in/sign-in-dialog.ts` — `SignInDialog.open()` → `Overlays.open(() => import('./sign-in').then(m => m.SignIn), { shape: 'dialog', title: 'public.signIn.title' })`, then navigates to the landing on "signed-in"; `start()` — signed in → landing, else open.
- `public/tab-bar.ts` — the "Cont" tab: a click while signed out calls `SignInDialog.start()` and prevents the navigation; signed in it keeps going to `/:lang/account` whose guard redirects (ST-287 behaviour).
- `public/frame.ts` — a top bar, ≥ 768 px only, with the "Autentificare" button; on `NavigationEnd` with `state.signIn` it opens the dialog.
- `dashboard/area.guard.ts` — signed out → `RedirectCommand` to `/<language>` with `state: { signIn: true }`.
- `dashboard/frame.ts` — "Ieși din cont" awaits `session.signOut()` before navigating home.
- Texts: `libs/i18n/src/public/{ro,en}.json` → `public.signIn.*`, `public.signInButton`.

### Seed and e2e

- `libs/domain/src/seed.ts` — `pg` + `crypto.argon2Sync`; upserts the seven accounts, the garage, the memberships and the mechanic link, on `ON CONFLICT DO NOTHING`; staging without `SEED_PASSWORD` exits 1.
- `apps/web-e2e/src/accounts.ts` — the seeded e-mails and `E2E_PASSWORD ?? <fake default>`; `sign-in.spec.ts` — the real flows; `sign-in.ts` (the layout tests' stub) also stubs `/api/v1/auth/refresh`.
- `.github/workflows/ci.yml` e2e job: `npx nx run domain:seed` after migrating; `release.yml` staging e2e and `reset-staging.yml` pass `secrets.SEED_PASSWORD`.

## Project Structure

```text
specs/082-sign-in/  plan.md research.md data-model.md quickstart.md contracts/auth.md tasks.md
libs/domain/src/auth/  password.ts attempts.ts maintenance.ts sign-in.service.ts auth.controller.ts (+ specs)
libs/domain/prisma/  schema/auth.prisma, migrations/20261004140000_refresh_token_remember/
libs/domain/src/seed.ts
libs/contracts/src/auth.dto.ts
apps/api/src/  app.module.ts bootstrap.ts
apps/web/src/server/edge.ts
apps/web/src/app/  auth.interceptor.ts app.config.ts sign-in/ dashboard/{session,area.guard,frame}.ts public/{tab-bar,frame}.ts
libs/i18n/src/public/{ro,en}.json
apps/web-e2e/src/  accounts.ts sign-in.spec.ts sign-in.ts
.github/workflows/  ci.yml release.yml reset-staging.yml
```

**Structure Decision**: the existing `auth` module and `apps/web`; no new project.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| `MAINTENANCE` injectable with a single "off" binding | the brief's tests require "admin passes, driver refused" under maintenance, before ST-261 exists | a hard-coded `false` leaves that rule untested and ST-261 would have to rewrite the use case |
| `SEED_PASSWORD` / `E2E_PASSWORD` | a public repository cannot hold a working staging password | one fake password everywhere would publish a working staging admin login |

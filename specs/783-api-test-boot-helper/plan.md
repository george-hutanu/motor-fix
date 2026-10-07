# Implementation Plan: Shared apps/api integration boot helper

**Branch**: `783-api-test-boot-helper` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/783-api-test-boot-helper/spec.md`

## Summary

Three API integration suites each carry the same boot block, and two of them keep the shared database turn when the boot throws. One test-only file, `apps/api/src/api-boot.testing.ts`, exports a factory `apiBoot()` whose `start()` boots the API as production configures it and whose `stop()` closes what `start()` reached and always releases the turn (first error rethrown). The three suites call it; `bootstrap.integration.spec.ts` keeps its per-test boots and only wraps its file-level teardown in `try/finally`. A colocated integration spec proves the teardown at every stage with `jest.spyOn`. No production source changes.

## Technical Context

Sources: `package.json` (versions), `apps/api/jest.config.cts`, `apps/api/project.json`, `apps/api/tsconfig.{app,spec}.json`, `jest.preset.cjs`, `scripts/mutation.ts`; details in `research.md` R8.

**Language/Version**: TypeScript 6.0.3 on Node >= 24 (`package.json` `engines`), `module: commonjs` for both API tsconfigs

**Primary Dependencies**: NestJS 12.1.2 (`@nestjs/common`, `@nestjs/core`, `@nestjs/testing`), `@motor-fix/contracts` `readEnv`/`STORAGE_ENV`, `@motor-fix/domain/testing` `databaseTurn`/`S3TestStore` (Prisma 7.10.0 under the turn), supertest 7.3.1 in the suites

**Storage**: PostgreSQL and Redis, real, as every API integration suite uses them; the in-process S3 test store

**Testing**: Jest 30.5.2 through ts-jest 29.4.14 (`apps/api/jest.config.cts`), `*.integration.spec.ts` selected by `JEST_SUITE` (`jest.preset.cjs`); Stryker 10.0.0 nightly (`scripts/mutation.ts`), Biome 2.5.15

**Target Platform**: the `api` Nx project's test run, locally (pre-commit, `scripts/heavy.sh`) and in CI's Unit and integration job

**Project Type**: test infrastructure inside the existing `api` app; no new project, lib or dependency

**Performance Goals**: no change to the suites' run time; the helper's own spec adds a few full boots (each boot today takes seconds, `beforeAll` timeout 120 s)

**Constraints**: FR-004 no option without a caller; FR-006 no production source, contract or configuration change; Constitution I

**Scale/Scope**: 1 new helper (~40 lines), 1 new spec (~5 tests), 3 suites edited to call it, 1 `afterAll` wrapped, 2 tsconfig lines

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.2) — evaluate in order:

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one factory, two methods, no options, no class, no exported stage hooks; failure injection through `jest.spyOn` in the spec; no exclusion added to the shared mutation script (research R4); `bootstrap.integration.spec.ts` not forced onto the helper.
- [x] **II. Test Discipline**: the helper's spec is written first (`/speckit-tests`), colocated at `apps/api/src/api-boot.testing.integration.spec.ts`, against real PostgreSQL and Redis; the three suites keep every assertion; no FR id in source.
- [x] **III. The Given Stack**: NestJS testing module and the repo's own testing helpers only.
- [x] **IV. One Repository, One Toolchain**: stays in the `api` project, root Jest and Biome; two tsconfig lines mirror `libs/domain`.
- [x] **V. Rules Live in One Place**: the boot sequence exists once in `apps/api` test code (SC-001); no API shape changes.
- [x] **VI. PostgreSQL Is the Truth**: not touched; the turn stays a PostgreSQL advisory lock.
- [x] **Notion choices**: none relied on; no T1–T10 item touched (`context.md` Open Decisions: none).

Post-design re-check: unchanged; Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/783-api-test-boot-helper/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R8, each with evidence
├── data-model.md        # Phase 1: the handle's state and the stages stop() owes
├── quickstart.md        # Phase 1: how to prove SC-001…SC-004
├── context.md, design.md, spec.md, checklists/, auto-run.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

No `contracts/`: the API exposes nothing new (FR-006), and the helper's only interface is `apiBoot(): { start, stop }`, described in `data-model.md`.

### Source Code (repository root)

```text
apps/api/
├── tsconfig.app.json                              # exclude += "src/**/*.testing.ts"
├── tsconfig.spec.json                             # include += "src/**/*.testing.ts"
└── src/
    ├── api-boot.testing.ts                        # (new) apiBoot(): { start(), stop() }
    ├── api-boot.testing.integration.spec.ts       # (new) FR-002 at every stage, FR-005
    ├── validation-problem.integration.spec.ts     # boots through apiBoot()
    ├── public-routes.integration.spec.ts          # boots through apiBoot()
    ├── sign-up-confirmation.integration.spec.ts   # boots through apiBoot(); env and spy set before start()
    ├── bootstrap.integration.spec.ts              # afterAll: try { store.stop() } finally { turn.release() }
    ├── bootstrap.adversary.integration.spec.ts    # unchanged (per-test boots with its own controller)
    ├── app.module.ts, bootstrap.ts, main.ts       # unchanged (FR-006)
    └── …
```

**Structure Decision**: everything stays under `apps/api/src`, colocated like every API spec. The helper is a `*.testing.ts` file (research R1), kept out of the production typecheck and in the spec typecheck exactly as `libs/domain` does (R2).

### The helper (what `/speckit-tasks` builds)

`apiBoot()` is called once at module scope and holds `env`, `turn = databaseTurn(env.DATABASE_URL)`, `store = new S3TestStore()`, `storeStarted`, `app`.

- `start()`: `await turn.take()`; `await store.start()`, then `storeStarted = true`; `readEnv(['DATABASE_URL', 'REDIS_URL', 'AUTH_TOKEN_SECRET', ...STORAGE_ENV], { ...env, ...store.env() })`; `Test.createTestingModule({ imports: [AppModule.register(config)] }).compile()`; `app = moduleRef.createNestApplication({ bufferLogs: true })`; `configureApp(app, config)`; `await app.init()`; return `app`.
- `stop()`: attempt `app.close()` when `app` is set, then `store.stop()` when `storeStarted`, keeping the first rejection; `finally` `turn.release()`; rethrow the kept error. Stages and what each owes: `data-model.md`.
- The suites: `const api = apiBoot();` at module scope, `app = await api.start()` first in `beforeAll` (the sign-up suite sets `PUBLIC_WEB_URL` and installs its spy before that line, and still restores both in `afterAll`), `afterAll(() => api.stop())`; their seeding, requests and assertions stay as they are.

### The helper's spec

`api-boot.testing.integration.spec.ts`, one test per row of `data-model.md` that can fail from outside, plus the success order (research R5 names the spy points): store `start` rejected; `Test.createTestingModule` throws; `NestApplication.prototype.init` rejected (app still closed); `NestApplication.prototype.close` rejected (store still stopped, error rethrown); successful boot closed in order app, store, turn. Each test calls `stop()`, then proves the turn free with a fresh `databaseTurn(url).take()` resolving within 120 s, and releases it.

## Complexity Tracking

No Constitution Check violation; nothing to justify.

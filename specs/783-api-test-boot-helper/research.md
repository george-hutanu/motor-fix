# Research: Shared apps/api integration boot helper

Phase 0 of `/speckit-plan` for ST-783. Every decision cites the file read in this run.

## R1. Where the helper lives and what it is named

- Decision: `apps/api/src/api-boot.testing.ts`, a non-spec test-only file beside the suites, exporting one factory `apiBoot()` called at module scope that returns `{ start(): Promise<INestApplication>, stop(): Promise<void> }`.
- Rationale: the block imports `./app.module` and `./bootstrap`, which no lib may import; the repo's precedent for test-only helpers that are not specs is the `*.testing.ts` suffix (`libs/domain/src/auth/database-turn.testing.ts`, `serial-db.testing.ts`, `notifications/push.testing.ts`). Jest's test match is `**/?(*.)+(spec|test).?([mc])[jt]s?(x)` (`@nx/jest/preset`, loaded through `jest.preset.cjs:1`), so a `*.testing.ts` file is never collected as a spec.
- Alternatives considered: exporting it from `@motor-fix/domain/testing` (rejected: libs never import apps, spec Clarifications); a `test/` directory under `apps/api` (rejected: every API spec is colocated under `apps/api/src`, Constitution II).
- Evidence: `apps/api/src/validation-problem.integration.spec.ts:11-12`; `tsconfig.base.json:22-24`; `find apps libs -name '*.testing.ts'` (7 files, all in `libs/domain/src`).

## R2. TypeScript projects: which tsconfig compiles the helper

- Decision: mirror `libs/domain`: add `src/**/*.testing.ts` to `apps/api/tsconfig.app.json` `exclude` and to `apps/api/tsconfig.spec.json` `include`.
- Rationale: today `tsconfig.app.json` includes `src/**/*.ts` and excludes only `*.spec.ts`/`*.test.ts` (`apps/api/tsconfig.app.json:10-16`), so the helper would be type-checked as production code by `tsc -p apps/api/tsconfig.app.json` (`apps/api/project.json:51`); `tsconfig.spec.json` includes only specs and `.d.ts` (`apps/api/tsconfig.spec.json:8-14`). `libs/domain` already keeps `*.testing.ts` out of the lib build and in the spec project (`libs/domain/tsconfig.lib.json:12`, `libs/domain/tsconfig.spec.json:15`). ts-jest compiles the helper with `tsconfig.spec.json` whatever its `include` says (`apps/api/jest.config.cts:8`), so the include line is for `typecheck` and editors, the exclude line keeps the production typecheck free of `@nestjs/testing`.
- Production bundle: unaffected either way; webpack's only entry is `./src/main.ts` (`apps/api/webpack.config.cjs:16`) and nothing in production imports the helper.
- Alternatives considered: leaving both tsconfigs as they are (rejected: the production typecheck would own a test file, unlike every lib).

## R3. Biome

- Decision: nothing to change.
- Rationale: `biome.jsonc` lints `apps/**` with one rule set; the only spec-specific override turns `noExplicitAny` off for `**/*.spec.ts` (`biome.jsonc:112-118`), which the helper does not need.

## R4. Mutation testing (the spec's open assumption)

- Decision: no exclusion; the helper is mutated with the rest of `apps/api` and its own spec kills what it can.
- Rationale: `scripts/mutation.ts:66-72` mutates `src/**/*.ts` minus specs, tests, `generated/**` and `test-setup.ts`, and `scripts/mutation.spec.ts:68-74` asserts that exact list, so an exclusion would touch a shared script and its spec for every project (scope creep: the Agent Execution Rules, `.specify/memory/constitution.md:417-421`). `ignoreStatic: true` (`scripts/mutation.ts:62`) already drops the mutants in code that runs at import, which is the factory body (env values, the turn and store creation); only `start()` and `stop()` are live mutants, and the helper's spec (FR-005) covers `stop()` stage by stage. The one likely survivor is `bufferLogs: true → false`, which no test can observe. The TypeScript checker passes mutants in a file outside `tsconfig.app.json` straight through (`node_modules/@stryker-mutator/typescript-checker/dist/src/typescript-checker.js:72-76`), so R2's exclude does not break the checker; the nightly run has PostgreSQL and Redis (`.github/workflows/mutation.yml:27-42`), so the integration specs run there.
- Alternatives considered: `!${root}/src/**/*.testing.ts` in the shared globs (one line plus a spec change; deferred until a nightly run shows the floor of 95, `apps/api/stryker.config.json:4`, needs it); a `mutate` override in `apps/api/stryker.config.json` (rejected: repeats the five shared globs).

## R5. Where the stages can be made to fail from a spec (FR-005)

- Decision: the helper's spec is `apps/api/src/api-boot.testing.integration.spec.ts` (it takes the real advisory lock and boots `AppModule` against PostgreSQL and Redis; `jest.preset.cjs:6-9` names such specs `*.integration.spec.ts`). It fails each stage with `jest.spyOn` on prototypes and statics the helper already uses, never through a helper parameter:
  - store start: `jest.spyOn(S3TestStore.prototype, 'start')` (`libs/domain/src/storage/s3-test-store.ts:76`);
  - module compile: `jest.spyOn(Test, 'createTestingModule')` (`@nestjs/testing`);
  - app start: `jest.spyOn(NestApplication.prototype, 'init')`; app close: `jest.spyOn(NestApplication.prototype, 'close')`. `NestApplication` is exported from `@nestjs/core` (`node_modules/@nestjs/core/index.d.ts:12`; `init(): Promise<this>` at `nest-application.d.ts:38`) and is what `TestingModule.createNestApplication` returns (`node_modules/@nestjs/testing/testing-module.d.ts:21`);
  - the turn: proven free by a fresh `databaseTurn(url).take()` resolving within 120 s (SC-002), released again by the spec.
- `post-edit-check.sh` maps `api-boot.testing.ts` to `api-boot.testing.spec.ts` (`.claude/hooks/post-edit-check.sh:59`), which will not exist, so the edit hook runs nothing for the helper, as for `bootstrap.ts` today; the pre-commit hook and CI run the integration spec with the services up.

## R6. Teardown semantics that satisfy FR-002 ("first error rethrown")

- Decision: `stop()` attempts each close it owes in order (app `close()` if an app was created, store `stop()` if the store started), keeps the first rejection, then releases the turn in a `finally` and rethrows the kept error after the release.
- Rationale: nested `try/finally` alone would rethrow the last error, not the first, when two closes fail; keeping the first and releasing in `finally` is four lines. `S3TestStore.stop()` on a server that never listened would reject (`node:http` `Server.close` with `ERR_SERVER_NOT_RUNNING`), so the handle records that the store started; an app whose `init()` threw still exists and still gets `close()`, which is what FR-002 asks. `databaseTurn().release()` on a client that never took the lock is a `$disconnect()` of an unconnected client (`libs/domain/src/auth/database-turn.testing.ts:17`), harmless, as the spec's edge case states.

## R7. `bootstrap.integration.spec.ts`

- Decision: unchanged apart from its `afterAll`, which becomes `try { await store.stop(); } finally { await turn.release(); }`.
- Rationale: it boots one app per test with a probe controller and a varying `APP_ENV` (`apps/api/src/bootstrap.integration.spec.ts:62-78`), which the option-free handle (FR-004) cannot serve; ST-715 names exactly its file-level teardown (`context.md` Prior Art).

## R8. Versions and commands (Technical Context sources)

- `package.json`: `@nestjs/common`, `@nestjs/core`, `@nestjs/testing` 12.1.2; `jest` 30.5.2; `ts-jest` 29.4.14; `nx`, `@nx/jest` 23.2.1; `typescript` 6.0.3; `@prisma/client`, `@prisma/adapter-pg` 7.10.0; `supertest` 7.3.1; `@stryker-mutator/core` 10.0.0; `@biomejs/biome` 2.5.15; `engines.node >=24.0.0`.
- `apps/api/jest.config.cts`: ts-jest with `tsconfig.spec.json`, `testEnvironment: node`, preset `jest.preset.cjs` (`JEST_SUITE` picks unit or integration).
- `apps/api/project.json:51`: `typecheck` runs `tsc --noEmit` on `tsconfig.app.json` then `tsconfig.spec.json`.

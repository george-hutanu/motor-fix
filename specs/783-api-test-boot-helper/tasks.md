# Tasks: Shared apps/api integration boot helper

**Input**: `specs/783-api-test-boot-helper/` (spec.md, plan.md, research.md, data-model.md, quickstart.md)
**Tests**: required first (Constitution II): the helper's own integration spec is written red before the helper.
**Format**: `- [ ] T### [P?] [Story] Description with file path`. US1 = one place boots the API (FR-001, FR-003, FR-004 suites, SC-001, SC-004); US2 = a failed boot never keeps the turn (FR-002, FR-004 bootstrap teardown, FR-005, SC-002).

## Phase 1: Setup

- [ ] T001 Add `"src/**/*.testing.ts"` to `exclude` in `apps/api/tsconfig.app.json` and to `include` in `apps/api/tsconfig.spec.json`, mirroring `libs/domain` (plan, research R2)

## Phase 2: Tests first (red)

- [ ] T002 [US2] Write `apps/api/src/api-boot.testing.integration.spec.ts` (new), importing `apiBoot` from `./api-boot.testing` (does not exist yet, so red): one test per stage with `jest.spyOn` (store `start` rejects via `S3TestStore.prototype`; `Test.createTestingModule` throws; `NestApplication.prototype.init` rejects and the app is still closed; `NestApplication.prototype.close` rejects, the store is still stopped and the error is rethrown; a successful boot closes app, store, turn in that order, and a second `stop()` is harmless). Each test calls `stop()`, then proves the turn free with a fresh `databaseTurn(url).take()` resolving within 1 s and releases it (FR-002, FR-005, SC-002)

## Phase 3: User Story 2 - the helper with a safe teardown (P1)

**Goal**: `stop()` is safe at every stage. **Independent test**: T002's spec passes.

- [ ] T003 [US2] Implement `apps/api/src/api-boot.testing.ts` (new): `apiBoot()` factory returning `{ start(), stop() }` with no options; `start()` takes the turn, starts the `S3TestStore`, reads env with `readEnv`, compiles `AppModule.register(config)`, creates the app with `bufferLogs: true`, applies `configureApp`, `init`s and returns the app; `stop()` attempts `app.close()` then `store.stop()` (each only if reached), keeps the first rejection, releases the turn in a `finally`, rethrows (FR-001, FR-002, data-model.md)
- [ ] T004 [P] [US2] Wrap the file-level `afterAll` in `apps/api/src/bootstrap.integration.spec.ts` as `try { await store.stop() } finally { await turn.release() }`; no test changes (FR-004)

## Phase 4: User Story 1 - the three suites call the helper (P1)

**Goal**: the boot sequence exists once. **Independent test**: the three suites pass with unchanged assertions.

- [ ] T005 [P] [US1] Switch `apps/api/src/validation-problem.integration.spec.ts` to `const api = apiBoot()` at module scope, `app = await api.start()` first in `beforeAll`, `afterAll(() => api.stop())`; remove its own env, store, turn, `readEnv`, `createTestingModule`, `configureApp` and close code (FR-003, SC-004)
- [ ] T006 [P] [US1] Same switch in `apps/api/src/public-routes.integration.spec.ts`
- [ ] T007 [P] [US1] Same switch in `apps/api/src/sign-up-confirmation.integration.spec.ts`, keeping `PUBLIC_WEB_URL` and the e-mail spy set before `api.start()` and restored in its own `afterAll`

## Phase 5: Verification

- [ ] T008 Run the four API integration suites and the helper spec (`JEST_SUITE=integration`, through `scripts/heavy.sh`), `npm run typecheck`, `npm run lint`; confirm SC-001/SC-004 by grepping the three suites for `readEnv|createTestingModule|configureApp|S3TestStore|databaseTurn|app.close|store.stop|turn.release` (quickstart.md); confirm FR-006 with `git diff origin/main --name-only -- apps libs` listing only `*.spec.ts`, `*.testing.ts` and `apps/api/tsconfig.app.json`/`tsconfig.spec.json` (FR-006)

## Dependencies

T001 -> T002 -> T003 -> T005/T006/T007 -> T008. T004 is independent of T003 (after T001 not required) and can run beside T005-T007.

## Implementation strategy

One slice: T001-T003 (helper, red then green), then T004-T007 in parallel, then T008. MVP is the whole change; it is small.

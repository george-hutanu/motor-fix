# Feature Specification: Shared apps/api integration boot helper

**Feature Branch**: `783-api-test-boot-helper`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-783 "Tech debt (ST-472): duplication: a third copy of the apps/api boot block" — https://app.notion.com/p/3f2607bff0d28158ac9ddb95d2672efa (Tech debt, Foundations epic EP-1, Medium priority, Role System; deferred by code-reviewer in ST-472, PR #177, `specs/472-validation-failed-code/deferred.md:3`). The task page has no comments. "apps/api has three copies of the same integration-test boot block (env, S3TestStore, databaseTurn, readEnv, Test.createTestingModule, configureApp, app.init) in `validation-problem.integration.spec.ts`, `public-routes.integration.spec.ts` and `sign-up-confirmation.integration.spec.ts` (check `bootstrap.integration.spec.ts` too), and their teardowns skip `turn.release()` when the boot failed. Share one apps/api boot helper with a safe teardown (always releases the database turn and closes what was opened, even when boot threw), and have the specs use it. Behaviour of the API does not change; System role, no screens."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One place boots the API for its integration specs (Priority: P1)

A developer writing or reading an API integration spec finds one helper that boots the API the way production configures it (environment, the in-process file store, the shared database turn, the checked configuration, the application module, the production app setup) and hands back what the spec needs. The three specs that today each carry their own copy of that block call the helper instead, and their tests assert exactly what they asserted before.

**Why this priority**: it is the finding itself. Three identical boot blocks drift apart one edit at a time (ST-472 added the third, with a teardown the other two do not have), and every new API spec would copy a fourth.

**Independent Test**: run the three suites against a real PostgreSQL, Redis and the in-process store: every test passes with no changed assertion, and a search of `apps/api` finds the boot sequence written once.

**Acceptance Scenarios**:

1. **Given** the three API integration suites, **When** they run after the change, **Then** every test passes and no assertion, request, seeded account or expected answer in them differs from before.
2. **Given** `apps/api`, **When** its test code is searched for the boot sequence (configuration read, testing module compiled, production app setup applied, app started), **Then** it appears in the shared helper only, not in any of the three suites.
3. **Given** the sign-up suite, which sets `PUBLIC_WEB_URL` and spies on the account e-mail before the app starts, **When** it does both before calling the helper's start, **Then** the boot sees them, with no option or hook on the helper.

---

### User Story 2 - A failed boot never keeps the database turn (Priority: P1)

When a boot throws partway (the store fails to start, the module fails to compile, the app fails to start), the teardown still gives the shared database turn back and closes whatever had been opened, so the other integration suites waiting for that turn are not held until the runner's timeout, and the failure the developer sees is the boot's own error, not a hang.

**Why this priority**: today two of the three suites release the turn only after a successful `app.close()`; a boot that throws leaves the advisory lock held by a connection that is never closed. The third suite guards this with a `try/finally` that the others lack, which is the drift User Story 1 removes.

**Independent Test**: make the boot throw at each stage in a spec of the helper, run the teardown, and show that the turn is free (a second take succeeds at once) and that everything that opened was closed, with the boot's error still reported.

**Acceptance Scenarios**:

1. **Given** a boot that threw before the app started, **When** the teardown runs, **Then** the database turn is released and the store, if it started, is stopped.
2. **Given** a boot that threw after the store started but before the app started, **When** the teardown runs, **Then** the store is stopped and the turn is released; nothing tries to close an app that never existed.
3. **Given** a successful boot, **When** the teardown runs, **Then** the app is closed, the store is stopped and the turn is released, in that order.
4. **Given** a teardown in which closing the app or stopping the store throws, **When** it runs, **Then** the turn is still released and that error is reported, not swallowed.

---

### Edge Cases

- A boot that throws before the turn was taken: the teardown releases the turn's connection anyway (releasing an untaken turn is harmless today: it disconnects a client that never locked) and does not fail on it.
- Two suites in the same run both reach the helper: each boots its own app and takes its own turn in sequence, as today; the helper owns nothing shared across files.
- A spec that restores process environment it changed for the boot (the sign-up suite sets `PUBLIC_WEB_URL`) keeps doing so itself; the helper neither reads nor restores process variables beyond what the existing block reads.
- The conventions suite (`bootstrap.integration.spec.ts`) boots several apps per file, each with a different `APP_ENV` and a probe controller, with one turn and one store for the file. It keeps its own per-test `start`; only its file-level teardown changes, to release the turn in a `finally` (see Clarifications).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `apps/api` MUST have one test-only boot helper: a handle created at module scope whose `start()` boots the API for an integration spec as production configures it (the test environment values the suites use today, the shared database turn taken, the in-process file store started, the configuration read and checked from those values, the application module compiled, the production app setup applied, the app started) and returns the started app, and whose `stop()` tears down whatever `start()` reached.
- **FR-002**: `stop()` MUST be safe to call whatever stage `start()` reached, including when it threw or never ran: it MUST attempt every close of what was opened (the app if it was created, the store if it started), in the order app, store, and MUST release the database turn in a `finally`; when a close throws, the remaining closes and the release still run and the first error is rethrown.
- **FR-003**: `validation-problem.integration.spec.ts`, `public-routes.integration.spec.ts` and `sign-up-confirmation.integration.spec.ts` MUST boot and tear down through the helper and MUST NOT close an app, a store or a turn of their own; they keep their own seeding and restores (the sign-up suite's `PUBLIC_WEB_URL` and spy), and every request, seeded record and assertion in them MUST stay as it is.
- **FR-004**: The helper MUST take no option that no suite in this change uses (no `APP_ENV` override, no extra controllers, no failure-injection parameter). `bootstrap.integration.spec.ts` keeps its own per-test boots; its file-level teardown MUST release the turn in a `finally`, so a failed store stop or start never keeps the turn; none of its tests change.
- **FR-005**: The helper MUST be covered by its own spec that proves FR-002 for a boot that throws at each stage and for a teardown whose close throws, making those stages fail with `jest.spyOn` in the spec, not through parameters of the helper.
- **FR-006**: The API's behaviour MUST NOT change: no production source, route, answer, contract or configuration moves; the change is test infrastructure only.

### Key Entities

- **Boot helper**: the one function (or pair: boot and teardown) an API integration spec calls; holds the test environment, the store, the turn and the started app for the file.
- **Database turn**: the advisory lock the API and domain integration suites take in turn so a suite that empties tables does not run beside another; released by disconnecting its client.
- **In-process file store**: the S3-compatible test store the API boots against; started before the configuration is read, stopped at teardown.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-005
- **Modifies**: none
- **Removes**: none

(FR-003, FR-004 and FR-006 are this change's scope rules, not lasting capability requirements.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The boot sequence (configuration read, testing module compiled, production app setup applied, app started) exists once in `apps/api` test code, in the helper; the three suites named in FR-003 contain none of it, and none of them calls `app.close()`, `store.stop()` or `turn.release()` itself.
- **SC-002**: A spec of the helper shows that after a boot that throws at any stage, and after a close that throws, a fresh take of the database turn resolves within 1 s.
- **SC-003**: The four existing API integration suites pass with no changed assertion; `npm run typecheck`, `npm run lint` and the API's tests are green on CI.
- **SC-004**: No `readEnv`, `Test.createTestingModule`, `configureApp`, `S3TestStore` or `databaseTurn` call remains in the three suites named in FR-003.

## Clarifications

### Session 2026-10-07

- Q: Where does the helper live? → A: In `apps/api` test code, beside the suites, as a non-spec test-only file; not in the domain's testing exports, because it needs the app's own module and production setup, and libs never import apps (`421-FR-005`). (autonomous default; evidence: the block imports `./app.module` and `./bootstrap`; `libs/domain/src/auth/database-turn.testing.ts` is the repo's precedent for a `*.testing.ts` helper)
- Q: Is `bootstrap.integration.spec.ts` in scope? → A: Its boots stay its own (one turn and store per file, one app per test, varying `APP_ENV` and controllers do not fit a one-app handle without options nobody else uses); only its file-level teardown gets the turn release in a `finally`, the same defect ST-715 names at `bootstrap.integration.spec.ts:92`. (autonomous default; evidence: the task says "check bootstrap.integration.spec.ts too"; `context.md` Contradictions, ST-715 page 2026-10-06; Constitution I)
- Q: Does the teardown exist independently of a successful boot? → A: Yes: a module-scope handle whose `stop()` is safe at every stage, including when `start()` threw or never ran. (autonomous default; evidence: spec-challenger finding 1; US2 scenarios 1-2 describe a teardown after a failed boot)
- Q: Does the helper grow options for variations only `bootstrap.integration.spec.ts` uses? → A: No: no option without a caller in this change; the sign-up suite sets its environment and spy before `start()`. (autonomous default; evidence: spec-challenger finding 2; Constitution I)
- Q: May a suite keep its own `beforeAll`/`afterAll` for seeding and restores? → A: Yes; it only must not close the app, store or turn itself (FR-003, SC-001). (autonomous default; evidence: spec-challenger finding 3; `sign-up-confirmation.integration.spec.ts:48-55`)
- Q: Does a teardown whose first close throws still attempt the rest? → A: Yes: every close is attempted, the turn is released in a `finally`, the first error is rethrown; the helper's own spec fails stages with `jest.spyOn`, not parameters. (autonomous default; evidence: spec-challenger findings 4-5; US2 scenario 4)
- Q: Any API, contract, screen or web change? → A: None (FR-006). Existing behaviour does not change; the task's Role is System and its Design and Design boards are epic rollups with nothing for this work. (autonomous default; evidence: the Notion task page, `Issue type` Tech debt, `Role` System)

## Assumptions

- The helper is test infrastructure under `apps/api`; whether the mutation run should exclude it, or its own spec (FR-005) covers it well enough for the floor, is decided in the plan, not here. (autonomous default)
- The test environment values (`APP_ENV`, `AUTH_TOKEN_SECRET`, `DATABASE_URL`, `REDIS_URL`, `RELEASE_SHA` and the store's variables) stay exactly those the three suites use today; the helper does not invent new ones. (autonomous default)
- The order of teardown stays app, store, turn, as the suites do today. (autonomous default)
- The sign-up suite's own process-environment restore (`PUBLIC_WEB_URL`) and spy restore stay in that suite; the helper restores only what it opened. (autonomous default)
- The domain's own integration suites, which take the same turn through the domain's testing helper, are out of scope. (autonomous default)

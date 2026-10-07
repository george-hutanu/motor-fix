# Auto run — 783-api-test-boot-helper

ST-783 Tech debt (ST-472): duplication: a third copy of the apps/api boot block — https://app.notion.com/p/3f2607bff0d28158ac9ddb95d2672efa (Tech debt, Foundations epic EP-1, Medium, Role System; deferred by code-reviewer in ST-472, PR #177). apps/api has three copies of the same integration-test boot block (env, S3TestStore, databaseTurn, readEnv, Test.createTestingModule, configureApp, app.init) in `validation-problem.integration.spec.ts`, `public-routes.integration.spec.ts` and `sign-up-confirmation.integration.spec.ts` (`bootstrap.integration.spec.ts` checked too), and their teardowns skip `turn.release()` when the boot failed. Share one apps/api boot helper with a safe teardown and have the specs use it. API behaviour unchanged; no screens.

Start: origin/main 0ea7890a (worktree `.worktrees/783-api-test-boot-helper`, branch `783-api-test-boot-helper`, draft PR #190).

## Phase 2 — Specify

- before_specify git hook skipped: the branch and its draft PR #190 already exist; `.specify/feature.json` pointed at `specs/783-api-test-boot-helper` by `level.mjs point` (level 2).
- Notion task read (no comments; Design and Design boards are epic rollups); deferred item `specs/472-validation-failed-code/deferred.md:3`.
- Repo read: the three suites carry the same boot block; only the ST-472 one releases the turn in a `finally`; `bootstrap.integration.spec.ts` boots one app per test (different `APP_ENV`, a probe controller) with one turn and store per file.
- spec: 6 FRs, 2 user stories, Spec Delta on `platform` (adds FR-001, FR-002, FR-005).
- Clarifications answered autonomously, each under Clarifications with evidence:
  1. The helper lives in `apps/api` test code as a non-spec `*.testing.ts` file (needs the app's module and setup; libs never import apps).
  2. Teardown releases the turn in a `finally` and still reports a close error.
  3. `bootstrap.integration.spec.ts` uses the helper only where it fits its per-test boots (options for `APP_ENV` and extra controllers); otherwise stays unchanged, the plan says why.
  4. No API, contract, screen or web change.
- Checklist `checklists/requirements.md`: every item passes.
- `level.mjs check`: level 2 unchanged (fr-count tripped at 6; clarification, contract, projects clear). `capabilities.mjs validate`: 0 errors, 3 warnings (FR-003, FR-004, FR-006 are scope rules, named in no Adds by design).
- after_specify hooks: notion-sync `start` (ST-783 To do → Planning, EP-1 In progress unchanged, PR #190 label planning), ready review: 13 candidates (ST-682 … ST-5), the same list the ST-569 run reviewed earlier today and held; none clearly free of an outside wait, left as is. `pr 190` linked. Design check: no screens, `design.md` written.

## Phase 3 — Context
- org-researcher (background): context.md written; 7 findings; ST-715 overlaps on bootstrap teardown.

## Phase 4 — Clarify (inline, spec-challenger 5 findings)
- Q1 bootstrap in scope? → own boots stay; file-level teardown releases the turn in a finally (ST-715 overlap). (autonomous default)
- Q2 teardown independent of a successful boot? → yes, module-scope handle, stop() safe at every stage.
- Q3 options for bootstrap-only variations? → none; sign-up sets env and spy before start().
- Q4 suites keep their own seed/restores? → yes; they never close app/store/turn themselves.
- Q5 first close throws? → every close attempted, turn released in finally, first error rethrown; spec fails stages with jest.spyOn.
- level check: 2 unchanged.

## Phase 5 — Plan
- before_plan hooks: design check `design.md current` (no screens, kept as written); git auto-commit: nothing outstanding.
- Technical Context from package.json, apps/api/{jest.config.cts,project.json,tsconfig.app.json,tsconfig.spec.json}, jest.preset.cjs, scripts/mutation.ts (research.md R8).
- Decisions (research.md R1–R7): `apps/api/src/api-boot.testing.ts`, factory `apiBoot()` → `{ start(), stop() }`; `*.testing.ts` excluded from tsconfig.app and included in tsconfig.spec as libs/domain does; Biome unchanged; no mutation exclusion (`ignoreStatic` drops the factory body, `scripts/mutation.spec.ts:68` pins the shared globs; one likely survivor `bufferLogs`); helper spec is `api-boot.testing.integration.spec.ts`, stages failed through `jest.spyOn` on `S3TestStore.prototype`, `Test.createTestingModule`, `NestApplication.prototype.{init,close}`; `stop()` keeps the first rejection, releases the turn in a `finally`, rethrows; bootstrap suite: `afterAll` try/finally only.
- Constitution Check: all gates pass, Complexity Tracking empty. Artifacts: plan.md, research.md, data-model.md, quickstart.md; no contracts/ (FR-006).
- after_plan hooks: agent-context refreshed (CLAUDE.local.md pointer, one-line form kept for the context ratchet); commit `docs(specs): ST-783 plan the shared apps/api boot handle`, pushed.

## Phase 6 — Checklist
- `checklists/boot-handle.md`: 20 requirements-quality items (completeness, clarity, consistency, coverage, assumptions); all resolved. One gap fixed in spec.md FR-002 (second `stop()` harmless); CHK016 resolved by the existing pre-turn stage edge case; none struck.
- Commit `docs(specs): ST-783 checklist the boot handle requirements`, pushed.

## Phase 7 — Tasks
- before_tasks hook (git auto-commit): nothing outstanding. after_tasks `speckit.analyze` left to the caller (phase 8).
- `tasks.md`: 8 tasks (T001 tsconfig, T002 red helper spec, T003 helper, T004 bootstrap try/finally, T005-T007 three suites, T008 verification); US2 4 tasks, US1 3; T004-T007 parallelizable.

## Phase 8 — Analyze
- artifact-lint: 1 ERROR (FR-006 had no task) remediated: FR-006 reworded to allow the apps/api tsconfig lines, T008 gained the FR-006 check (`git diff origin/main --name-only -- apps libs` lists only spec, testing and tsconfig files). Re-run: 0 errors, 3 delta-unassigned warnings (FR-003, FR-004, FR-006 are suite edits, not platform capabilities; by design).
- No CRITICAL/HIGH findings; context.md's ST-715 contradiction resolved by the clarify answer (bootstrap gets the try/finally).

## Phase 9 — Tests
- T001 tsconfig lines, then `apps/api/src/api-boot.testing.integration.spec.ts` (5 tests: store start fails, module compile throws, init fails, close fails, clean boot + second stop). Red: suite failed to run, `Cannot find module './api-boot.testing'` (0 of 5 could run).
- Decision: the turn probe waits up to 60 s, not 1 s (spec SC-002 and plan/research/quickstart/tasks updated): other api integration files take the same advisory lock in parallel workers, so 1 s would be flaky; a leaked turn never resolves, so the probe still fails on a leak.
- Environment: the shared node_modules lacked `web-push` (stale against package.json); `npm install` in the main checkout fixed it. Prisma client generated in the worktree.

## Phase 10 — Implement
- `notion-sync implement`: ST-783 Implementing.
- T003 `apps/api/src/api-boot.testing.ts`: `apiBoot()` and `TEST_TOKEN_SECRET` (the two suites that sign tokens read it; decided here, evidence `validation-problem.integration.spec.ts:50`, `public-routes.integration.spec.ts:143`). `stop()` attempts app close then store stop (each only if reached), releases the turn, rethrows the first failure; idempotent.
- T004 bootstrap afterAll try/finally; T005-T007 three suites on `apiBoot()`; sign-up keeps its spy and PUBLIC_WEB_URL restores in a `finally` after `api.stop()`.
- Verification: api typecheck (app+spec) green; 6 api integration suites, 60 tests green; SC-004 grep empty; FR-006 diff lists only spec, testing and tsconfig files.

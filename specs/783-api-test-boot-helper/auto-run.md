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

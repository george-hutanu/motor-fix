# Tasks: Mutation testing across every app and lib

**Input**: plan.md, spec.md, research.md, data-model.md, contracts/mutation-target.md, quickstart.md, context.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths exist today unless marked `(new)`.

## Phase 1: Setup

- [X] T001 Add `@stryker-mutator/core`, `@stryker-mutator/jest-runner`, `@stryker-mutator/typescript-checker` at exactly 10.0.0 to `package.json` devDependencies and `package-lock.json` (plan Technical Context; FR-001)

## Phase 2: Foundational (the runner)

- [X] T002 Test: `scripts/mutation.spec.ts` (new) — for a project root: the Stryker options use `<root>/jest.config.cts`, `<root>/tsconfig.lib.json` when present else `<root>/tsconfig.app.json`, mutate `<root>/src/**/*.ts` minus `*.spec.ts`, `*.test.ts`, `**/generated/**`, `**/test-setup.ts`, set `ignoreStatic`, put the HTML report and the incremental file under `reports/mutation/<project>/`, turn `incremental` on only when asked, and let any key of the project's `stryker.config.json` override the shared one; a project with no `stryker.config.json` is an error naming the file; spec-file detection is true/false for a root with/without `*.spec.ts`/`*.test.ts`; the score is (Killed + Timeout) ÷ (Killed + Timeout + Survived + NoCoverage) × 100 with CompileError, RuntimeError, Ignored excluded and `n/a` when nothing counts; the summary row is `| <project> | <score>% | <break> |`, preceded by `| Project | Mutation score | Floor |` and its separator only when the summary file is empty (FR-001, FR-002, FR-004, FR-007, FR-009; contracts/mutation-target.md)
- [X] T003 `scripts/mutation.ts` (new) — `node scripts/mutation.ts <project> <root> [--incremental]`: prints `mutation: <project>` first; with no spec files prints `<project>: no tests yet, mutation run skipped` and exits 0 without starting Stryker; otherwise runs `new Stryker(options).runMutationTest()` and, when `GITHUB_STEP_SUMMARY` is set, appends the summary row; Stryker sets the exit code below the floor (research R6); the Jest runs inherit `DATABASE_URL` / `REDIS_URL` from the environment like `npm test` (FR-002, FR-003, FR-004, FR-005, FR-007, FR-008)
- [X] T004 `nx.json` `targetDefaults["test:mutation"]`: command `node scripts/mutation.ts {projectName} {projectRoot}`, `cache: false`, `TZ=UTC`; `"test:mutation": {}` in `apps/api/project.json`, `apps/mcp/project.json`, `apps/web/project.json`, `apps/worker/project.json`, `libs/contracts/project.json`, `libs/domain/project.json`, `libs/media/project.json`, `scripts/project.json` (research R10; FR-001)

## Phase 3: US1 — one project's score against its floor (P1)

**Independent test**: `npx nx run contracts:test:mutation` reports a score and exits 0; `npx nx run worker:test:mutation` reports no tests and exits 0.

- [X] T005 [US1] Record the measurements that exist in research.md R12 (planning spike: `contracts` 100%, 7 s; `domain` 1,071 mutants, 514-test initial run in 28 s, stopped by the owner before a score); no further local run (owner, 2026-10-04) (FR-009)
- [X] T006 [US1] `stryker.config.json` (new) in `apps/api`, `apps/mcp`, `apps/web`, `apps/worker`, `libs/contracts`, `libs/domain`, `libs/media`, `scripts`: `thresholds` `{ "high": 80, "low": 60, "break": 95 for contracts, 0 for the rest (unmeasured or no tests) }`; `scripts` overrides `mutate` (`scripts/*.ts` minus specs) and `tsconfigFile` (`scripts/tsconfig.json`) (FR-001, FR-004, FR-009; data-model.md)
- [X] T007 [US1] Run only the cheap checks locally: `nx show project <p>` lists `test:mutation` for all 8; `npx nx run worker:test:mutation` reports no tests without starting Stryker; the working tree shows nothing under `reports/` or `.stryker-tmp/`. The scored runs happen in the draft pull request's CI (owner, 2026-10-04) (SC-001, FR-004, FR-012)

## Phase 4: US2 — root commands (P2)

**Independent test**: `npm run test:mutation:affected` on this branch runs only affected projects.

- [X] T008 [US2] `package.json` scripts: `"test:mutation": "nx run-many -t test:mutation --parallel=1"`, `"test:mutation:affected": "nx affected -t test:mutation --parallel=1"` (FR-006)

## Phase 5: US3 — pull request scores (P2)

**Independent test**: the CI job on this branch's pull request runs the step and its summary lists each affected project.

- [X] T009 [US3] `.github/workflows/ci.yml`: after the pull-request test step, an `actions/cache` step for `reports/mutation` (key per head branch, fallback to any earlier key) and a step `npx nx affected -t test:mutation --base=origin/${{ github.base_ref }} --parallel=1 -- --incremental`, pull requests only, with `timeout-minutes: 60` — no full duration was measured; the follow-up task revises it from the first CI run (FR-005, FR-007, FR-008; research R8)

## Phase 6: US4 — the floors only rise (P3)

**Independent test**: `node .claude/scripts/harness-eval.mjs` passes the floor cases.

- [X] T010 [US4] `.claude/evals/cases/config-protection.json`: the lowering case targets `libs/contracts/stryker.config.json` (the only non-zero floor: 95 → 90); the second lowering case, which named the non-existent `apps/scanner`, is removed because no other floor can be lowered yet; the raising case targets `apps/api/stryker.config.json` (0 → 5); Jest-runner content (FR-010)

## Phase 7: Harness alignment

- [X] T011 Test: `.claude/scripts/doctor.spec.mjs` — mutation owners are the projects whose `project.json` declares `test:mutation`, including a root-level `scripts/` project; a `stryker.config.json` without the target is reported (FR-011)
- [X] T012 `.claude/scripts/doctor.mjs` `strykerOwners` / `checkCommands`: owners from `apps/*`, `libs/*`, `scripts` with a `stryker.config.json`, checked for a `test:mutation` target in `project.json` (FR-011)
- [X] T013 [P] `.claude/agents/mutation-runner.md`: inputs are this repo's 8 Nx projects; run `npx nx run <project>:test:mutation 2>&1 | tail -200`; scoping via `-- --mutate "<glob>"` (FR-011)
- [X] T014 [P] `.claude/skills/speckit-harden/SKILL.md` step 2b and `.specify/contexts/harden.md`: the projects with a `stryker.config.json` and the Nx target, not `-w apps/server` / `apps/scanner` (FR-011)

## Follow-up (separate task, not this branch)

- Measure each project's score from the draft pull request's CI (or a machine that can afford it), raise every unmeasured `thresholds.break` to 5 below its score, kill the surviving mutants, decide `concurrency` for `api`/`domain` (research R9), and set the CI `timeout-minutes` from real durations. Filed in Notion (see auto-run.md).

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 → T007; T008 after T004; T009 after T008; T010 after T006 (real floors); T011 → T012; T013, T014 any time after T004.

## Parallel opportunities

T013 and T014 (different files). T008 alongside T005.

## Implementation strategy

MVP is US1 (T001–T007): every project measurable against its floor. Commit slices: runner + targets (T001–T004 with T002's tests), configs and floors (T005–T007), root scripts + CI (T008–T009), harness (T010–T014).

# Research: Mutation testing across every app and lib

## R1. Where Stryker runs from

- **Decision**: from the repository root, with the project's paths in its options (`jest.configFile`, `tsconfigFile`, `mutate`), and a sandbox copy of the repo minus build output.
- **Rationale**: every Jest config extends `../../jest.preset.cjs` and the libs import each other through `tsconfig.base.json` paths; a sandbox rooted at the project directory would lose both. Proven by the spike: `libs/contracts` ran green from the root in 7 s.
- **Alternatives**: `inPlace: true` from the project dir (mutates the working tree; a crash leaves mutated source behind); running from the project dir with a sandbox (breaks the preset and path imports).
- **Evidence**: spike log 2026-10-04 (`Final mutation score of 100.00 … Done in 7 seconds`); `libs/contracts/jest.config.cts:5`; `tsconfig.base.json` `paths`.

## R2. Runner options: follow the `test` targets

- **Decision**: Stryker's Jest runner loads the project's own `jest.config.cts`; no Node flags (clarify Q1). `TZ=UTC` is set like the root `test` script.
- **Rationale**: the targets run plain `jest` (CommonJS via ts-jest); the spike ran both `contracts` and `domain` this way and the initial test runs passed (514 tests for `domain`).
- **Evidence**: `nx show project api --json` (`command: jest`, `TS_NODE_COMPILER_OPTIONS` CommonJS); `package.json` `"test": "TZ=UTC nx run-many -t test"`.

## R3. Shared options vs per-project file

- **Decision**: the shared options live in `scripts/mutation.ts`; `<project>/stryker.config.json` holds `thresholds` (required) and any override (for `scripts`: `mutate`, `tsconfigFile`), merged over the shared options.
- **Rationale**: Stryker's JSON config has no `extends`; eight full copies would drift. The ratchet guard reads `thresholds.break` from whatever file is named `stryker.config.json` (`.claude/hooks/config-protection.mjs:101`), so the floor must stay in that file.
- **Alternatives**: full config per project (drift); one root config with per-project CLI flags (floors could not be ratcheted per project).

## R4. Conventions the shared options derive per project

- `jest.configFile`: `<root>/jest.config.cts` (all 8 have one).
- `tsconfigFile`: `<root>/tsconfig.lib.json` if present, else `<root>/tsconfig.app.json` (apps); `scripts` overrides to `scripts/tsconfig.json`.
- `mutate`: `<root>/src/**/*.ts` minus `**/*.spec.ts`, `**/*.test.ts`, `**/generated/**`, `**/test-setup.ts`; `scripts` overrides to `scripts/*.ts` minus its specs.
- **Evidence**: `ls */*/tsconfig*.json` (2026-10-04): libs have `tsconfig.lib.json`, apps `tsconfig.app.json`, `scripts` only `tsconfig.json` + `tsconfig.spec.json`; `libs/domain/src/generated` is Prisma output (`.gitignore`).

## R5. Static mutants

- **Decision**: `ignoreStatic: true` in the shared options.
- **Rationale**: on `domain`, 150 static mutants (14%) are estimated at 67% of the run time, because each one reloads the module and runs every test. Ignored mutants are excluded from the score.
- **Evidence**: spike log `WARN MutantTestPlanner Detected 150 static mutants (14% of total) that are estimated to take 67% of the time`; schema `ignoreStatic` description (`node_modules/@stryker-mutator/core/schema/stryker-schema.json:352`).

## R6. The floor and the exit code

- **Decision**: use Stryker's own break check: its API sets `process.exitCode = 1` when the score is under `thresholds.break`; the script does not re-implement it.
- **Evidence**: `node_modules/@stryker-mutator/core/dist/src/reporters/mutation-test-report-helper.js:130-139` (`determineExitCode` → `objectUtils.setExitCode(1)`); `Stryker.runMutationTest(): Promise<MutantResult[]>` (`dist/src/stryker.d.ts:22`).

## R7. Score for the job summary

- **Decision**: computed from the returned `MutantResult[]`: (Killed + Timeout) ÷ (Killed + Timeout + Survived + NoCoverage) × 100; `n/a` when the denominator is 0. Appended as one Markdown table row to `$GITHUB_STEP_SUMMARY` when that variable is set.
- **Rationale**: Stryker's documented "mutation score" definition (compile/runtime errors and ignored mutants excluded); no extra dependency on `mutation-testing-metrics`, which is only a transitive dependency.

## R8. Incremental mode and CI

- **Decision**: `--incremental` is a flag of the script, passed by CI; the file is `reports/mutation/<project>/incremental.json` (git-ignored by `reports/`, `.gitignore:14-15`), cached with `actions/cache` keyed on the branch with a fallback to any earlier key. One CI step after the test step, pull requests only, `nx affected -t test:mutation --parallel=1`, one `timeout-minutes` set from the measured runs.
- **Rationale**: clarify Q3/Q4; the step reuses the job's PostgreSQL/Redis services and install (`.github/workflows/ci.yml:13-41`).

## R9. Database tests under parallel mutant runs

- **Decision**: decided from the full `domain` and `api` runs during implementation; if parallel test runners collide on the shared database (survivors or errors that disappear with one runner), those projects set `concurrency: 1` in their own `stryker.config.json`.
- **Evidence**: pending — the spike created 4 test-runner processes for `domain` (`ConcurrencyTokenProvider Creating 5 checker process(es) and 4 test runner process(es)`).

## R10. The Nx target

- **Decision**: `targetDefaults["test:mutation"]` in `nx.json` carries the command `node scripts/mutation.ts {projectName} {projectRoot}` (`cache: false`); each of the 8 `project.json` files declares `"test:mutation": {}` so only those projects have it. Root scripts: `nx run-many -t test:mutation --parallel=1` and `nx affected -t test:mutation --parallel=1`.
- **Rationale**: one definition of the command; Nx target defaults apply to targets a project declares.

## R11. Harness alignment

- **Decision**: `mutation-runner.md`, `speckit-harden/SKILL.md` and `.specify/contexts/harden.md` name `npx nx run <project>:test:mutation`; `doctor.mjs` finds owners from `project.json` targets (and includes `scripts/`); the two floor-lowering eval cases use real paths (`apps/api/stryker.config.json`, `libs/domain/stryker.config.json`).
- **Evidence**: `node .claude/scripts/harness-eval.mjs` on `main`: `FAILED blocks-lowering-the-mutation-floor: expected exit 2, got 0` — the cases name `apps/server`, which does not exist, so the guard sees no current floor (`.claude/evals/cases/config-protection.json:8,23`).

## R12. Measurements so far (owner stopped local runs, 2026-10-04)

| Project | Mutants | Score | Duration | Floor set |
|---|---|---|---|---|
| contracts | 21 (12 killed, 9 compile errors) | 100% | 7 s | 95 |
| domain | 1,071 (150 static) | not reached — stopped by the owner | initial test run 28 s (514 tests) | 0 |
| others | not run | — | — | 0 (worker: no tests) |

The spike ran without `ignoreStatic`; the committed options ignore static mutants (R5). The first full scores come from CI on the draft pull request; the follow-up task raises the floors from them.

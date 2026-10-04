# Implementation Plan: Mutation testing across every app and lib

**Branch**: `431-mutation-testing` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/431-mutation-testing/spec.md`

## Summary

Stryker Mutator (Jest runner, TypeScript checker) runs per Nx project through one `test:mutation` target. The target calls one small script, `scripts/mutation.ts`, which prints the project's name, skips a project with no spec files, merges the shared Stryker options with the project's own `stryker.config.json` (its floor and any override), runs Stryker through its API, and appends the project's score to the GitHub job summary when there is one. Root `npm run test:mutation` / `test:mutation:affected` run the targets one project at a time; CI runs the affected form on pull requests in incremental mode. Floors start a few points under a measured score. The harness (`mutation-runner`, `/speckit-harden`, the harden context, `doctor.mjs`, the ratchet eval cases) is pointed at these Nx targets and real paths.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Node ≥ 24 (`package.json` engines; `.nvmrc` = 24). Scripts run as `.ts` under Node's type stripping (`scripts/tsconfig.json`: `allowImportingTsExtensions`, `erasableSyntaxOnly`; precedent `node scripts/railway-deploy.ts`, `.github/workflows/release.yml:92`).

**Primary Dependencies**: `@stryker-mutator/core`, `@stryker-mutator/jest-runner`, `@stryker-mutator/typescript-checker`, all 10.0.0 (npm registry, 2026-10-04; engines node ≥ 22; peers core 10.0.0, typescript ≥ 3.6). Nx 23.2.1, Jest 30.5.2, ts-jest 29.4.14, jest-preset-angular 17.0.1 (`package.json`).

**Storage**: N/A. PostgreSQL and Redis are used only by the `api` and `domain` tests, through `DATABASE_URL` / `REDIS_URL` with the `postgresql://localhost:5432/postgres` default in the specs (`libs/domain/src/health/health.controller.spec.ts:12`), and the CI service containers (`.github/workflows/ci.yml:14-31`).

**Testing**: Jest per project via `jest.config.cts` and the Nx-inferred `test` target (`nx.json` plugin `@nx/jest/plugin`; `nx show project api` → `jest` with `TS_NODE_COMPILER_OPTIONS` forcing CommonJS, no Node flags). The new script's own spec runs in the `scripts` Jest project (`scripts/jest.config.cts`). Harness specs on vitest (`npm run test:harness`); harness evals via `node .claude/scripts/harness-eval.mjs`.

**Target Platform**: developer machines (macOS) and GitHub Actions `ubuntu-latest` (`.github/workflows/ci.yml:12`).

**Project Type**: build tooling in an Nx monorepo.

**Performance Goals**: measured, not assumed. Spike 2026-10-04: `libs/contracts` 21 mutants in 7 s; `libs/domain` 1,071 mutants, 514 tests in a 28 s initial run, static mutants 14% of mutants and ~67% of the estimated time (Stryker warning). The CI step's `timeout-minutes` is set in T-tasks from the measured per-project times.

**Constraints**: from context.md — the ratchet is `config-protection.mjs` (basename match, `.claude/hooks/config-protection.mjs:101`); a time-out fails the job and is not fixed by raising the timeout silently; `mutation-runner` and `/speckit-harden` call the Nx targets. From clarify — runner follows the `test` targets exactly; worker floor 0 with a pre-Stryker spec check; PR scope = Nx affected with dependants; one project at a time.

**Scale/Scope**: 8 Jest projects (`apps/api`, `apps/mcp`, `apps/web`, `apps/worker`, `libs/contracts`, `libs/domain`, `libs/media`, `scripts`), confirmed by `find apps libs scripts -maxdepth 2 -name 'jest.config.*'`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one script with three concrete jobs (skip, shared options, summary line), each required by an FR (FR-004, FR-001/002, FR-007/008); shared options live once in the script, so each project's `stryker.config.json` holds only its floor and real overrides. Three dev dependencies, all named by the story. No wrapper around Nx or Jest. See Complexity Tracking for the script.
- [x] **II. Test Discipline**: the script gets a colocated `scripts/mutation.spec.ts` written red first; the ratchet gets harness eval cases; each project's run is proven once on this branch.
- [x] **III. The Given Stack**: no product code changes; Stryker is tooling the story names.
- [x] **IV. One Repository, One Toolchain**: one Nx target per project from one `targetDefaults` entry; Jest stays the runner from each project's own config; no new linter or per-project tool config besides Stryker's own file the story requires.
- [x] **V. Rules Live in One Place**: shared Stryker options in one place (`scripts/mutation.ts`); floors in one place per project.
- [x] **VI. PostgreSQL Is the Truth**: N/A — no data.
- [x] **Notion choices**: no Proposed architecture choice or T-item touched; the story's own *(proposed)* items (incremental in CI, `test:mutation:affected`, initial floors, skip message) are adopted as written.

Post-design re-check (after Phase 1): unchanged, all pass.

## Project Structure

### Documentation (this feature)

```text
specs/431-mutation-testing/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/mutation-target.md
├── context.md
├── design.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
scripts/
├── mutation.ts                  (new) the target's command
├── mutation.spec.ts             (new)
├── stryker.config.json          (new) floor + mutate/tsconfig overrides (no src/)
└── project.json                 + test:mutation
apps/{api,mcp,web,worker}/
├── stryker.config.json          (new) floor (+ overrides if any)
└── project.json                 + test:mutation
libs/{contracts,domain,media}/
├── stryker.config.json          (new)
└── project.json                 + test:mutation
nx.json                          + targetDefaults["test:mutation"]
package.json                     + 3 devDependencies, test:mutation, test:mutation:affected
.github/workflows/ci.yml         + cache + mutation step (pull requests)
.claude/agents/mutation-runner.md          Nx target, real projects
.claude/skills/speckit-harden/SKILL.md     Nx target, real projects
.specify/contexts/harden.md                Nx target, real projects
.claude/scripts/doctor.mjs (+ doctor.spec.mjs)  owners from project.json targets, incl. scripts/
.claude/evals/cases/config-protection.json floor cases on real config paths
```

`libs/data-access` (generated) and `apps/web-e2e` (Playwright) get nothing (spec Edge Cases).

**Structure Decision**: Nx project per existing directory; the only new source file is `scripts/mutation.ts` in the existing `scripts` project, which already holds the repo's TypeScript tooling and its Jest config.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `scripts/mutation.ts` (one file, ~70 lines) | FR-004 needs a check before Stryker starts (Stryker fails on a project with no tests); FR-007/008 need the project's name printed and its score in the job summary; FR-001/002 share ~10 options across 8 projects | Plain `stryker run <file>` per project: 8 full copies of the shared options (drift, Principle IV rationale), no skip, no summary line; a shell one-liner in `nx.json` cannot compute the score |
| `ignoreStatic: true` | static mutants are ~67% of `domain`'s estimated time for 14% of mutants (spike); the story says a long run is a reason for incremental mode, not longer timeouts | Keeping them: multiplies the run time of every project with module-level constants for little signal; recorded so a later story can turn it off per project |

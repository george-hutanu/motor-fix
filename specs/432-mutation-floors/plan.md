# Implementation Plan: Measured mutation floors for every project

**Branch**: `432-mutation-floors` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

Make every project with specs reach a mutation score in the Mutation workflow,
kill the survivors of `contracts`, `mcp` and `api`, take one full measured run
on GitHub, and set each floor and the workflow's limit from it.

Root causes, from run 37215034382 (main, 2026-10-04):

1. Stryker's jest runner reads each project's `jest.config.cts` with
   `readInitialOptions`, which does not apply `preset`. The Angular projects get
   `testEnvironment: jsdom` only from the Nx preset, so Stryker records `node`
   and wraps the node environment: `document`, `localStorage` undefined and
   NG0200 on `DocumentToken` (`web`, `ui-cockpit`, `i18n`, `media`).
2. `web`'s four server specs set `@jest-environment node` in a docblock, which
   bypasses Stryker's environment wrapper: "Missing coverage results".
3. `overlays`' `form-parts.ts` gives `styles: ERROR_TEXT` a module constant;
   Stryker wraps the constant's string in a mutant switch and Angular's JIT
   transform rejects the decorator (error 1010).

## Technical Context

**Language/Version**: TypeScript 6.0.3 (package.json), Node from `.nvmrc`
**Primary Dependencies**: @stryker-mutator/core, jest-runner, typescript-checker 10.0.0; jest 30.5.2; jest-preset-angular 17.0.1; nx 23.2.1
**Storage**: PostgreSQL + Redis services in the Mutation workflow (api, domain)
**Testing**: Jest per project (`<project>/jest.config.cts`); mutation through `scripts/mutation.ts` (`nx run <p>:test:mutation`), only on GitHub
**Target Platform**: GitHub Actions `ubuntu-latest` (job ceiling 360 minutes)
**Project Type**: Nx monorepo tooling
**Performance Goals**: the full run fits the limit set from its own measurement
**Constraints**: no local Stryker runs; floors only rise (`config-protection`); what is mutated does not change; `ignoreStatic` stays
**Scale/Scope**: 11 Stryker projects, ~3,900 mutants

## Constitution Check

- I. No bloated code: three config lines, one docblock per server spec, one disable comment, one dispatch input, one summary column. No new dependency.
- II. Tests first: the config checks, workflow checks and new unit tests are written red before the fixes.
- VII. Lifecycle: draft PR #116, a push per commit, measured run linked in the PR.

Pass.

## Project Structure

### Documentation (this feature)

```text
specs/432-mutation-floors/
├── spec.md, plan.md, tasks.md, design.md, context.md
├── checklists/requirements.md
├── auto-run.md, notion-sync.md
└── deferred.md        # the per-project survivor follow-ups (FR-011)
```

### Source Code (repository root)

```text
apps/web/jest.config.cts, libs/{ui-cockpit,i18n,overlays,media}/jest.config.cts   # testEnvironment: 'jsdom'
apps/web/src/server/{edge,search}{,.adversary}.spec.ts                            # Stryker's node environment
libs/overlays/src/form-parts.ts                                                   # one disable line on ERROR_TEXT
scripts/mutation.ts, scripts/mutation.spec.ts                                     # duration column in the summary
scripts/mutation-setup.spec.ts                                                    # config and workflow checks (new)
.github/workflows/mutation.yml                                                    # full-run input, measured limit
libs/contracts/src/*.spec.ts, apps/mcp/src/*.spec.ts, apps/api/src/*.spec.ts       # tests that kill survivors
*/stryker.config.json                                                             # floors
```

**Structure Decision**: config fixes live in each project's own Jest config
(explicit beats a preset Stryker cannot read); the checks that keep them
fixed live in the `scripts` project, beside the mutation script they serve.

## Design decisions

- **Explicit `testEnvironment` per project** rather than an override in
  `scripts/mutation.ts`: the config file then says what it needs, for Jest
  and Stryker alike, and a check over every `jest.config.cts` keeps a new
  project from repeating the gap.
- **Server specs use `@stryker-mutator/jest-runner/jest-env/node`**: it is
  the Node environment with Stryker's coverage hooks, inert outside a
  mutation run. Alternatives: coverage analysis `off` for `web` (every test per
  mutant: too slow), or excluding the server code (changes what is mutated:
  out of scope).
- **`ERROR_TEXT` silenced, not inlined**: a CSS string mutant has no behaviour
  a unit test can observe, and inlining would duplicate it twice.
- **Full run on demand**: a `full` dispatch input skips restoring the cache
  and drops `--incremental`; the nightly run is unchanged.
- **Duration per project in the summary**: the limit is derived from
  numbers the workflow reports itself.
- **Limit**: job wall time of the full run × 1.3, rounded up to 10, capped at 360.

## Complexity Tracking

None.

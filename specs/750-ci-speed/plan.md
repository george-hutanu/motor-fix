# Implementation Plan: CI finishes faster and queues less on the free runner cap

**Branch**: `750-ci-speed` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/750-ci-speed/spec.md`

## Summary

Three files do the work and two files document it. `ci.yml` folds the 14
per-push jobs into 7 (changes, checks, tests, e2e, two docker builds, CI OK)
with 3 `setup` runs instead of 7, every folded check its own named step that
runs even when an earlier one failed. `playwright.config.mts` gives the CI
run the runner's cores (`workers: 4` to start, tuned from the PR's own runs)
and makes a retry-only pass a failure; a deployed run (`BASE_URL`) keeps the
preset. `release.yml` puts the `checks` job in a concurrency group that keeps
one pending release and never cancels a running one, and has `images` read
and write the Actions layer cache the PR builds read. AGENTS.md's PR CI
bullet and `docs/speed-and-cost-plan.md` follow. Tests first: a Jest spec in
`scripts/` reads both workflows as text (the repo's existing style) and
evaluates the Playwright config under Node with and without `BASE_URL`.

## Technical Context

**Language/Version**: TypeScript on Node 24 (`.nvmrc` = `24`; workflows use
`node-version-file: .nvmrc`). Node 24 evaluates `.mts` directly (type
stripping, unflagged since 23.6), which the config spec relies on; checked
locally with `node -e "import('./apps/web-e2e/playwright.config.mts')"`
(0.4 s).

**Primary Dependencies**: GitHub Actions (`actions/checkout@v7`,
`actions/setup-node@v7`, `actions/cache@v6`, `docker/build-push-action@v7`,
`docker/setup-buildx-action@v4`, all already in `ci.yml`/`release.yml`);
`@playwright/test` 1.63.0 (`package.json:52`) whose `TestConfig` has
`failOnFlakyTests?: boolean` (`node_modules/playwright/types/test.d.ts:1274`);
`@nx/playwright` preset sets `workers: process.env.CI ? 1 : undefined`,
`retries: process.env.CI ? 2 : 0`, `fullyParallel: true`
(`node_modules/@nx/playwright/dist/src/utils/preset.js:82-88`);
`@biomejs/biome` 2.5.15 as a devDependency (`package.json:42`), so the
folded Biome step runs `npx biome ci` from the install instead of
`biomejs/setup-biome@v2`. No new dependency.

**Storage**: N/A. The only state is GitHub's Actions cache (`type=gha`,
scopes `web` and `api`, already the scopes PR builds use in `ci.yml`).

**Testing**: Jest through the `scripts` project (`scripts/jest.config.cts`,
ts-jest, CommonJS; `scripts/*.spec.ts` are collected by `nx run-many -t test`
and by the Unit tests step with `JEST_SUITE=unit`). The workflow specs read
YAML as indented text with a `block`/`job` helper
(`scripts/pr-title-workflow.spec.ts`, `scripts/release-workflow.spec.ts`);
the repo has no YAML parser as a direct dependency and adds none.

**Target Platform**: `ubuntu-latest` GitHub-hosted runner, 4 vCPU, under the
free plan's 20 concurrent-job cap (spec, Evidence).

**Project Type**: CI configuration (workflows, one e2e config, docs). No app
or lib source changes; no screens (`design.md`).

**Performance Goals**: SC-001 ≤ 8 jobs per non-docs push (from 14); SC-003
≤ 4 `setup` runs (from 7); SC-002 E2E job ≤ 7 min on a web-affecting PR;
SC-007 CI OK ≤ today's ~11 min.

**Constraints**: Every check of today still runs and still fails CI OK
(FR-002, FR-007); a failing folded check is named in the job's failed log
(FR-003); docs-only PRs keep the two-job run (FR-009); `release.yml` calls
`ci.yml` with `run-many`, so the layout must keep the full run on `main`;
production deploys only after its own green staging (FR-006).

**Scale/Scope**: 5 files changed, 1 spec added, 1 spec extended; ~178
end-to-end tests go from 1 worker to 4.

**Baseline, measured** (run 37454922580, the latest green web-affecting PR
run, `gh run view --json jobs`): total 675 s; E2E
629 s; Docker (api) 276 s; Integration 242 s; Unit 140 s; Typecheck 69 s;
Build 61 s; Harness 53 s; Contract 49 s; Compose 28 s; Audit 17 s; Biome 6 s;
Changes 8 s; CI OK 4 s. Each of the seven `setup` runs is about 60 s of its
job. The `checks` fold is therefore about 60 s (one setup) + the net work of
seven jobs (roughly 4 min on that run, longer when `affected` is wide), well
under the E2E job that stays the critical path.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.1,
`.specify/memory/constitution-card.md`):

- [x] **I. No Bloat (NON-NEGOTIABLE)**: no new action, dependency, script or
  parser; the fold reuses the steps that exist, the cache reuses the scopes
  the PR builds already name, the specs reuse the text-reading helpers of
  `scripts/release-workflow.spec.ts` and `pr-title-workflow.spec.ts`. The
  Playwright change is two keys. Nothing is added "for a later matrix".
- [x] **II. Test Discipline**: `/speckit-tests` writes `scripts/ci-workflow.spec.ts`
  and the `release-workflow.spec.ts` cases red first; they are colocated with
  the scripts they sit beside and run in root Jest. No FR or task id in
  source. Playwright stays the end-to-end runner and every test still runs.
- [x] **III. The Given Stack**: untouched.
- [x] **IV. One Repository, One Toolchain**: one Nx monorepo, Biome only
  (`npx biome ci` on the pinned version is the same tool as today), root
  Jest; no second runner.
- [x] **V. Rules Live in One Place**: no API surface. The one place the CI
  layout is described is `ci.yml`; AGENTS.md's bullet names its jobs and the
  spec asserts the file, so the two cannot drift silently.
- [x] **VI. PostgreSQL Is the Truth**: no data.
- [x] **Notion choices**: none relied on. `context.md` read nothing (no
  Notion tool in that agent); the story card's Direction is in `spec.md`.
  No To-decide item is touched.

Post-design re-check: unchanged; no Complexity Tracking entry.

## Design

Decisions a research phase would have recorded, each with its evidence;
there is no `research.md` because no Technical Context value was unknown.

### D1. Playwright: cores on CI, retry-only passes fail

`apps/web-e2e/playwright.config.mts`, after the preset spread, when
`!deployed`: `workers: 4` and `failOnFlakyTests: true`; when `deployed`,
neither key (the preset's `workers: 1` and tolerated flakes stay for the
staging run, Clarifications Q3 and Q5). `retries` stays the preset's 2 so a
flaky test still records its trace (`trace: 'on-first-retry'`).

- Why 4 to start: the runner has 4 vCPU and also hosts the api, the worker,
  the web dev server, the mailbox and the OpenID stand-in. The final count is
  set from this PR's measured E2E runs against SC-002 (≤ 7 min); the chosen
  number and its measured run are recorded here before ready.
- Measured (run 37492214599, head b8d520e): E2E job 305 s at 4 workers,
  under SC-002's 7 min, so 4 stays.
- Evidence: preset `workers`/`retries`, preset.js:86-88;
  `failOnFlakyTests` typed, test.d.ts:1274; the config's `deployed` switch,
  playwright.config.mts:6.
- Edge: a test that only fails in parallel (shared seeded account, mailbox,
  OpenID stand-in, port) now fails the job (FR-010). It is fixed in the suite
  on this branch, not retried into green; the implementation phase reads the
  first parallel run's report for exactly that.
- Alternative rejected: sharding across runner jobs. It adds jobs under the
  same 20-job cap (US2).

### D2. `ci.yml`: 7 jobs, 3 setups, every check a named step

Jobs, in file order, each with the same `needs: changes` /
`if: needs.changes.outputs.docs-only != 'true'` gate as today (FR-009):

| Job id | Name (on the PR) | Setup | Steps | timeout-minutes |
|---|---|---|---|---|
| `changes` | Changes | none (setup-node only, as today) | classify | 5 |
| `checks` | Checks | 1 | Biome (`npx biome ci`), Typecheck (`npx nx $NX_SCOPE -t typecheck`), Build (`-t build`), Contract check (`sh scripts/contract-check.sh`), Harness (`npm run lint:harness`, `npm run test:harness`), Dependency audit (`npm audit --omit=dev --audit-level=high`, then `npm install --dry-run --ignore-scripts --no-audit --no-fund`), Compose stack (`up -d --wait postgres redis minio`, `run --rm minio-setup`, bucket check; `down -v --remove-orphans` in an `if: always()` step) | 45 |
| `tests` | Unit and integration tests | 1 | Migrate the test database, Unit tests (`JEST_SUITE=unit`), Integration tests (`JEST_SUITE=integration`), both `npx nx $NX_SCOPE -t test --passWithNoTests` | 30 |
| `e2e` | E2E tests | 1 | unchanged (workers come from D1) | 30 |
| `docker` | Docker build (web), Docker build (api) | none | unchanged matrix, PR-only | 30 |
| `ci-ok` | CI OK | none | `needs: [changes, checks, tests, e2e, docker]`, same result loop | 2 |

- Every check step in `checks` and `tests` carries a `name:` and
  `if: ${{ !cancelled() }}`, so a failed Biome does not stop Typecheck, the
  job fails, and `gh run view --log-failed` names each failed step (FR-003,
  Clarifications Q2). The Compose steps keep today's PR-only condition as
  `if: ${{ !cancelled() && github.event_name == 'pull_request' }}`, since
  `checks` also runs under `release.yml`'s `workflow_call`.
- `checks` checks out with `fetch-depth: 0` (Typecheck and Build use
  `affected --base=origin/<base>`); `tests` too. The `services` anchor moves
  from `integration` to `tests`; `e2e` keeps `*services`.
- `tests` gets the integration job's env (`DATABASE_URL`, `REDIS_URL`,
  `AUTH_TOKEN_SECRET`); `JEST_SUITE` moves from job env to each step's env
  (`jest.preset.cjs:8` selects by it; unset would run both suites twice).
- Dependency audit now runs after `npm ci`; `npm audit` reads the lockfile
  and `npm install --dry-run` re-resolves `package.json`, so both are
  unchanged in meaning.
- Job counts: non-docs push = changes + checks + tests + e2e + 2 docker +
  CI OK = 7 (SC-001 ≤ 8); setups = checks + tests + e2e = 3 (SC-003 ≤ 4);
  docs-only push = changes + CI OK (FR-009). On `main` (`run-many`), docker
  is skipped as today and `images` is the real build.
- Edge: `ci-ok`'s result loop (`success|skipped` pass, anything else fails)
  is unchanged, so a cancelled or failed folded job still turns CI OK red
  (FR-007); the merge gate reads `CI OK` and the check buckets by name, and
  only `Changes` and `CI OK` keep their names, which the Clarifications
  allow. Harness scripts that name old jobs: only a comment and a note
  string in `.claude/scripts/pr-test/run.mjs:17,376` ("Unit tests and E2E
  tests") — updated to the new names.
- Evidence: the 14 jobs and their steps, `ci.yml` as read; `setup` =
  `setup-node` + `npm ci`, `.github/actions/setup/action.yml`; wait-time
  cause, spec Evidence.
- Alternative rejected: one job for everything. The service-backed suites
  (~6 min) and E2E (~5 min after D1) would serialise behind the quick
  checks and break SC-007; three Node jobs keep the critical path at E2E.

### D3. `release.yml`: collapse pending checks, warm the cache

- `checks` (the `uses: ./.github/workflows/ci.yml` job) gets
  `concurrency: { group: release-checks, cancel-in-progress: false }`. GitHub
  keeps at most one pending job per group and cancels an older pending one
  when a newer arrives, never a running one; a cancelled `checks` means its
  release's `images`, `staging` and `production` never start, and a release
  whose checks started runs to the end (FR-006, Clarifications Q1). Job-level
  `concurrency` is valid on a reusable-workflow caller job. `staging` and
  `production` keep their groups (`release-staging`, `release-production`).
- `images`: the `web` build gets `cache-from: type=gha,scope=web` and
  `cache-to: type=gha,mode=max,scope=web`; `api` gets the same with
  `scope=api`; `worker` and `mcp` get `cache-from: type=gha,scope=api` only
  (same `node-app` target and `build` stage up to `ARG APP`; writing a third
  and fourth cache would evict the two the PRs read). The scopes are the
  ones `ci.yml`'s docker matrix already reads and writes
  (`cache-from: type=gha,scope=${{ matrix.app }}`), so a PR's first build
  now hits `main`'s layers (FR-005, Clarifications Q4). Cache keys are
  BuildKit's content hashes of the Dockerfile and copied files
  (`package.json`, `package-lock.json`, prisma schema), so a lockfile or
  base-image change invalidates the `npm ci` layer (US3 scenario 2).
- Evidence: `release.yml` `images` steps as read; `Dockerfile:7-15`
  (dependency layers before `COPY . .`); `ci.yml` docker job.
- Alternative rejected: a registry cache (`type=registry` on ghcr). It
  needs a login in PR builds and a second image; the Actions cache needs
  neither.

### D4. Documentation

- AGENTS.md "PR CI" bullet (line 280): lists Changes, Checks (its seven
  steps), Unit and integration tests, E2E tests, Docker build (web, api),
  CI OK; keeps the docs-only and `nx affected` sentences (FR-008, US5).
- `docs/speed-and-cost-plan.md`: a row 16 under "Done since" with the
  baseline above (675 s total, 629 s E2E, 14 jobs, 7 setups) and columns for
  the measured result, filled from this PR's runs before ready; SC-004 and
  SC-005 go to the merged PR's finish comment (spec Assumptions).

### D5. Tests, red first

`scripts/ci-workflow.spec.ts` (new, Jest, `scripts` project), text-reading
like its siblings plus one spawned evaluation:

- `ci.yml`: job ids are exactly `changes, checks, tests, e2e, docker, ci-ok`
  (≤ 8 PR jobs counting the two-entry docker matrix); jobs using
  `./.github/actions/setup` ≤ 4 (exactly `checks, tests, e2e`); every check
  step present by `name:` (Biome, Typecheck, Build, Contract check, Harness,
  Dependency audit, Compose stack, Unit tests, Integration tests) with
  `if: ${{ !cancelled() }}`; the unit and integration steps set
  `JEST_SUITE`; every job but `changes` and `ci-ok` has
  `needs: changes` and the docs-only `if`; `ci-ok` is `if: always()`, its
  `needs` lists every other job id, and its loop fails on anything but
  `success|skipped`.
- `playwright.config.mts`: spawn `node -e "import(<config>)..."` printing
  `workers` and `failOnFlakyTests`, with `env: { CI: '1' }` expecting
  `{ workers: 4, failOnFlakyTests: true }` and with `BASE_URL` set expecting
  `{ workers: 1, failOnFlakyTests: undefined }` (the `pr-title-workflow.spec`
  already spawns a process the same way). The expected worker count is a
  single constant the measurement may change.
- `scripts/release-workflow.spec.ts` (extended): `checks` has
  `group: release-checks`, `cancel-in-progress: false`; each `images` build
  step has `cache-from: type=gha,scope=<web|api>`; `web` and `api` have
  `cache-to: type=gha,mode=max,scope=<self>`; `worker` and `mcp` have none.

Measurement, not a spec: SC-001, SC-002, SC-003 and SC-007 are read from
this PR's own runs (`gh run view <id> --json jobs`) and written to D1, D4
and `auto-run.md` before ready. SC-006 is checked once by hand on the branch
(a Biome violation in a scratch commit turns CI OK red, then reverted) and
recorded in `auto-run.md`.

## Project Structure

### Documentation (this feature)

```text
specs/750-ci-speed/
├── spec.md              # final, with Clarifications
├── plan.md              # this file
├── quickstart.md        # how to verify each SC on the PR's runs
├── design.md            # no screens
├── context.md           # Notion digest (unavailable in that run)
└── tasks.md             # /speckit-tasks output (not created here)
```

`research.md`: not written — no NEEDS CLARIFICATION remained; the decisions
and their evidence are in Design above. `data-model.md` and `contracts/`:
N/A — the feature has no entities, no API and no data; it changes CI
configuration only.

### Source Code (repository root)

```text
.github/
├── workflows/ci.yml                 # 14 jobs → 7, steps named, 3 setups
├── workflows/release.yml            # checks concurrency, images cache
└── actions/setup/action.yml         # unchanged
apps/web-e2e/playwright.config.mts   # workers and failOnFlakyTests on CI
scripts/
├── ci-workflow.spec.ts              # (new) ci.yml layout + Playwright config
└── release-workflow.spec.ts         # + checks concurrency, images cache
.claude/scripts/pr-test/run.mjs      # job names in a comment and a note
AGENTS.md                            # PR CI bullet
docs/speed-and-cost-plan.md          # row with baseline and result
```

**Structure Decision**: no new directory. The specs sit in `scripts/`,
where the repository already tests its workflows as text under the `scripts`
Jest project; the Playwright config is tested by evaluating it, which Node 24
does without a build step.

## Complexity Tracking

No violations.

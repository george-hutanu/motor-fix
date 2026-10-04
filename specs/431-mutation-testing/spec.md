# Feature Specification: Mutation testing across every app and lib

**Feature Branch**: `431-mutation-testing`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-431 Set up mutation testing across every app and lib in the monorepo (Notion story: https://app.notion.com/p/3ef607bff0d28172bf64e2e2cdb952f4). So that a green test suite means the code is actually checked, not just run: Stryker on every Jest project, a thresholds.break floor per project that only rises, an Nx test:mutation target per project, one root command for all and one for affected, CI running it on changed projects for a PR with per-project score in the job summary."

**Sources**: the Notion story ST-431 (acceptance criteria and Build brief, read 2026-10-04; the story has no comments), its dependency ST-421 (`specs/421-monorepo-platform/`), `.specify/memory/constitution.md` v1.1.0, and this repository. The Build brief wins where it and the acceptance criteria differ.

The users of this story are the build team and the harness's own commands (`/speckit-harden`, the `mutation-runner` subagent), not drivers or garages. The tool it names (Stryker Mutator) is the requirement itself: the story fixes it.

## Clarifications

### Session 2026-10-04

- Q: Does the mutation run follow the `test` targets exactly as they exist today (no `--experimental-vm-modules`), or add the flag the story's scenario 3 names? → A: Follow the targets exactly; the repo is the authority on what they run, and a flag nothing uses would need a wrapper (Principle I). If the `test` targets ever move to ESM, the mutation run inherits it.
- Q: What is `apps/worker`'s committed `thresholds.break`, and where is "no tests" detected? → A: `break: 0`; the target checks for spec files under the project before starting Stryker, prints that the project has no tests and exits zero. The first spec turns the real run on with no config edit; that story's harden pass raises the floor.
- Q: Does a pull request's run mutate the dependants of a changed project, or only the projects whose own files changed? → A: Dependants too (Nx affected, as the existing test step does), because a change in a lib can leave a dependant's tests checking nothing; incremental mode keeps it affordable.
- Q: On a time-out, what must the output contain, and is the limit per project or per step? → A: One time limit on the CI step; projects run one at a time and each run starts by naming its project, so the last named project is the one cut off. The number is set in plan.md from the measured run times.
- Owner, 2026-10-04 (during the run): mutation runs are too expensive for the development laptop. Do not run them locally now; measuring the projects and fixing their surviving mutants is a separate follow-up task; open the pull request as a draft. → Floors start at 0 except where a score was already measured (`libs/contracts`: 100% in the planning spike); the first measured scores come from CI on the draft pull request.
- Q: Who asked for "find any project's floor and score with one command" (SC-004), when no score is stored in the repository? → A: Nobody; dropped. The floor is in each `stryker.config.json`; the score is the output of the project's run and the pull request's job summary.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A developer measures how well one project's tests check its code (Priority: P1)

A developer runs the mutation target for one project. The tool changes small pieces of that project's source (not its tests, not generated code), reruns the project's own tests against each change, and reports a score: the share of changes the tests noticed. A score below the project's floor fails the run.

**Why this priority**: every other story's harden pass needs this per-project measurement; without it the floor in the constitution's workflow is unmeasurable.

**Independent Test**: run the mutation target for `libs/contracts`; it reports a score and exits zero at the committed floor. Lower the measured score below the floor (for example by pointing the run at a floor above the score) and it exits non-zero.

**Acceptance Scenarios**:

1. **Given** any project with a Jest configuration and tests, **When** its `test:mutation` target runs, **Then** the source under that project's `src` (or, for `scripts`, its source files) is mutated using that project's own Jest configuration, spec files and generated code are never mutated, and a mutation score is reported.
2. **Given** a project's score below its `break` floor, **When** the run finishes, **Then** it exits non-zero.
3. **Given** a project whose tests need PostgreSQL and Redis (`api`, `domain`), **When** its mutation run starts, **Then** its tests reach the same services through the same `DATABASE_URL` / `REDIS_URL` as `npm test`.
4. **Given** a project with no spec files yet (`apps/worker` today, floor 0), **When** its mutation target runs, **Then** it reports that the project has no tests and exits zero without starting a mutation run.

---

### User Story 2 - A developer runs every project, or only what a change touched, from the root (Priority: P2)

From the repository root, one command runs every project's mutation target, and another runs only the projects a change touched compared with `main`.

**Why this priority**: a full run is slow; the affected form is what a developer and CI use day to day.

**Independent Test**: run the root affected command on a branch that touches only `libs/contracts`; only the projects that depend on `contracts` run.

**Acceptance Scenarios**:

1. **Given** the root, **When** `npm run test:mutation` runs, **Then** every project's `test:mutation` target runs through Nx.
2. **Given** a branch that changed some projects, **When** `npm run test:mutation:affected` runs, **Then** only the affected projects' targets run.

---

### User Story 3 - A pull request shows each changed project's mutation score (Priority: P2)

On a pull request, CI runs the mutation targets of the affected projects and writes each project's score into the job summary. A score below a floor fails the job, which names the project.

**Why this priority**: the floor protects nothing if nobody runs it before merge.

**Independent Test**: open a pull request touching one project; the CI job runs that project's mutation target and the job summary lists its score.

**Acceptance Scenarios**:

1. **Given** a pull request, **When** CI runs, **Then** the affected projects' mutation targets run against the same PostgreSQL and Redis service containers the test step uses, and the job summary shows one score line per project that ran.
2. **Given** a project below its floor, **When** the CI job finishes, **Then** the job fails and its output names the project.
3. **Given** a mutation step in CI that exceeds its time limit, **When** it is cut off, **Then** the job fails, and the last project named in the step's output is the one that was running.

---

### User Story 4 - The floors only rise (Priority: P3)

Each project's `break` floor is a ratchet: an edit that lowers it is refused; a genuinely equivalent surviving mutant is silenced on its line with a comment saying why.

**Why this priority**: the guard exists (`.claude/hooks/config-protection.mjs`); this story's configs must sit inside what it watches, and the harness evals must prove it.

**Independent Test**: a harness eval case feeds an edit that lowers a project's `thresholds.break` through the guard and asserts the refusal.

**Acceptance Scenarios**:

1. **Given** a project's `stryker.config.json`, **When** an edit lowers `thresholds.break`, **Then** the edit is refused.
2. **Given** the same file, **When** an edit raises `thresholds.break`, **Then** the edit is allowed.

---

### Edge Cases

- A project with no spec files: the mutation target says so and exits zero (Story 1, scenario 4).
- A project whose tests need a database that is not running: the run fails at its initial test run with the test error, not with a score of zero.
- The generated client `libs/data-access` and the Playwright project `apps/web-e2e` have no mutation target.
- A lib created after this story has no target until it first gets tests; it then adds its own configuration.
- A project with spec files but no `stryker.config.json`: the run fails at start and names the missing file; it never runs without a floor.
- A project whose source has no mutable code (score undefined): the run reports `n/a` and passes its floor.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every project with a Jest configuration (`apps/api`, `apps/worker`, `apps/web`, `apps/mcp`, `libs/contracts`, `libs/domain`, `libs/media`, `scripts`) MUST have its own `stryker.config.json` with a `thresholds.break` floor and an Nx `test:mutation` target.
- **FR-002**: A project's mutation run MUST mutate only that project's non-test, non-generated TypeScript source and MUST run that project's own Jest configuration, with the same runtime options as its `test` target.
- **FR-003**: A mutation run MUST report a mutation score and MUST exit non-zero when the score is below the project's `thresholds.break`.
- **FR-004**: A mutation run for a project with no spec files MUST report that and exit zero without starting Stryker; such a project's floor is 0.
- **FR-005**: Projects whose tests need PostgreSQL and Redis MUST reach them through the same `DATABASE_URL` / `REDIS_URL` as `npm test`.
- **FR-006**: The root MUST provide `npm run test:mutation` (every project) and `npm run test:mutation:affected` (only projects affected relative to `main`), both through Nx.
- **FR-007**: CI MUST run the affected projects' mutation targets (changed projects and their dependants, as Nx computes them) on every pull request, one project at a time, in incremental mode, against the same service containers as the test step, and MUST write one score line per project into the job summary.
- **FR-008**: The CI mutation step MUST fail when any project is below its floor or the step exceeds its time limit; each project's run MUST start by printing the project's name, so the failing or cut-off project is named in the output.
- **FR-009**: A project's `thresholds.break` MUST start at 5 points below a measured score, rounded down, where one exists, and at 0 otherwise (no spec files, or not yet measured); `low` and `high` MUST be 60 and 80. Raising the unmeasured floors from real scores is the follow-up task's work.
- **FR-010**: Every project's `stryker.config.json` MUST be within what `config-protection.mjs` guards, and a harness eval case MUST show that lowering a `thresholds.break` is refused.
- **FR-011**: The `mutation-runner` subagent and `/speckit-harden` MUST invoke the Nx targets and name this repository's projects, not the `npm -w apps/server` / `apps/scanner` form.
- **FR-012**: Stryker's working files and reports MUST stay out of git.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 8 Jest projects have a mutation target; the draft pull request's CI runs the affected ones at their committed floors and its job summary shows a score per project (`worker` reporting no tests).
- **SC-002**: A pull request that touches one project runs mutation for that project and its dependants only, and its job summary shows their scores.
- **SC-003**: A floor-lowering edit is refused in 100% of harness eval runs.

## Assumptions

- `libs/media` and `scripts` are in scope although the story's list of six predates them: the Build brief's rule is "every project that has a `jest.config.cts`", and its note that later libs "add their own config when they first get tests" covers `media` (autonomous default).
- "The same runtime options as its `test` target" (FR-002) follows the Nx-inferred `test` targets as they are in `nx show project`, which run `jest` with `TS_NODE_COMPILER_OPTIONS` forcing CommonJS and do not pass `--experimental-vm-modules`; the story's scenario 3 and AGENTS.md describe that flag, but the targets it says to copy do not use it today (clarified 2026-10-04: follow the targets).
- Incremental mode is used in CI for pull requests, with the incremental file per project git-ignored and cached between CI runs, as the Build brief proposes (autonomous default).
- Whether a full non-incremental run happens nightly or only before release is the owner's open question in the story; this story ships no scheduled full run (autonomous default; out of scope until the owner decides).
- Mutants that only run while a module loads (static mutants) are not tested and do not count toward the score; on `libs/domain` they are 14% of mutants and about two thirds of the run time (spike, 2026-10-04). A later story may turn them back on per project (autonomous default).
- "A few points below" the measured score (story, Rules and validation) is fixed at 5 points (autonomous default).
- Raising scores by writing tests is out of scope: each feature's harden pass does that (story, Out of scope).
- The CI time limit for the mutation step is one `timeout-minutes` on that step; no source fixes the number, so the plan sets it from the measured run times (clarified 2026-10-04).
- `scripts` (a Jest project, neither app nor lib) is in scope by the Build brief's rule "every project that has a `jest.config.cts`" (autonomous default; recorded in context.md as a contradiction with the story's list of six).

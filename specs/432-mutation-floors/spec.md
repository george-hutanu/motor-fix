# Feature Specification: Measured mutation floors for every project

**Feature Branch**: `432-mutation-floors`

**Created**: 2026-10-05

**Status**: Archived (2026-10-06)

**Input**: User description: "ST-432: Measure every project's mutation score, kill the surviving mutants and raise the floors."

**Notion story**: [ST-432 — Measure every project's mutation score, kill the surviving mutants and raise the floors](https://app.notion.com/p/3ef607bff0d28123bf09dc9243e3570d) (Task, High, EP-1 Foundations). Split out of ST-431, which shipped the mutation tooling with every floor at 0 except `contracts` at 95.

## User Scenarios & Testing *(mandatory)*

The "user" here is the owner and every agent that changes code: the mutation
floor is how they learn that a change weakened the tests guarding a project.

### User Story 1 - Every project gets a real score (Priority: P1)

The owner starts the Mutation workflow and gets a mutation score for every
project that has tests, instead of five projects stopping at their first test
run.

**Why this priority**: a floor cannot be set from a run that never reached a
score. Today `web`, `ui-cockpit`, `i18n`, `overlays` and `media` fail before
any mutant is tested, and `contracts` fails its own floor.

**Independent Test**: dispatch the workflow for the eleven projects; its job
summary lists a score for each project with specs.

**Acceptance Scenarios**:

1. **Given** an Angular project whose specs pass under the normal test run, **When** the Mutation workflow runs it, **Then** its first, unmutated test run passes too and a score is reported.
2. **Given** a component whose metadata reads a module-level constant, **When** that constant is mutated, **Then** the run still compiles the component and reports the mutant, instead of the whole project failing.
3. **Given** a spec that runs in the server (Node) environment inside a browser-environment project, **When** the Mutation workflow runs, **Then** that spec's coverage is reported and the run does not stop on missing coverage.
4. **Given** a project with no specs (`worker`), **When** the workflow runs, **Then** it is skipped with a line saying so and the job does not fail.

### User Story 2 - Surviving mutants are dealt with (Priority: P1)

Every surviving or uncovered mutant in the projects this story closes is
either killed by a test or, when it cannot change behaviour, silenced on its
line with the reason.

**Why this priority**: a floor set over known survivors locks in weak tests.

**Independent Test**: the measured run for those projects reports no
surviving and no uncovered mutants that are not silenced with a reason.

**Acceptance Scenarios**:

1. **Given** `contracts` (51.25 today, floor 95), **When** its new tests run under mutation, **Then** its score is at least 95 and the floor holds without being lowered.
2. **Given** a mutant that is genuinely equivalent, **When** it is silenced, **Then** the silencing comment names the mutator and says why no test can tell the difference.

### User Story 3 - Floors and timeout follow the measurements (Priority: P2)

Each project's floor is raised to its measured score minus five, rounded down,
and the workflow's time limit comes from the measured durations.

**Why this priority**: it is what keeps the scores from sliding later; it
depends on stories 1 and 2 having produced the numbers.

**Independent Test**: compare each `thresholds.break` with the score in the
final measured run's summary; compare the workflow's limit with that run's
duration.

**Acceptance Scenarios**:

1. **Given** a project measured at score S, **When** its floor is set, **Then** the floor is `floor(S) - 5` (never below 0), unless the current floor is higher, in which case it stays.
2. **Given** the final measured run took T minutes, **When** the limit is set, **Then** the workflow's time limit is T plus headroom, recorded with how it was derived.

### Edge Cases

- A project whose measured score minus five is below its current floor keeps its current floor (the ratchet only rises). For `contracts`, `mcp` and `api`, a failing floor means survivors are killed until it passes; for any other project, it is recorded in that project's follow-up (FR-011), not fixed here.
- A run restored from the incremental cache reports a score that includes mutants it did not re-test; the run that sets the floors and the limit is a full (non-incremental) run.
- `api` and `domain` share one PostgreSQL and Redis; they keep one test runner at a time so parallel runners do not truncate each other's tables.
- A project whose run exceeds the job's time limit loses its score; the limit must cover the slowest project plus the rest.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each Angular project (`web`, `ui-cockpit`, `i18n`, `overlays`, `media`) MUST pass its unmutated test run under the mutation tool and report a score from the Mutation workflow.
- **FR-002**: A spec that runs in the Node environment inside a browser-environment project MUST report its coverage to the mutation tool, so its project is not stopped for missing coverage.
- **FR-003**: The test run MUST no longer fail with Angular's "Argument needs to be an object literal that is statically analyzable" (error 1010) when a module-level constant read by a component decorator is mutated. Only a constant whose sole use is compile-time component metadata (for example `styles`) is silenced, on its line, with the mutator and the reason.
- **FR-004**: The mutation script MUST skip a project with no specs (`worker`) with a line saying so, without failing the run.
- **FR-005**: Every surviving and uncovered mutant in `contracts`, `mcp` and `api` MUST be killed by a test or silenced on its line with `// Stryker disable next-line <mutator>: <reason>`.
- **FR-006**: `contracts` MUST score at least its existing floor of 95.
- **FR-007**: Each project's `thresholds.break` MUST be set to its measured score minus five, rounded down, never below 0 and never lower than its current value.
- **FR-008**: `api` and `domain` MUST keep one test runner at a time (`concurrency: 1` in `apps/api/stryker.config.json` and `libs/domain/stryker.config.json`, already set by ST-431; unchanged here).
- **FR-009**: The Mutation workflow's `timeout-minutes` MUST be set from the measured durations, with the derivation stated next to it.
- **FR-010**: Every score and duration used for a floor or the limit MUST come from a Mutation workflow run on GitHub, never a local run; the run is linked in the PR.
- **FR-011**: The survivors left in `domain`, `scripts` and the five Angular projects MUST each be filed as a tracked follow-up with its measured survivor count.
- **FR-012**: The Mutation workflow MUST accept a dispatch input that runs without the incremental results of earlier runs, so a full measurement can be taken on demand; the nightly run stays incremental.

### Key Entities

- **Project mutation result**: project, score, killed / survived / no-coverage / timeout / error counts, duration, run link.
- **Floor**: a project's `thresholds.break`; rises only.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Mutation workflow run on the branch reports a score for all ten projects with specs (eleven minus `worker`), and fails none of them.
- **SC-002**: `contracts`, `mcp` and `api` report 0 surviving and 0 uncovered mutants that are not silenced with a reason.
- **SC-003**: Every project's floor equals `max(current floor, floor(measured score) - 5)` for the linked run.
- **SC-004**: The workflow's limit is the wall time of the linked full run's job plus 30% headroom, rounded up to the next 10 minutes, and at most GitHub's 360-minute job ceiling.
- **SC-005**: Every silenced mutant is listed in the PR with its mutator and reason.

## Clarifications

### Session 2026-10-05

- Q: Does "every surviving mutant is killed" cover all eleven projects in this story? → A: No (autonomous default). The run of 2026-10-04 left 168 survived and 130 uncovered mutants in `domain`, 43 and 95 in `scripts`, and five Angular projects whose survivors are not yet known (about 1,500 mutants among them). This story kills every survivor in `contracts`, `mcp` and `api`, makes every project measurable, and sets every floor from the measurement; the survivors of `domain`, `scripts` and each Angular project are filed as one follow-up task per project (FR-011). Reason: one 5-point story, and a review of several hundred new tests across eight projects in one PR would be unreadable. Recorded for the owner as a decision taken on their behalf.
- Q: Must the linked run be non-incremental? → A: Yes; the workflow gains a dispatch input that drops `--incremental` (FR-012). An inherited cache would make the floors depend on mutants never re-tested.
- Q: What is T for the limit, and what if it overflows 360 minutes? → A: T is the job's wall time in the full run; the limit is capped at 360 and an overflow is recorded as a follow-up (the per-runner database the Build brief allows).
- Q: Who verifies an equivalence claim? → A: the PR lists every silence with its reason (SC-005) and the code review checks each one.
- Q: Which failure does FR-003 fix? → A: Angular's error 1010 in Stryker's first test run of `overlays`; only constants used solely as compile-time metadata are silenced.
- Q: Does the kill-until-it-passes rule apply to every project? → A: Only to `contracts`, `mcp` and `api`; elsewhere it goes into the follow-up.

### Session 2026-10-06 (resume, from the full runs on 642127f)

- Q: The full runs of `overlays` (37360179393) and `ui-cockpit` (37360184588) still stop on error 1010 with `ERROR_TEXT` silenced. What else does FR-003 cover? → A: the option objects of `input()`, `output()` and the signal queries (`{ alias: 'mfTaskSubmit' }` in `libs/overlays/src/form-parts.ts`, the aliases in `libs/ui-cockpit/src/lib/helm/switch.ts`). Stryker ships an ignorer for exactly these (`ignorers: ['angular']`); it is turned on for every project in `scripts/mutation.ts`, since it only matches those calls. No line-level silence is added for them (autonomous default; evidence: `@stryker-mutator/instrumenter/dist/src/frameworks/angular-ignorer.js`).
- Q: `scripts`' full run (37360170703) fails its first test run in `test-services.spec.ts`. Why, and is it in scope? → A: Stryker runs the specs from a copy under the git-ignored `.stryker-tmp/`, where `git ls-files` lists nothing, so the script finds no projects and exits 0. In scope (SC-001: every project scores). The spec now tells git the copy is the work tree (`GIT_DIR`, `GIT_WORK_TREE`); outside Stryker that is the same checkout.
- Q: `domain`'s full run (37360166653) was cancelled at the 360-minute job ceiling with no score. What floor does it get? → A: it keeps its current floor (0): FR-007 sets floors from a full run and none fits in one job. The overflow is a follow-up (the per-runner database, per the clarification above) in `deferred.md`; the assumption that one runner is fast enough for `domain` no longer holds.

## Assumptions

- The Notion acceptance criteria list ten projects including `worker` and without `overlays`; `overlays` was added to the tooling after the story was written and is included, and `worker` is listed but has no specs (autonomous default).
- `worker` has no specs (only `apps/worker/src/main.ts`), so it has no score and its floor stays 0 (autonomous default).
- The headroom rule in SC-004 (30%, rounded up to 10 minutes) is an assumption, not a number from any source (autonomous default).
- Static mutants stay ignored (`ignoreStatic`), and what is mutated does not change (Build brief: out of scope).
- ~~`domain`'s duration (95 minutes on 2026-10-04) is acceptable with one runner~~: refuted by the full run 37360166653 (over 360 minutes, incremental results dropped); see Session 2026-10-06.

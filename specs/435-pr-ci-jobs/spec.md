# Feature Specification: PR CI as parallel standard checks, and mutation testing in its own workflow

**Feature Branch**: `435-pr-ci-jobs`
**Created**: 2026-10-04
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-435 — https://app.notion.com/p/3ef607bff0d2818992b3cd348695ed53
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A reviewer sees which kind of check failed (Priority: P1)

A pull request shows one check per kind of verification (Biome, typecheck, unit
tests, integration tests, e2e tests, build, harness, contract, dependency audit,
PR title, Docker build) and one aggregate `CI OK`, so a red PR says at a glance
what broke, and the owner can later require a single check.

**Independent Test**: open a PR; the checks list shows every job and `CI OK`.

**Acceptance Scenarios**:

1. **Given** a PR, **When** CI runs, **Then** each kind of check is its own job, and the jobs run in parallel.
2. **Given** any job fails or is cancelled, **Then** `CI OK` fails; **given** every job passes (or is skipped because it does not apply, like the title check on a push), **then** `CI OK` passes.
3. **Given** a new commit is pushed to the PR, **Then** the run for the previous commit is cancelled.
4. **Given** a PR title that is not a Conventional Commit (`type(scope)!: subject`), **Then** the title check fails and says why.

### User Story 2 - Unit and integration tests run apart (Priority: P1)

Tests that need PostgreSQL or Redis are named `*.integration.spec.ts`; the unit
job runs every other spec with no services, and the integration job runs only
those, with PostgreSQL+PostGIS and Redis service containers.

**Independent Test**: `JEST_SUITE=unit` and `JEST_SUITE=integration` list disjoint sets of files whose union is every spec.

**Acceptance Scenarios**:

1. **Given** `JEST_SUITE=unit`, **Then** Jest selects no `*.integration.spec.ts` file.
2. **Given** `JEST_SUITE=integration`, **Then** Jest selects only `*.integration.spec.ts` files.
3. **Given** no `JEST_SUITE`, **Then** Jest selects every spec, as before (local runs and the pre-commit hook are unchanged).
4. **Given** a spec that reads `DATABASE_URL` or `REDIS_URL` from the environment, **Then** its name ends in `.integration.spec.ts`.

### User Story 3 - The e2e suite runs on every PR (Priority: P1)

The e2e job starts the api and web inside the job (against service containers),
installs Chromium from a cache, and runs the Playwright `web-e2e` suite.

### User Story 4 - Mutation testing never slows a PR (Priority: P2)

Mutation testing runs from its own workflow, on demand (optionally for one
project) and on a schedule on `main`, never on a pull request, and keeps its
HTML reports as artifacts.

### Edge Cases

- `release.yml` calls `ci.yml` through `workflow_call` on a push to `main`: every job must run for every project (no `affected`), and no PR-only job may fail it.
- A change to `ci.yml` alone must still exercise every job: `ci.yml` is a shared global input, so it marks every project affected.
- Two merges in quick succession must not cancel each other's release checks.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `.github/workflows/ci.yml` MUST run, as separate parallel jobs: Biome (`biome ci`), typecheck, unit tests, integration tests, e2e tests, build, harness lint and tests, contract check, dependency audit, and a Docker build of the root Dockerfile.
- **FR-002**: On a pull request the Nx jobs MUST run `nx affected` against the base branch; through `workflow_call` (the merge to `main`) they MUST run `nx run-many` on every project.
- **FR-003**: A final `CI OK` job MUST need every other job and fail when any of them failed or was cancelled.
- **FR-004**: CI MUST cancel an in-progress run of the same PR when a newer commit arrives, and MUST NOT cancel runs on `main`.
- **FR-005**: The workflow MUST grant only `contents: read`, and every job MUST carry a `timeout-minutes`.
- **FR-006**: On a pull request, a job MUST fail when the PR title is not a Conventional Commit.
- **FR-007**: Jest MUST select only `*.integration.spec.ts` files when `JEST_SUITE=integration`, every other spec when `JEST_SUITE=unit`, every spec when unset, and refuse any other value.
- **FR-008**: Every spec that reads `DATABASE_URL` or `REDIS_URL` from the environment, or runs the seed, MUST be named `*.integration.spec.ts`.
- **FR-009**: The integration job MUST run against PostgreSQL+PostGIS and Redis service containers after `prisma migrate deploy`; the unit job MUST run with no services.
- **FR-010**: The e2e job MUST run the Playwright `web-e2e` suite against the api and web started inside the job, with the Playwright browsers cached between runs.
- **FR-011**: The contract check job MUST fail when `apps/api/openapi.json` or the generated `data-access` client differs from what is committed.
- **FR-012**: PR CI MUST NOT run mutation testing.
- **FR-013**: `.github/workflows/mutation.yml` MUST run Stryker on `workflow_dispatch` (optional project input) and on a schedule on `main`, never on `pull_request`, restore and save the incremental report cache, upload the HTML reports as artifacts, and carry a timeout.
- **FR-014**: AGENTS.md MUST list the CI jobs and the mutation workflow.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014
- **Modifies**: 421-FR-027 — PR CI is the jobs of 435-FR-001, run on the affected projects.

## Success Criteria *(mandatory)*

- **SC-001**: The PR that ships this shows every job of FR-001 and `CI OK` green on itself.
- **SC-002**: `mutation.yml` runs once by hand and its outcome is reported.

## Clarifications

### Session 2026-10-04

- Q: How are unit and integration tests told apart? → A: by file name, `*.integration.spec.ts`, selected through `JEST_SUITE` in the shared Jest preset; the distinction is real (the integration specs open PostgreSQL or Redis connections). (autonomous default; evidence: `process.env['DATABASE_URL']` in `libs/domain/src/health/health.controller.spec.ts:12`)
- Q: Does the default `npm test` change? → A: no: unset `JEST_SUITE` runs everything, so local runs, the pre-commit hook and the agent gates keep their coverage. (autonomous default)
- Q: Which Docker targets does the build check cover? → A: `web` and `node-app` (built for `api`): every stage of the Dockerfile, while `worker` and `mcp` reuse `node-app` with another `APP`. (autonomous default; private repo, Actions minutes count)
- Q: Who ships mutation.yml? → A: PR #8 (ST-431): its owning session moved mutation out of ci.yml into `.github/workflows/mutation.yml` (nightly on main, `workflow_dispatch` with a `projects` input, services, incremental cache, `mutation-reports` artifact, 180-minute timeout). This feature does not create or edit it; it keeps ci.yml free of mutation steps and verifies #8 before merging. FR-013 is delivered there. (coordinator decision)

## Assumptions

- Making `CI OK` a required status check is a branch-protection setting the owner makes. (autonomous default)
- The PR title rule allows an optional scope, because merged PR titles here include unscoped ones (PR #1). (autonomous default)

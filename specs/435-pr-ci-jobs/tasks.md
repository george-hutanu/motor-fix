# Tasks: PR CI as parallel standard checks, and mutation testing in its own workflow

**Input**: `specs/435-pr-ci-jobs/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 Test: `scripts/test-suites.spec.ts` — `jest --listTests` with `JEST_SUITE=unit` lists no `*.integration.spec.ts`, with `integration` lists only those (and at least one), unset lists both; an unknown value is refused; every spec reading `DATABASE_URL`/`REDIS_URL` from the environment or running the seed is named `*.integration.spec.ts` (FR-007, FR-008)

## Phase 2: The unit / integration split

- [X] T002 `jest.preset.cjs` selects specs by `JEST_SUITE`; `nx.json` adds `JEST_SUITE` and `ci.yml` to the inputs so caches and `affected` follow them (FR-007, FR-002)
- [X] T003 Rename the specs that need PostgreSQL or Redis to `*.integration.spec.ts`: `apps/api/src/bootstrap.integration.spec.ts`, `apps/api/src/bootstrap.adversary.integration.spec.ts`, `libs/domain/src/auth/accounts.service.integration.spec.ts`, `libs/domain/src/auth/auth.api.integration.spec.ts`, `libs/domain/src/auth/auth.adversary.http.integration.spec.ts`, `libs/domain/src/health/health.controller.integration.spec.ts`, `libs/domain/src/health/health.adversary.integration.spec.ts`, `libs/domain/src/health/health.adversary2.integration.spec.ts`, `libs/domain/src/seed.integration.spec.ts` (FR-008)
- [X] T004 Root scripts `test:unit` and `test:integration` (FR-007)

## Phase 3: CI jobs

- [X] T005 `.github/actions/setup/action.yml`: checkout-independent Node + `npm ci` composite (FR-001)
- [X] T006 `.github/workflows/ci.yml`: jobs pr-title, biome, typecheck, unit, integration, e2e, build, harness, contract, audit, docker (matrix web, api), ci-ok; concurrency, permissions, timeouts; affected on PR, run-many on workflow_call; contract job runs scripts/contract-check.sh (FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-009, FR-010, FR-011, FR-012)
- [X] T007 `apps/web-e2e/playwright.config.mts`: a web-server timeout long enough for a cold CI build (FR-010)

## Phase 4: Mutation workflow

- [X] T008 (moved to ST-431 / PR #8 by the coordinator: that PR ships `.github/workflows/mutation.yml`; this branch only keeps mutation out of ci.yml) `.github/workflows/mutation.yml` on `workflow_dispatch` (project input) and schedule, services for the integration specs, incremental cache, HTML report artifacts, timeout (FR-013)

## Phase 5: Docs and proof

- [X] T009 AGENTS.md: the CI jobs and the mutation workflow (FR-014)
- [X] T010 PR runs the new CI on itself (run 37189061812 green); `mutation.yml` dispatched once by the ST-431 session (run 37189204423, success) (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-007, FR-008 | `scripts/test-suites.spec.ts` |
| FR-001–FR-006, FR-009–FR-012 | the PR's own CI run (job list and results) |
| FR-013 | the `mutation.yml` dispatch run |
| FR-014 | AGENTS.md diff |

# Tasks: CI finishes faster and queues less on the free runner cap

**Input**: `specs/750-ci-speed/` spec.md, plan.md, quickstart.md
**Tests**: red first (Constitution II): the failing specs come before any workflow or config edit.
**Format**: `- [ ] T### [P?] [US?] Description with file path`

## Phase 1: Red specs (blocking)

- [X] T001 [P] [US2] Write `scripts/ci-workflow.spec.ts` (new): `ci.yml` job ids are exactly `changes, checks, tests, e2e, docker, ci-ok`; only `checks, tests, e2e` use `./.github/actions/setup`; each check step (Biome, Typecheck, Build, Contract check, Harness, Dependency audit, Compose stack, Unit tests, Integration tests) is named with `if: ${{ !cancelled() }}` and the unit and integration steps set `JEST_SUITE`; every job but `changes` and `ci-ok` has `needs: changes` and the docs-only `if`; `ci-ok` is `if: always()`, needs every other job and fails on anything but `success|skipped`. Run it and see it fail. (FR-002, FR-003, FR-004, FR-007, FR-009)
- [X] T002 [P] [US1] In the same file, add the Playwright config case: spawn `node` importing `apps/web-e2e/playwright.config.mts` with `CI=1` expecting `workers: 4, failOnFlakyTests: true`, and with `BASE_URL` set expecting `workers: 1, failOnFlakyTests: undefined`; worker count is one constant. See it fail. (FR-001, FR-010)
- [X] T003 [P] [US3] [US4] Extend `scripts/release-workflow.spec.ts`: `checks` has `group: release-checks` and `cancel-in-progress: false`; `images` web and api steps have `cache-from` and `cache-to: type=gha,mode=max` on their own scope; worker and mcp have `cache-from: type=gha,scope=api` and no `cache-to`; staging and production groups unchanged. See it fail. (FR-005, FR-006)

## Phase 2: Playwright config (US1, P1)

- [X] T004 [US1] Edit `apps/web-e2e/playwright.config.mts`: when not `deployed`, set `workers: 4` and `failOnFlakyTests: true` after the preset spread; deployed keeps the preset. T002 passes. (FR-001, FR-010)
- [X] T005 [US1] Run the e2e suite in parallel, read the report, and fix in `apps/web-e2e/` any test that fails only in parallel (shared account, mailbox, OpenID stand-in, port); no retry-masking. (FR-001)

## Phase 3: ci.yml (US2, P1)

- [X] T006 [US2] Rewrite `.github/workflows/ci.yml` per plan D2: jobs `changes, checks, tests, e2e, docker, ci-ok`; fold the Biome, Typecheck, Build, Contract, Harness, Audit and Compose steps into `checks`, unit and integration into `tests` (job env, `JEST_SUITE` per step, `services` anchor moved), keep `e2e` and the PR-only `docker` matrix, `ci-ok` needs all. T001 passes. (FR-002, FR-003, FR-004, FR-007, FR-009)

## Phase 4: release.yml (US3, US4)

- [X] T007 [US4] Edit `.github/workflows/release.yml`: job-level `concurrency: { group: release-checks, cancel-in-progress: false }` on `checks`. (FR-006)
- [X] T008 [US3] Edit `.github/workflows/release.yml` `images`: Actions layer cache per plan D3 (web and api read and write; worker and mcp read `scope=api`). T003 passes. (FR-005)

## Phase 5: Documentation (US5, P3)

- [X] T009 [P] [US5] Update AGENTS.md "PR CI" bullet to the jobs of the new `ci.yml` (Changes, Checks and its steps, Unit and integration tests, E2E tests, Docker build web and api, CI OK). (FR-008)
- [X] T010 [P] [US5] Add the row to `docs/speed-and-cost-plan.md` with the baseline (14 jobs, 7 setups, 675 s total, 629 s E2E); the result column is filled in T012. (FR-008)
- [X] T011 [P] [US5] Update the old job names ("Unit tests and E2E tests") in `.claude/scripts/pr-test/run.mjs` (comment near line 17 and the note near line 376). (FR-008)

## Phase 6: Measurement (before ready)

- [ ] T012 Read SC-001, SC-002, SC-003 and SC-007 from this PR's own CI runs (`gh run view <id> --json jobs`, per quickstart.md); tune the worker count in T004's constant and T002 if SC-002 is missed; record the numbers and chosen count in plan.md D1, the `docs/speed-and-cost-plan.md` row and `specs/750-ci-speed/auto-run.md`. Check SC-006 once with a scratch Biome violation (CI OK red), then revert. SC-004 and SC-005 go to the merged PR's finish comment. (FR-001, FR-002, FR-004, FR-007)

## Dependencies

T001-T003 first (red). T004 then T005; T006 needs T001; T008 needs T003; T009-T011 after T006; T012 last, after the PR's CI has run.

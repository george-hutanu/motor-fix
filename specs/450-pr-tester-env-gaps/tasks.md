# Tasks: Close the PR tester's two environment gaps: file storage and API calls

**Input**: `specs/450-pr-tester-env-gaps/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `.claude/scripts/pr-test/services.spec.mjs` — the local plan with a MinIO binary starts MinIO on the given ports inside the run directory with the storage credentials and reports storage; without one it does not; `createBucket` creates the bucket on an S3 endpoint and accepts one that exists (FR-001)
- [X] T002 [US1] Test: `.claude/scripts/pr-test/findings.spec.mjs` — `readinessOutcome`: storage-only failure with no object store is a note, with one it is a blocker, another failed check is a blocker, 200 is nothing (FR-002)
- [X] T003 [US2] Test: `.claude/scripts/pr-test/endpoints.spec.mjs` — `changedEndpoints` (every method, path parameters, absent base), `roleFor`, `exampleValue` (required fields, example, enum, format, minLength, minimum, minItems, `$ref`), sign-outs last (FR-003, FR-004, FR-005, FR-006)
- [X] T004 [US2] Test: same file — `callEndpoints` against a fake API: signs in per role, sends the bearer token, the refresh cookie under `/api/v1/auth/`, the id from the parent collection, the generated body; lists what it could not call with the reason; a 5xx is a high finding (FR-004, FR-005, FR-006)
- [X] T005 [US3] Test: `findings.spec.mjs` — `cutOffFinding` names the signal and the phase and blocks (FR-007)
- [X] T006 [US3] Test: `post.spec.mjs` — `missingReport` is a failure carrying the reason; `postVerdict` on it sets `agent-review` failure (FR-008)
- [X] T007 [US3] Test: `services.spec.mjs` — `runDirPrefix` carries the pid; `cleanStale` stops PostgreSQL, Redis and MinIO of a dead run, removes its directory and compose project, prunes worktrees, and leaves a live run alone (FR-009)
- [X] T008 [US4] Test: `sweep.spec.mjs` — `parseRoute`, the matrix keeps role and status, `loadProblem` and `dropExpected` for an expected status (FR-010); a role route asks for a session per context (FR-011)
- [X] T009 [US4] Test: `pr-qa-workflow.spec.mjs` — the routes check accepts `@role` and `:status` and refuses a quote or space (FR-012)
- [X] T010 [US3] Test: `run.spec.mjs` — `testsCommand` skips the Nx cache (FR-013); `.claude/agents/pr-tester.md` names the storage note, background runs, `--missing`, the route syntax and the endpoint calls (FR-014)

## Phase 2: Implementation

- [X] T011 [US1] `services.mjs`: MinIO in `localPlan`, `createBucket`; `run.mjs`: start, wait, bucket, teardown, seven ports (FR-001)
- [X] T012 [US1] `findings.mjs` `readinessOutcome`; `run.mjs` uses it (FR-002)
- [X] T013 [US2] `endpoints.mjs`; `run.mjs`: seed step, `callEndpoints` replaces the GET-only loop; `changedGetEndpoints` removed (FR-003–FR-006)
- [X] T014 [US3] `run.mjs` signal handler writes the report first; `findings.mjs` `cutOffFinding` (FR-007)
- [X] T015 [US3] `post.mjs` `missingReport` and `--missing` (FR-008)
- [X] T016 [US3] `services.mjs` `runDirPrefix`, `cleanStale`; `run.mjs` calls it before a local lap (FR-009)
- [X] T017 [US4] `sweep.mjs` route syntax, expected status, sessions; `run.mjs` passes a session signer (FR-010, FR-011)
- [X] T018 [US4] `.github/workflows/pr-qa.yml` routes check (FR-012)
- [X] T019 [US3] `run.mjs` `--skip-nx-cache`; `.claude/agents/pr-tester.md` (FR-013, FR-014)

## Phase 3: Proof

- [X] T020 `npm run test:harness` and `npm run lint` green (SC-004)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `services.spec.mjs` › T001 |
| FR-002 | `findings.spec.mjs` › T002 |
| FR-003 | `endpoints.spec.mjs` › T003 |
| FR-004 | `endpoints.spec.mjs` › T003, T004 |
| FR-005 | `endpoints.spec.mjs` › T003, T004 |
| FR-006 | `endpoints.spec.mjs` › T003, T004 |
| FR-007 | `findings.spec.mjs` › T005 |
| FR-008 | `post.spec.mjs` › T006 |
| FR-009 | `services.spec.mjs` › T007 |
| FR-010 | `sweep.spec.mjs` › T008 |
| FR-011 | `sweep.spec.mjs` › T008 |
| FR-012 | `pr-qa-workflow.spec.mjs` › T009 |
| FR-013 | `run.spec.mjs` › T010 |
| FR-014 | `run.spec.mjs` › T010 |

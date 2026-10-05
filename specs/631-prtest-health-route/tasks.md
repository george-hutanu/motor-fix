# Tasks: The PR tester checks the API's real health routes

**Input**: `specs/631-prtest-health-route/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `.claude/scripts/pr-test/services.spec.mjs` — `HEALTH` matches the controller's `@Controller`/`@Get` routes; `apiHealth(apiURL)` `health()`/`ready()` hit `/health/live` and `/health/ready` on a local server (FR-001, FR-002)
- [X] T002 [US1] [US2] Test: `.claude/scripts/pr-test/qa-in-ci.spec.mjs` — no bare `/health` in the agent, the skill, the pr-test scripts or `pr-qa.yml`; the agent's flows section names `health()`, `ready()` and both routes; `run.mjs` passes them to the flows and uses `HEALTH` (FR-001, FR-002, FR-003)

## Phase 2: Implementation

- [X] T003 `.claude/scripts/pr-test/services.mjs`: `HEALTH` and `apiHealth(apiURL)` (FR-001, FR-002)
- [X] T004 `.claude/scripts/pr-test/run.mjs`: its own checks use `HEALTH`; the flows receive `health` and `ready` (FR-001, FR-002)
- [X] T005 `.claude/agents/pr-tester.md` §2 and §3: the helpers and both routes (FR-003)

## Phase 3: Proof

- [X] T006 `npm run test:harness` green; `node .claude/scripts/harness-eval.mjs --check`; `node .claude/scripts/doctor.mjs` clean

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `services.spec.mjs` (helpers hit the routes); `qa-in-ci.spec.mjs` (run.mjs passes them to the flows) |
| FR-002 | `services.spec.mjs` (HEALTH matches the controller); `qa-in-ci.spec.mjs` (run.mjs uses HEALTH) |
| FR-003 | `qa-in-ci.spec.mjs` (no bare `/health`; the agent names both routes and helpers) |

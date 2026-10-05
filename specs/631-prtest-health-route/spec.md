# Feature Specification: The PR tester checks the API's real health routes

**Feature Branch**: `fix-prtest-health-route`

**Created**: 2026-10-05

**Status**: Draft

**Input**: "Twice, on #108 and #110, the pr-tester wrote a flows file that called the API's `/health`. The API serves `/health/live` and `/health/ready`. Each time this produced a false HIGH finding, 'API /health not 200', withdrawn by hand. Find why, correct the docs and examples, and give the flows a `health()`/`ready()` that use the real routes, read from `apps/api`."

Notion: ST-631 https://app.notion.com/p/3f0607bff0d281aeb08edf5a760db01e (Bug, Epic EP-1).

## Finding: the liveness route was never named

- The API serves exactly two health routes, both outside the `api/v1` prefix: `GET /health/live` and `GET /health/ready` (`libs/domain/src/health/health.controller.ts`: `@Controller('health')`, `@Get('live')`, `@Get('ready')`; `apps/api/src/bootstrap.ts`: `setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] })`; `apps/api/openapi.json`). There is no `/health`.
- `.claude/agents/pr-tester.md` §2 gives the flows file's arguments (`baseURL, apiURL, outDir, repoRoot`) and tells the agent to "call the changed API endpoints with `fetch(apiURL + path)`", with no word on the health routes. §3 says the run checks "health and `/health/ready`": the readiness route is named, the liveness one is the bare word "health". An agent that wants a health check in its flows is left to guess, and `/health` is the guess.
- No example flows file exists, and nothing the flows receive knows the routes: `run.mjs` hard-codes `/health/live` and `/health/ready` inline for its own checks. The `speckit-pr-test` skill, `sweep.mjs` and the other helpers do not mention a health route.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A flows file checks health without knowing the routes (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a flows file, **When** `run.mjs` runs it, **Then** its default export receives `health()` and `ready()`, which call `GET <apiURL>/health/live` and `GET <apiURL>/health/ready` and return the response.
2. **Given** the API's health controller, **When** the harness specs run, **Then** the routes the helpers call are the ones the controller declares.

### User Story 2 - The docs name the real routes (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the pr-tester agent, the speckit-pr-test skill, the pr-test scripts and the PR QA workflow, **When** the harness specs run, **Then** none names a bare `/health` route.
2. **Given** the agent's flows section, **When** the agent reads it, **Then** it names `health()` and `ready()` and both routes, and says the run already checks them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `run.mjs` MUST pass `health()` and `ready()` to the flows default export, calling `/health/live` and `/health/ready` on the API it booted.
- **FR-002**: The routes the helpers and `run.mjs` call MUST be defined once and MUST match `libs/domain/src/health/health.controller.ts`.
- **FR-003**: No pr-test doc, script or workflow MUST name a bare `/health` route; the agent doc MUST name both real routes and the helpers.

## Success Criteria *(mandatory)*

- **SC-001**: The next flows file the tester writes reaches the health routes through `health()`/`ready()`, and no "API /health not 200" finding appears.

## Assumptions

- The helpers return the `fetch` Response, so a flow checks `status` and the body as it does for any endpoint (autonomous default: the smallest surface; the flows already use `fetch`).
- The routes live beside `waitForHttp` in `.claude/scripts/pr-test/services.mjs`, the module that already owns the health wait (autonomous default: no new module, Principle I).
- No change to the API: its routes are right; the tester was wrong.

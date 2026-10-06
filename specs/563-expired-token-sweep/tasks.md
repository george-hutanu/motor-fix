---

description: "Task list for ST-563 expired-token sweep"
---

# Tasks: Refuse an expired token on every gated route

**Input**: `specs/563-expired-token-sweep/` (plan.md, spec.md, research.md, quickstart.md)

**Tests**: the deliverable is the test itself; test-only, no product code (FR-006).

## Phase 1: User Story 1 - Every gated route refuses an expired session (Priority: P1) 🎯 MVP

**Goal**: the route sweep calls every route outside `PUBLIC` with an expired but otherwise genuine token and requires 401 `sign_in_required`, no `set-cookie`.

**Independent Test**: `JEST_SUITE=integration` run of `apps/api/src/public-routes.integration.spec.ts` (via `scripts/heavy.sh`) is green; it goes red if any gated route honours an expired token.

- [ ] T001 [US1] In `apps/api/src/public-routes.integration.spec.ts`, take `databaseTurn` (`@motor-fix/domain/testing`) for the file, create a driver account via `AccountsService.createAccount` with `roles: ['driver']` in the existing set-up, and add one `it` that signs an access token for it with `signAccessToken` at `now = Date.now() - 24h` (role `driver`) and, for every non-`PUBLIC` route from `openApiDocument(app).paths` (path params filled with the sweep's placeholder id, empty JSON body, listed method), requires status 401, code `sign_in_required` and no `set-cookie`, reusing the no-credential case's refusal check (FR-001, FR-002, FR-003, FR-005; SC-001, SC-002)
- [ ] T002 [US1] In the same `it` in `apps/api/src/public-routes.integration.spec.ts`, before the sweep, sign a fresh unexpired token for the same account and require `GET /api/v1/me` to answer 200, so the refusals are proved to be for expiry alone (FR-004; story 1 scenario 2)

**Checkpoint**: the file passes with `npx nx test api` (integration suite) and `biome check` is clean; `git diff --stat origin/main` shows only this spec file (SC-003, SC-004).

## Dependencies & Execution Order

- T001 and T002 edit the same `it` in the same file: sequential, T001 then T002. User Story 2 (exhaustive by construction, FR-003) is met by T001 iterating the OpenAPI paths; it needs no task of its own.
- MVP: both tasks; there is nothing to defer.

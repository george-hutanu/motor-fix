# Tasks: Pre-commit brings up its own integration database

**Input**: `specs/517-precommit-integration-db/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [P] [US1] Test: `scripts/test-services.spec.ts` — the compose project name is per worktree and valid for compose; services are needed only when an affected project holds an integration spec; the environment points at the private ports and is printed as shell-safe exports; the port parser reads `docker compose port`; the no-Docker message carries the exact commands (FR-002, FR-003, FR-004, FR-005)
- [X] T002 [P] [US2] Test: `.claude/scripts/heavy.spec.mjs` — the hook refuses a commit with `JEST_SUITE` set, before anything else runs; inside the slot it sources `scripts/test-services.ts` and fails when that fails, before `nx affected` (FR-001, FR-003, FR-005, FR-006)

## Phase 2: Implementation

- [X] T003 [US1] `scripts/test-services.ts`: decide, start (`docker compose -p <worktree> up -d --wait postgres redis` on Docker-assigned ports), wait for PostgreSQL, `prisma migrate deploy`, print `export DATABASE_URL=… REDIS_URL=…`; everything but the exports on stderr (FR-002–FR-005)
- [X] T004 [US2] `.husky/pre-commit`: refuse `JEST_SUITE`; in the slot, `services=$(node scripts/test-services.ts $base) && eval "$services" &&` before the unchanged `nx affected … && npm run lint` (FR-001, FR-006)
- [X] T005 `AGENTS.md` (integration tests line) and `docs/speed-and-cost-plan.md` (row 8): pre-commit brings the worktree's services up itself; `JEST_SUITE` is refused

## Phase 3: Proof

- [X] T006 `npx jest -c scripts/jest.config.cts`, `npm run test:harness` green; `node .claude/scripts/doctor.mjs` clean (no gate script changed, so no bless)
- [X] T007 Real commit in this worktree with no services: the hook starts `mf-test-…`, migrates it and runs the affected integration specs green (SC-001); `JEST_SUITE=unit git commit` refused (SC-002)
- [X] T008 Review fixes, tests first: recreate the worktree database when it holds another branch's migrations (`schemaDrift`, proven live by injecting a foreign migration row); refuse a `project.json` without a name (`projectName`); the no-Docker run exits 1 with empty stdout (stub `docker`); untracked integration specs count; `TEST_SERVICES_WAIT_SECONDS`; migrate failure names `down -v` (FR-002, FR-003, FR-005)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `.claude/scripts/heavy.spec.mjs` (hook run with `JEST_SUITE=unit` exits 1 naming it); T007 |
| FR-002 | `scripts/test-services.spec.ts` (project name, needs-services, port parsing); T007 |
| FR-003 | `scripts/test-services.spec.ts` (env + exports, schema drift); `heavy.spec.mjs` (sourced before `nx affected`); T007 |
| FR-004 | `scripts/test-services.spec.ts` (no integration spec in the affected projects → not needed) |
| FR-005 | `scripts/test-services.spec.ts` (no-Docker message); `heavy.spec.mjs` (`&&` chain: a failing script stops the tests) |
| FR-006 | `heavy.spec.mjs` existing assertions on `nx affected -t typecheck test --base=$base` and `npm run lint`, unchanged |

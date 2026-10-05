# Feature Specification: Pre-commit brings up its own integration database

**Feature Branch**: `chore-precommit-integration-db`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "Fix .husky/pre-commit so worktrees without a running, migrated PostgreSQL/Redis no longer fail on the affected integration specs and agents stop bypassing with JEST_SUITE=unit, without weakening any check (no check removed, only moved, deduplicated or made cheaper — docs/speed-and-cost-plan.md). Evaluate the three options, pick one and justify."

Notion: ST-599 https://app.notion.com/p/3f0607bff0d281f4aa2ef26f367af174 (Task, Epic EP-1). Sources: the description above and this repository.

## Decision: option 1 (with option 3's refusal folded in)

| Option | Keeps the check where it is | Cost | Verdict |
| --- | --- | --- | --- |
| 1. Pre-commit starts the worktree's own PostgreSQL + Redis and migrates it | Yes: the integration specs still run before every commit, against the branch's own schema | One small compose project per worktree, started once and reused; startup and `migrate deploy` only when an affected project has integration specs | **Chosen** |
| 2. Unit-only pre-commit; integration moved to the Stop gate / hand-off; CI as backstop | Moves it later. The Stop gate would hit the same missing database; CI-only turns a local failure into a push → red CI → fix lap, which costs more turns than it saves | Cheaper commit, dearer repair loop | Rejected: moving the check to where it still needs the database solves nothing, and CI-only weakens the local check in practice |
| 3. Failure message + a gate refusing `JEST_SUITE=unit git commit` | Yes, but every worktree still has to bring the database up by hand, and an env-var gate in the Bash hook misses `export JEST_SUITE=…` earlier in the session | A failed commit and a manual setup per worktree | Its two good parts are kept: the refusal moves into the hook itself (which sees the real environment, however it was set), and the no-Docker case fails with the exact commands |

Evidence: `docker compose` and `prisma migrate deploy` per private project are already how the PR tester runs (`.claude/scripts/pr-test/run.mjs`, `services.mjs`); several worktrees on this machine already run their own compose project by hand (`256-live-in-place`, `chore-pr-qa-actions`); some integration specs flush Redis (`libs/domain/src/auth/email-confirmation*.integration.spec.ts`), so worktrees cannot share one Redis; branches carry different migrations, so they cannot share one database.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A commit in a fresh worktree runs the integration specs (Priority: P1)

An agent commits in a worktree that has no database running. The commit's checks start the worktree's own PostgreSQL and Redis, apply the branch's migrations, and run the affected unit and integration specs against them.

**Why this priority**: it removes the reason agents bypass the integration suite.

**Independent Test**: in a worktree with no services, commit a change to `libs/domain`; the hook starts a compose project named after the worktree, migrates it, and the integration specs run green.

**Acceptance Scenarios**:

1. **Given** a worktree whose affected test projects contain integration specs and no services, **When** it commits, **Then** a PostgreSQL and a Redis private to that worktree are started, migrated, and the affected tests run against them.
2. **Given** those services already run from an earlier commit, **When** it commits again, **Then** they are reused and only the migrations are reapplied.
3. **Given** the affected test projects contain no integration specs, **When** it commits, **Then** nothing is started.

---

### User Story 2 - The bypass is refused (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `JEST_SUITE` is set in the committing environment (any value, exported or inline), **When** the hook runs, **Then** the commit is refused with a message saying the commit runs both suites and to unset it.

---

### User Story 3 - No Docker says exactly what to do (Priority: P2)

**Acceptance Scenarios**:

1. **Given** Docker is not installed or not running and the services are needed, **When** the hook runs, **Then** the commit fails before any test with the commands that would bring the services up, and never falls back to the unit suite.

### Edge Cases

- Services start but a migration fails: the commit fails with the migration's output.
- `DATABASE_URL` / `REDIS_URL` are already set in the committing shell: the hook still uses the worktree's own services, so a branch's migrations never touch another branch's database.
- Two worktrees commit at once: each has its own compose project and Docker-assigned ports, so neither collides with the other or with the default 5432/6379.
- PostgreSQL is running but not yet accepting connections: the hook waits for it (bounded) before migrating.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The pre-commit hook MUST refuse the commit when `JEST_SUITE` is set in its environment, naming the variable.
- **FR-002**: When at least one affected project with a `test` target contains an `*.integration.spec.ts`, the hook MUST make a PostgreSQL and a Redis private to the worktree available — a compose project whose name is derived from the worktree's directory, on host ports Docker assigns — starting them only if they are not already running, inside the heavy-command slot.
- **FR-003**: Before the tests, the hook MUST apply the branch's migrations to that database (recreating it first when it holds a migration the branch does not have, or one applied with other SQL) and run the affected tests with `DATABASE_URL` and `REDIS_URL` pointing at those services, overriding any value in the environment.
- **FR-004**: When no affected test project contains integration specs, the hook MUST start no services and run the affected tests as before.
- **FR-005**: When the services are needed and Docker is unavailable, or the services or migrations fail, the hook MUST fail the commit before the tests run, printing the command that failed and, for missing Docker, the commands that would bring the services up by hand.
- **FR-006**: The affected scope, the typecheck and the lint the hook runs MUST stay as they are: both suites, same base, same projects.

### Key Entities

- **Worktree services**: one compose project per worktree (PostgreSQL with PostGIS, Redis), kept between commits; its volume holds the schema of the branch last committed there, recreated when the worktree's branch carries other migrations.

## Success Criteria *(mandatory)*

- **SC-001**: A commit in a worktree with no services and an affected project with integration specs runs the integration specs and passes, with no manual setup.
- **SC-002**: A commit made with `JEST_SUITE` set is refused every time.
- **SC-003**: A commit whose affected projects have no integration specs starts no container.

## Assumptions

- Docker is the supported way to run the services locally (constitution / AGENTS.md: integration tests need `docker compose up -d`); a machine without Docker gets the manual commands rather than a private `initdb` cluster (autonomous default — the PR tester's `localPlan` fallback exists, but no developer machine here lacks Docker today).
- The compose project stays up between commits so the second commit pays no startup (autonomous default); tearing it down when a worktree is removed is a follow-up for `watch.mjs`'s worktree cleanup, recorded in `deferred.md`.
- The Stop gate (`jest --onlyChanged`) is out of scope: it may still meet a missing database for a changed integration spec, which it reports; it skips nothing silently.

## Spec Delta

### Adds (capability: platform)

- 517-FR-001 … 517-FR-006 as above.

### Modifies

- None.

### Removes

- None.

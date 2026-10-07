# Implementation Plan: Audit history specs without restatements

**Branch**: `473-audit-history-spec-dedup` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/473-audit-history-spec-dedup/spec.md`

## Summary

Test-only refactor of the three audit history integration suites in
`libs/domain/src/audit/`: the six cases the ticket names leave the adversary
spec (any distinct assertion inside one of them joins the matching service
case), and the HTTP helpers both HTTP specs declare twice today (Nest app
bootstrap with the API's `ValidationPipe` options, the app/database lifecycle,
`account`, `bearer`, `get`) move into one `audit-history.testing.ts`,
registered by each HTTP spec with a single call as `serialDatabase` already is.
No product file, contract or route changes.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:78`); Node ESM for the Nest projects (`AGENTS.md`, NestJS 12 ESM-only)

**Primary Dependencies**: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` 12.1.2 (`package.json:18-20`), `@nestjs/testing` 12.1.2 (`package.json:43`), `supertest` 7.3.1 (`package.json:75`), `@prisma/client` 7.10.0 (`package.json:23`)

**Storage**: PostgreSQL and Redis through `AuthModule.register({ databaseUrl, redisUrl, tokenSecret })` and `createPrisma` (`libs/domain/src/auth/prisma`), as the specs already do; the suites are `*.integration.spec.ts`, so they run under `npm run test:integration` and need the compose services (`DATABASE_URL`, `REDIS_URL`)

**Testing**: Jest 30.5.2 (`package.json:66`) with ts-jest 29.4.14 (`package.json:76`), `libs/domain/jest.config.cts` (preset `jest.preset.cjs`, `testEnvironment: node`, tsconfig `tsconfig.spec.json`); `jest.preset.cjs` matches `**/?(*.)integration.spec.ts` for the integration suite, so a `*.testing.ts` file is never collected as a test (precedent: `libs/domain/src/auth/serial-db.testing.ts`, `database-turn.testing.ts`)

**Target Platform**: Node server tests (CI's "Unit and integration tests" job with PostgreSQL+PostGIS and Redis services)

**Project Type**: Nx lib `domain` (`libs/domain/project.json`), test files only

**Performance Goals**: N/A (test refactor); the suites take the database turn serially as before

**Constraints**: FR-005 — no file under `libs/domain/src/audit/` other than `*.spec.ts` and the new `*.testing.ts` changes; `GET /api/v1/audit-history` and its `{ items, nextCursor, total }` answer are untouched (context.md Constraints); the pipe options stay the API's own (`apps/api/src/bootstrap.ts:38-44`: `forbidNonWhitelisted`, `transform`, `whitelist`)

**Scale/Scope**: 3 spec files (817, 264, 722 lines today), 1 new helper module of roughly 60 lines; adversary titles drop by 6 (SC-003)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat**: one helper module replacing two identical copies, no
  new dependency, no abstraction beyond the one registering function the
  spec already fixes (clarifications, session 2026-10-07). Nothing to track.
- [x] **II. Test Discipline**: the change is the tests themselves; the suites
  stay colocated under `libs/domain/src/audit/` on real PostgreSQL and Redis.
  The red-first gate does not apply (no `apps/*/src` or `libs/*/src`
  product edit); `/speckit-tests` records the SC-003 title count check.
- [x] **III. The Given Stack**: NestJS testing module and supertest, as today.
- [x] **IV. One Repository, One Toolchain**: root Jest, Biome; the `.testing.ts`
  name keeps the helper inside Biome and typecheck and outside Jest's match.
- [x] **V. Rules Live in One Place**: no rule changes; the HTTP helpers are
  now declared once, which is the point.
- [x] **VI. PostgreSQL Is the Truth**: no state change.
- [x] **Notion choices**: none relied on; no To-decide item touched.

## Project Structure

### Documentation (this feature)

```text
specs/473-audit-history-spec-dedup/
├── spec.md
├── context.md
├── design.md            # no screens (test-only)
├── plan.md              # this file
├── checklists/
└── tasks.md             # /speckit-tasks output
```

research.md, data-model.md, contracts/ and quickstart.md: N/A. Technical
Context has no NEEDS CLARIFICATION (every value is read from the repo), the
refactor has no entities and exposes no interface, and the validation run is
the one command in "Validation" below.

### Source Code (repository root)

```text
libs/domain/src/audit/
├── audit-history.testing.ts                     (new) registering function + HTTP helpers
├── audit-history.api.integration.spec.ts        (edit) drop its bootstrap/lifecycle/account/bearer/get, import them
├── audit-history.adversary.integration.spec.ts  (edit) same, minus the six restated cases
└── audit-history.service.integration.spec.ts    (edit) receives the moved assertions only
libs/domain/src/auth/
├── serial-db.testing.ts                         (precedent: one exported registering function)
└── database-turn.testing.ts
```

**Structure Decision**: everything stays in the `domain` lib next to the
specs it serves. The helper follows `serial-db.testing.ts`: one exported
function, `auditHistoryApp()`, that the spec calls once at module level. It
registers `serialDatabase(databaseUrl)`, `beforeAll` (compile the testing
module with `AuthModule.register({ databaseUrl, redisUrl, tokenSecret })`,
`useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform:
true, whitelist: true }))`, `init`), `afterAll` (`app.close`,
`prisma.$disconnect`) and `beforeEach` (`TRUNCATE account, garage CASCADE`),
and returns `{ prisma, accounts, account, bearer, get }`, where `get(query?:
string | Record<string, string>, auth?: string)` is the union of today's two
shapes (adversary's raw-string form kept) and closes over the app that call
booted. `tokenSecret` stays inside the module (both specs use `'test-secret'`
only through `bearer`). The adversary spec keeps its own `garage`, `owner`,
`admin`, `entry`, `minutesAgo`, `ids`, `MASK` and the API spec its `world()`.

### The six removals (spec.md Assumptions)

| Adversary case (removed) | Service case (keeps/receives) |
| --- | --- |
| `leaves out an entry older than 7 days when no start is given` | `reads the last 7 days when no start is given` |
| `writes no entry when it is read, also by the admin` | `writes no entry` (+ the admin read, if not already asserted) |
| `keeps a cursor from another garage refused whatever the filters` | `refuses a cursor outside the caller's scope` (+ the platform-entry cursor) |
| `masks keys inside arrays nested in arrays and objects` | `are masked for the %s` (+ arrays-in-arrays value and array `oldValue` in the fixture) |
| `shows a system entry without an actor id` | `gives empty optional fields as null` |
| `gives the cursor of the 20th entry on a full first page` | `pages newest first, 20 at a time, with the total` |

### Validation

`docker compose up -d` (or the pre-commit hook's own services), then
`sh scripts/heavy.sh npx jest libs/domain/src/audit/audit-history > <log> 2>&1; echo "exit $?"; tail -n 40 <log>`
runs exactly the three suites. SC-003 is checked by counting `it(`/`it.each(`
titles in each file before and after (`grep -cE "^\s*it(\.each)?\(" <file>`):
adversary −6, service and API unchanged. SC-004: `git diff --stat origin/main`
shows only the three specs, the new module and `specs/`.

### Ordering with ST-472 (PR #177)

#177 edits `audit-history.api.integration.spec.ts` (a signed-in case through
AppModule + configureApp). Whichever merges second merges `origin/main` and
keeps both; this branch merges `origin/main` before ready if #177 has landed.
The helper module leaves no room for that bootstrap: #177's case brings its
own app and is not one of the shared helpers.

## Complexity Tracking

No violations.

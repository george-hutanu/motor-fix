# Quickstart: Shared apps/api integration boot helper

How to prove the change end to end. Paths are repository-relative; run from the worktree root.

## Prerequisites

- PostgreSQL and Redis with the branch's migrations: `docker compose up -d` and `DATABASE_URL`, `REDIS_URL` from `.env.example` (the pre-commit hook brings up its own pair through `scripts/test-services.ts`).
- Heavy commands run inside a slot: `scripts/heavy.sh <command>`.

## 1. The helper's own spec (FR-002, FR-005, SC-002)

```sh
scripts/heavy.sh npx jest -c apps/api/jest.config.cts apps/api/src/api-boot.testing.integration.spec.ts > /tmp/api-boot.log 2>&1; echo "exit $?"; tail -n 40 /tmp/api-boot.log
```

Expected: one test per stage in `data-model.md` (store start, module compile, app `init()`, a close that throws, a successful boot), all green; each shows a fresh `databaseTurn(url).take()` resolving within 120 s after `stop()`.

## 2. The four API integration suites, unchanged in what they assert (FR-003, FR-004, SC-003)

```sh
JEST_SUITE=integration scripts/heavy.sh npx nx run api:test > /tmp/api-int.log 2>&1; echo "exit $?"; tail -n 40 /tmp/api-int.log
```

Expected: `validation-problem`, `public-routes`, `sign-up-confirmation` and `bootstrap` integration suites green, with the same test names as on `main`.

## 3. The boot sequence exists once (SC-001, SC-004)

```sh
grep -nE 'readEnv|createTestingModule|configureApp|S3TestStore|databaseTurn|app\.close|store\.stop|turn\.release' apps/api/src/validation-problem.integration.spec.ts apps/api/src/public-routes.integration.spec.ts apps/api/src/sign-up-confirmation.integration.spec.ts
```

Expected: no output. The same grep over `apps/api/src/api-boot.testing.ts` lists each once.

## 4. Typecheck, lint, unit tests (SC-003)

```sh
scripts/heavy.sh npm run typecheck > /tmp/tc.log 2>&1; echo "exit $?"; tail -n 20 /tmp/tc.log
npx biome check apps/api
```

Expected: exit 0; `tsc -p apps/api/tsconfig.app.json` no longer sees `api-boot.testing.ts` (excluded, see `plan.md` Project Structure), `tsconfig.spec.json` does.

## 5. No production change (FR-006)

```sh
git diff origin/main --stat -- apps/api/src ':!apps/api/src/*.spec.ts' ':!apps/api/src/*.testing.ts'
```

Expected: empty.

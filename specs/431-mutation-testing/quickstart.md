# Quickstart: validating mutation testing

Prerequisites: `npm ci`; PostgreSQL and Redis running with the schema migrated (`docker compose up -d`, then `npx prisma migrate deploy --config libs/domain/prisma.config.ts` with `DATABASE_URL` set).

1. One project: `npx nx run contracts:test:mutation` → first line `mutation: contracts`, a score, exit 0.
2. No tests: `npx nx run worker:test:mutation` → `worker: no tests yet, mutation run skipped`, exit 0.
3. Floor: set a project's `thresholds.break` above its score in a scratch copy and run Stryker against it → exit 1. (Lowering a committed floor through the agent is refused: `node .claude/scripts/harness-eval.mjs` shows the `blocks-lowering-…-floor` cases passing.)
4. Every project: `npm run test:mutation` → 8 projects, one at a time, each green at its floor.
5. Affected only: on a branch touching only `libs/media`, `npm run test:mutation:affected` → `media` and its dependants only.
6. Job summary: `GITHUB_STEP_SUMMARY=$(mktemp) npx nx run contracts:test:mutation` → the file holds the header and one `| contracts | … |` row.
7. CI: a pull request shows the mutation step and a score table in the job summary.

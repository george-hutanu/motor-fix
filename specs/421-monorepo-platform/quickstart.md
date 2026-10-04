# Quickstart: validate the walking skeleton

## Prerequisites

Node 24 (`nvm use`), and either Docker (`docker compose up -d`) or local PostgreSQL 17 and Redis on their default ports. Copy `.env.example` to `.env` and fill the values for local use.

## Checks (scenario 1)

```bash
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npm run test:harness
```

All pass. `git ls-files | grep -E 'eslint|prettier'` prints nothing.

## Skeleton (scenario 2)

```bash
npx nx run-many -t serve -p api worker web
```

Open http://localhost:4200/: "MotorFix", version `dev`, "PostgreSQL: ok · Redis: ok". Stop Redis and reload: "Redis: error".

```bash
curl -i localhost:3000/health/live     # 200 {"status":"ok"}
curl -i localhost:3000/health/ready    # 200 with checks and version
curl -i localhost:3001/health/ready    # worker, same shape
curl -i localhost:3002/health/live     # mcp
```

## Conventions

```bash
curl -i localhost:3000/api/v1/nope               # 404 problem+json, X-Request-Id set
curl -i -H 'X-Request-Id: abc' localhost:3000/health/live   # X-Request-Id: abc echoed
APP_ENV=production DATABASE_URL= npx nx serve api   # exits, logs "DATABASE_URL" only
```

## Contract check (scenario 7)

```bash
npx nx run api:openapi && npx nx run data-access:generate && git diff --exit-code apps/api/openapi.json libs/data-access
```

## Seed

```bash
npx nx run domain:seed                 # idempotent; refuses APP_ENV=production
```

## Pipeline (scenarios 8–10, 13, 14)

Verified on the first real merge, once the owner has set up:

- Railway (Pro plan, EU region): services `web`, `api`, `worker` in the environments `staging` and `production`; `postgres` (PostGIS template) and `redis` from Railway's templates; each app service's variables (`APP_ENV`, `DATABASE_URL` and `REDIS_URL` as references, `API_INTERNAL_URL`, `PUBLIC_WEB_URL`); ghcr registry credentials (classic personal access token) on each service.
- GitHub: branch protection on `main` (pull requests only, CI green); environments `staging` and `production` (no required reviewers: production follows a green staging run), each with the secret `RAILWAY_API_TOKEN` (a workspace token), the variables `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_WEB`, `RAILWAY_SERVICE_API`, `RAILWAY_SERVICE_WORKER`, `PUBLIC_WEB_URL`, and, on `staging` only, the secret `DATABASE_URL` for the reset workflow.

### Checked by hand (record each)

| Check | How | Date | Result |
|---|---|---|---|
| A lint error cannot merge | open a pull request with a Biome error | | |
| A stale client fails the contract check | change `HealthReadyDto` without `nx run data-access:generate` | | |
| A broken migration stops the run before staging | merge a migration with a SQL error | | |
| Production deploys only after staging and its end-to-end suite pass | merge, watch `production` start only once `staging` is green | | |
| A failing production health check restores the previous images | deploy an image whose `/health/ready` answers 503 | | |
| Railway accepts an image by digest and runs the pre-deploy command on an image service | first staging deploy (research.md R7, unconfirmed in Railway's docs) | | |
| Every service runs in `europe-west4-drams3a` | Railway dashboard after the first deploy | | |
| A production deploy in progress is not cancelled by a newer merge | merge twice in quick succession; the second `production` job waits for the first, which completes | | |
| `docker build` succeeds for each app and target | the first `release.yml` run (no Docker on the machine that built this) | | |
| Reset staging empties, migrates and seeds staging only | run the workflow once by hand | | |

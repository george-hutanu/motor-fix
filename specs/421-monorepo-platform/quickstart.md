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

## Pipeline (scenarios 8–10, 13, 14)

Verified on the first real merge once the owner's Railway project and the GitHub settings exist (spec Assumptions). Steps and the by-hand checks are in research.md R6–R8.

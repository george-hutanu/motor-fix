# Quickstart: 563-expired-token-sweep

## Prerequisites

PostgreSQL and Redis reachable at `DATABASE_URL` and `REDIS_URL`
(`docker compose up -d`, values from `.env.example`), with the Prisma
migrations applied; Docker for the S3 test store the sweep already starts.

## Run

```sh
scripts/heavy.sh npx nx test api --testFile=apps/api/src/public-routes.integration.spec.ts > /tmp/sweep.log 2>&1; echo "exit $?"; tail -n 40 /tmp/sweep.log
```

## Expected

- The existing cases pass unchanged (route count above the public list, the
  no-credential refusal list equals `PUBLIC`, the three malformed-credential
  rows).
- The new case passes: `GET /api/v1/me` answers 200 with a fresh token for the
  created account, and every route outside `PUBLIC` answers 401 with
  `code: sign_in_required` and no `set-cookie` when given the expired token.
- `git diff --stat origin/main -- apps libs` lists only
  `apps/api/src/public-routes.integration.spec.ts` (FR-006, SC-003).
- A failure naming a route is a product defect (a route honouring an expired
  token), filed as its own bug, not fixed in this task.

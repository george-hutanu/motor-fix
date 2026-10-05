# Quickstart: check the sign-in gate

Prerequisites: PostgreSQL and Redis running (`docker compose up -d`), `DATABASE_URL` and `REDIS_URL` as in `.env.example`.

1. API, public list: `npx jest apps/api/src/public-routes.integration.spec.ts --maxWorkers=2` — every route without a token answers 401 `sign_in_required` except the six of `contracts/gate.md`.
2. Web, interceptor and dialog: `npx jest apps/web/src/app/auth.interceptor apps/web/src/app/sign-in --maxWorkers=2`.
3. End to end: `scripts/heavy.sh npx nx e2e web-e2e -- --grep "sign-in gate"` — on a signed-in dashboard whose session is refused, an account call opens the dialog with "Intră în cont ca să continui."; signing in closes it on the same address and the call is sent again once.
4. By hand: `curl -i -X PATCH localhost:3000/api/v1/me -d '{}'` → 401 with `"code":"sign_in_required"` (no 400).

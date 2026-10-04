# Quickstart: Account model, roles and their rights

```bash
createdb motorfix_st079
export DATABASE_URL=postgresql://localhost:5432/motorfix_st079 REDIS_URL=redis://localhost:6379/1 APP_ENV=test AUTH_TOKEN_SECRET=dev-secret
npx prisma migrate deploy --config libs/domain/prisma.config.ts
npx jest libs/domain/src/auth apps/api/src      # capability table, policy, token, use cases, HTTP 401/403/404, /me
npx nx run web:test                              # guard and frame
npx nx run web-e2e:e2e                           # each role lands on its frame; a driver typing /app/admin ends on /app/driver
```

Expected: all green; `GET /api/v1/me` without a token answers 401 `sign_in_required`.

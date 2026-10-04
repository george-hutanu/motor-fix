# Quickstart: sign-in

```bash
# PostgreSQL and Redis running; DATABASE_URL, REDIS_URL, AUTH_TOKEN_SECRET, APP_ENV=development in .env
npx prisma migrate deploy --config libs/domain/prisma.config.ts
npx nx run domain:seed            # the seeded accounts, password parola-de-test
npx nx run api:serve & npx nx run web:serve
```

Open http://localhost:4200/ro, tap "Cont" (phone width) or "Autentificare" (wider), and sign in as:

| E-mail | Lands on |
| --- | --- |
| `sofer@example.test` | `/app/driver` |
| `service@example.test` | `/app/garage` (owner) |
| `receptie@example.test` | `/app/garage` (receptionist menu) |
| `mecanic@example.test` | `/app/garage` (mechanic menu) |
| `admin@example.test` | `/app/admin` |
| `doua-roluri@example.test` | `/app/garage` (driver + garage, last role garage) |
| `suspendat@example.test` | refused: account suspended |

Tests: `npx jest libs/domain/src/auth apps/web/src/app --maxWorkers=2` (needs PostgreSQL and Redis), `npx nx run web-e2e:e2e`.

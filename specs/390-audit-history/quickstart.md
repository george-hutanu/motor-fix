# Quickstart: Audit history writer

Prerequisites: local PostgreSQL; `DATABASE_URL=postgresql://localhost:5432/motorfix_390`.

1. Fresh database: `createdb -h localhost motorfix_390_fresh`, then apply every migration in order with `psql -h localhost -d motorfix_390_fresh -v ON_ERROR_STOP=1 -f libs/domain/prisma/migrations/<dir>/migration.sql` (P1010 blocks `prisma migrate deploy` locally; CI uses `prisma migrate deploy`). Expect no error.
2. `npx prisma generate --config libs/domain/prisma.config.ts`.
3. `npx jest libs/domain/src/audit` → the writer and coverage specs pass.
4. `npx jest libs/domain` → ST-79's specs still pass with the real writer bound.
5. `psql -h localhost -d motorfix_390 -c "UPDATE activity_log SET text='x'"` → `ERROR: activity_log is append-only`.
